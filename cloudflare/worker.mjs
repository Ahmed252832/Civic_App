import storeModule from '../shared/store.cjs';

const { createStore } = storeModule;
const SESSION_SECONDS = 8 * 60 * 60;
const safeHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(self)',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://tile.openstreetmap.org; connect-src 'self'; font-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
};
const json = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...safeHeaders, ...headers } });
const csvCell = value => {
  let text = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
};

export class CivicState {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    const sql = state.storage.sql;
    const all = (query, params = []) => sql.exec(query, ...params).toArray();
    const one = (query, params = []) => all(query, params)[0] || null;
    const run = (query, params = []) => sql.exec(query, ...params);
    const id = () => one('SELECT last_insert_rowid() AS id').id;
    this.store = createStore({ all, one, run, id, transact: fn => state.storage.transactionSync(fn), persist: () => {}, close: () => {} }, { demo: false });
    run('CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), expires_at INTEGER NOT NULL)');
    run('CREATE TABLE IF NOT EXISTS rate_limits (ip TEXT NOT NULL, kind TEXT NOT NULL, window_start INTEGER NOT NULL, attempts INTEGER NOT NULL, PRIMARY KEY(ip,kind))');
  }
  cookie(request) {
    const match = (request.headers.get('Cookie') || '').match(/(?:^|;\s*)civicpulse_session=([^;]+)/);
    return match?.[1] || null;
  }
  async hash(token) {
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
    return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
  }
  async sessionUser(request) {
    const token = this.cookie(request);
    if (!token) return null;
    const tokenHash = await this.hash(token);
    const row = this.state.storage.sql.exec('SELECT user_id FROM sessions WHERE token_hash=? AND expires_at>?', tokenHash, Date.now()).toArray()[0];
    return row ? this.store.userById(row.user_id) : null;
  }
  async newSession(user) {
    const token = crypto.randomUUID() + crypto.randomUUID();
    const tokenHash = await this.hash(token);
    this.state.storage.sql.exec('INSERT INTO sessions (token_hash,user_id,expires_at) VALUES (?,?,?)', tokenHash, user.id, Date.now() + SESSION_SECONDS * 1000);
    return `civicpulse_session=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${SESSION_SECONDS}`;
  }
  rateLimit(request, kind, max) {
    const ip = request.headers.get('x-civic-ip') || 'unknown';
    const now = Math.floor(Date.now() / 1000);
    const row = this.state.storage.sql.exec('SELECT window_start,attempts FROM rate_limits WHERE ip=? AND kind=?', ip, kind).toArray()[0];
    if (!row || now - row.window_start >= 900) {
      this.state.storage.sql.exec('INSERT OR REPLACE INTO rate_limits (ip,kind,window_start,attempts) VALUES (?,?,?,1)', ip, kind, now);
      return;
    }
    if (row.attempts >= max) throw new Error('Too many attempts. Try again later.');
    this.state.storage.sql.exec('UPDATE rate_limits SET attempts=attempts+1 WHERE ip=? AND kind=?', ip, kind);
  }
  async fetch(request) {
    try {
      const url = new URL(request.url);
      const origin = request.headers.get('Origin');
      if (origin && origin !== url.origin) return json(403, { ok: false, error: 'Cross-origin request refused.' });
      if (url.pathname === '/api/export.csv') {
        if (request.method !== 'GET') return json(405, { ok: false, error: 'Method not allowed.' });
        const user = await this.sessionUser(request);
        if (!user) return json(401, { ok: false, error: 'Please sign in again.' });
        if (!['admin', 'superadmin'].includes(user.role)) return json(403, { ok: false, error: 'Only administrators can export reports.' });
        const rows = [['Code','Title','Category','Area','Severity','Priority','Status','Department','Reported'],
          ...this.store.exportRows(user).map(c => [c.code,c.title,c.category,c.area,c.severity,c.priority,c.status,c.department || '',c.created_at])];
        return new Response('\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n'), { headers: { ...safeHeaders, 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="civicpulse-dhaka-complaints.csv"', 'Cache-Control': 'no-store' } });
      }
      if (request.method !== 'POST' || url.pathname !== '/api/request') return json(404, { ok: false, error: 'Not found.' });
      if (!(request.headers.get('Content-Type') || '').startsWith('application/json')) return json(415, { ok: false, error: 'JSON request required.' });
      const raw = await request.text();
      if (raw.length > 4_000_000) return json(413, { ok: false, error: 'Request is too large.' });
      const { method, payload = {} } = JSON.parse(raw);
      if (method === 'config') return json(200, { ok: true, data: { demoMode: false, browserMode: true, setupRequired: this.store.setupRequired() } });
      if (method === 'session') return json(200, { ok: true, data: await this.sessionUser(request) });
      if (method === 'bootstrap') {
        this.rateLimit(request, 'bootstrap', 10);
        if (!this.env.BOOTSTRAP_KEY || payload.key !== this.env.BOOTSTRAP_KEY) throw new Error('Invalid setup key.');
        const user = this.store.bootstrapAdmin(payload);
        return json(200, { ok: true, data: user }, { 'Set-Cookie': await this.newSession(user) });
      }
      if (method === 'register') {
        this.rateLimit(request, 'register', 8);
        if (this.store.setupRequired()) throw new Error('The platform owner must finish setup first.');
        const user = this.store.register(payload);
        return json(200, { ok: true, data: user }, { 'Set-Cookie': await this.newSession(user) });
      }
      if (method === 'login') {
        this.rateLimit(request, 'login', 20);
        const user = this.store.login(payload.email, payload.password);
        return json(200, { ok: true, data: user }, { 'Set-Cookie': await this.newSession(user) });
      }
      if (method === 'logout') {
        const token = this.cookie(request);
        if (token) this.state.storage.sql.exec('DELETE FROM sessions WHERE token_hash=?', await this.hash(token));
        return json(200, { ok: true, data: true }, { 'Set-Cookie': 'civicpulse_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0' });
      }
      const user = await this.sessionUser(request);
      if (!user) return json(401, { ok: false, error: 'Please sign in again.' });
      if (method === 'changePassword') {
        this.rateLimit(request, 'password', 10);
        this.store.changePassword(user, payload);
        this.state.storage.sql.exec('DELETE FROM sessions WHERE user_id=?', user.id);
        return json(200, { ok: true, data: true }, { 'Set-Cookie': await this.newSession(user) });
      }
      let data;
      switch (method) {
        case 'snapshot': data = this.store.snapshot(user); break;
        case 'areaSummary': data = this.store.areaSummary(user, payload); break;
        case 'listComplaints': data = this.store.listComplaints(user, payload); break;
        case 'complaintDetail': data = this.store.complaintDetail(user, payload); break;
        case 'nearby': data = this.store.nearby(user, payload); break;
        case 'create': this.rateLimit(request, 'complaint', 8); data = this.store.createComplaint(user, payload); break;
        case 'action': data = this.store.act(user, payload); break;
        case 'feedback': this.rateLimit(request, 'feedback', 20); data = this.store.submitFeedback(user, payload); break;
        case 'manage':
          data = this.store.manage(user, payload);
          if (payload.type === 'userStatus' && payload.active === false) this.state.storage.sql.exec('DELETE FROM sessions WHERE user_id=?', data);
          break;
        case 'beginBackup': this.rateLimit(request, 'backup', 10); data = this.store.beginBackup(user, payload); break;
        case 'backupPage': data = this.store.backupPage(user, payload); break;
        case 'endBackup': data = this.store.endBackup(user, payload); break;
        default: throw new Error('Unknown request.');
      }
      return json(200, { ok: true, data });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = /permission|Only administrators|Cross-origin/i.test(message) ? 403 : /sign in/i.test(message) ? 401 : /Too many attempts/i.test(message) ? 429 : 400;
      return json(status, { ok: false, error: message });
    }
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      const headers = new Headers(request.headers);
      headers.set('x-civic-ip', request.headers.get('CF-Connecting-IP') || 'local');
      const forwarded = new Request(request, { headers });
      return env.CIVIC_STATE.get(env.CIVIC_STATE.idFromName('dhaka')).fetch(forwarded);
    }
    const response = await env.ASSETS.fetch(request);
    const headers = new Headers(response.headers);
    for (const [key, value] of Object.entries(safeHeaders)) headers.set(key, value);
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  }
};
