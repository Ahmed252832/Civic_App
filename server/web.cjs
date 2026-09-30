const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { createDatabase } = require('../electron/database.cjs');

const projectRoot = path.resolve(__dirname, '..');
const distRoot = path.join(projectRoot, 'dist');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.webp': 'image/webp',
  '.woff2': 'font/woff2', '.json': 'application/json; charset=utf-8'
};
const SESSION_SECONDS = 8 * 60 * 60;

function csvCell(value) {
  let text = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
function complaintCsv(complaints) {
  const rows = [['Code','Title','Category','Area','Severity','Priority','Status','Department','Reported','Closure target','Closed','Possible recurrence'],
    ...complaints.map(c => [c.code,c.title,c.category,c.area,c.severity,c.priority,c.status,c.department || '',c.created_at,c.resolution_due_at || '',c.closed_at || '',c.recurring])];
  return '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n');
}
function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > 4_000_000) { reject(new Error('Request is too large.')); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new Error('Invalid JSON request.')); }
    });
    req.on('error', reject);
  });
}
function sendJson(res, status, payload, extraHeaders = {}) {
  const body = Buffer.from(JSON.stringify(payload));
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': body.length, 'Cache-Control': 'no-store', ...extraHeaders });
  res.end(body);
}
function cookieValue(req, key) {
  const cookies = (req.headers.cookie || '').split(';');
  const item = cookies.find(part => part.trim().startsWith(`${key}=`));
  return item ? item.trim().slice(key.length + 1) : null;
}

async function createWebServer(options = {}) {
  const databasePath = options.databasePath || path.join(process.env.CIVICPULSE_DATA_DIR || path.join(projectRoot, 'data'), 'civicpulse.sqlite');
  const database = await createDatabase(databasePath);
  const setupKey = options.setupKey || process.env.CIVICPULSE_SETUP_KEY || (() => {
    const envFile = path.join(projectRoot, '.dev.vars');
    if (!fs.existsSync(envFile)) return '';
    return fs.readFileSync(envFile, 'utf8').match(/^BOOTSTRAP_KEY=(.+)$/m)?.[1]?.trim() || '';
  })();
  const sessions = new Map();
  const sessionUser = req => {
    const token = cookieValue(req, 'civicpulse_session');
    const session = token && sessions.get(token);
    if (!session) return null;
    if (session.expires < Date.now()) { sessions.delete(token); return null; }
    return database.userById(session.userId);
  };
  const requireUser = req => {
    const user = sessionUser(req);
    if (!user) throw new Error('Please sign in again.');
    return user;
  };
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://tile.openstreetmap.org; connect-src 'self'; font-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    try {
      const url = new URL(req.url || '/', 'http://127.0.0.1');
      if (req.method === 'POST' && url.pathname === '/api/request') {
        const origin = req.headers.origin;
        if (origin && origin !== `http://${req.headers.host}`) return sendJson(res, 403, { ok: false, error: 'Cross-origin request refused.' });
        if (!(req.headers['content-type'] || '').startsWith('application/json')) return sendJson(res, 415, { ok: false, error: 'JSON request required.' });
        const body = await readJson(req);
        const method = body.method;
        const payload = body.payload || {};
        if (method === 'config') return sendJson(res, 200, { ok: true, data: { demoMode: false, browserMode: true, setupRequired: database.setupRequired(), emailEnabled: false, offsiteBackupEnabled: false } });
        if (method === 'session') return sendJson(res, 200, { ok: true, data: sessionUser(req) });
        if (method === 'forgotPassword' || method === 'requestVerification') throw new Error('Email delivery is only available on the hosted site after a mail provider is configured.');
        if (method === 'verifyEmail') return sendJson(res, 200, { ok: true, data: Boolean(database.consumeAccountToken(payload.token, 'verify')) });
        if (method === 'resetPassword') {
          const userId = database.consumeAccountToken(payload.token, 'reset', payload.newPassword);
          for (const [token, session] of sessions) if (session.userId === userId) sessions.delete(token);
          return sendJson(res, 200, { ok: true, data: true }, { 'Set-Cookie': 'civicpulse_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
        }
        if (method === 'recoverWithCode') {
          const userId = database.consumeAccountToken(payload.code, 'recovery', payload.newPassword);
          for (const [token, session] of sessions) if (session.userId === userId) sessions.delete(token);
          return sendJson(res, 200, { ok: true, data: true }, { 'Set-Cookie': 'civicpulse_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
        }
        if (method === 'bootstrap') {
          if (!setupKey || payload.key !== setupKey) throw new Error('Invalid setup key.');
          const account = database.bootstrapAdmin(payload);
          const token = crypto.randomBytes(32).toString('base64url');
          sessions.set(token, { userId: account.id, expires: Date.now() + SESSION_SECONDS * 1000 });
          return sendJson(res, 200, { ok: true, data: account }, { 'Set-Cookie': `civicpulse_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_SECONDS}` });
        }
        if (method === 'register') {
          if (database.setupRequired()) throw new Error('The platform owner must finish setup first.');
          const user = database.register(payload);
          const token = crypto.randomBytes(32).toString('base64url');
          sessions.set(token, { userId: user.id, expires: Date.now() + SESSION_SECONDS * 1000 });
          return sendJson(res, 200, { ok: true, data: user }, { 'Set-Cookie': `civicpulse_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_SECONDS}` });
        }
        if (method === 'login') {
          const user = database.login(payload.email, payload.password);
          const oldToken = cookieValue(req, 'civicpulse_session');
          if (oldToken) sessions.delete(oldToken);
          const token = crypto.randomBytes(32).toString('base64url');
          sessions.set(token, { userId: user.id, expires: Date.now() + SESSION_SECONDS * 1000 });
          return sendJson(res, 200, { ok: true, data: user }, { 'Set-Cookie': `civicpulse_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_SECONDS}` });
        }
        if (method === 'logout') {
          const token = cookieValue(req, 'civicpulse_session');
          if (token) sessions.delete(token);
          return sendJson(res, 200, { ok: true, data: true }, { 'Set-Cookie': 'civicpulse_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
        }
        const actor = requireUser(req);
        if (method === 'changePassword') {
          database.changePassword(actor, payload);
          for (const [token, session] of sessions) if (session.userId === actor.id) sessions.delete(token);
          const token = crypto.randomBytes(32).toString('base64url');
          sessions.set(token, { userId: actor.id, expires: Date.now() + SESSION_SECONDS * 1000 });
          return sendJson(res, 200, { ok: true, data: true }, { 'Set-Cookie': `civicpulse_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_SECONDS}` });
        }
        if (method === 'issueRecoveryCode') return sendJson(res, 200, { ok: true, data: database.issueRecoveryCode(actor, payload.password) });
        let result;
        switch (method) {
          case 'snapshot': result = database.snapshot(actor); break;
          case 'performance': result = database.performance(actor); break;
            case 'requestReopen': result = database.requestReopen(actor, payload); break;
            case 'decideReopen': result = database.decideReopen(actor, payload); break;
          case 'readNotification': result = database.readNotification(actor, payload); break;
          case 'areaSummary': result = database.areaSummary(actor, payload); break;
          case 'listComplaints': result = database.listComplaints(actor, payload); break;
          case 'complaintDetail': result = database.complaintDetail(actor, payload); break;
          case 'nearby': result = database.nearby(actor, payload); break;
          case 'create': result = database.createComplaint(actor, payload); break;
          case 'action': result = database.act(actor, payload); break;
          case 'feedback': result = database.submitFeedback(actor, payload); break;
          case 'manage':
            result = database.manage(actor, payload);
            if (payload.type === 'userStatus' && payload.active === false) {
              for (const [token, session] of sessions) if (session.userId === result) sessions.delete(token);
            }
            break;
          case 'beginBackup': result = database.beginBackup(actor, payload); break;
          case 'backupPage': result = database.backupPage(actor, payload); break;
          case 'endBackup': result = database.endBackup(actor, payload); break;
          default: throw new Error('Unknown request.');
        }
        return sendJson(res, 200, { ok: true, data: result });
      }
      if (req.method === 'GET' && url.pathname === '/api/export.csv') {
        const actor = requireUser(req);
        if (!['admin','superadmin'].includes(actor.role)) throw new Error('Only administrators can export reports.');
        const csv = Buffer.from(complaintCsv(database.exportRows(actor)), 'utf8');
        res.writeHead(200, {
          'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="civicpulse-complaints.csv"',
          'Content-Length': csv.length, 'Cache-Control': 'no-store'
        });
        return res.end(csv);
      }
      if (!['GET','HEAD'].includes(req.method || '')) return sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
      let requestPath;
      try { requestPath = decodeURIComponent(url.pathname); }
      catch { return sendJson(res, 400, { ok: false, error: 'Invalid path.' }); }
      const file = requestPath === '/' ? path.join(distRoot, 'index.html') : path.resolve(distRoot, `.${requestPath}`);
      const relative = path.relative(distRoot, file);
      if (relative.startsWith('..') || path.isAbsolute(relative)) return sendJson(res, 403, { ok: false, error: 'Forbidden.' });
      if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return sendJson(res, 404, { ok: false, error: 'Not found.' });
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': file.endsWith('index.html') ? 'no-cache' : 'public, max-age=3600' });
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(file).pipe(res);
    } catch (error) {
      if (res.headersSent) return res.end();
      const message = error instanceof Error ? error.message : String(error);
      const status = /sign in/i.test(message) ? 401 : /permission|Only administrators/i.test(message) ? 403 : 400;
      sendJson(res, status, { ok: false, error: message });
    }
  });
  return { server, database };
}

async function main() {
  const port = Number(process.env.CIVICPULSE_PORT || 4173);
  const { server, database } = await createWebServer();
  server.listen(port, '127.0.0.1', () => {
    const address = server.address();
    const url = `http://127.0.0.1:${address.port}/`;
    console.log(`CivicPulse web app is ready: ${url}`);
    if (process.argv.includes('--open')) {
      const command = process.platform === 'win32' ? 'explorer.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
      const child = spawn(command, [url], { detached: true, stdio: 'ignore', windowsHide: true });
      child.unref();
    }
  });
  const shutdown = () => server.close(() => { database.close(); process.exit(0); });
  process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { createWebServer, complaintCsv };
