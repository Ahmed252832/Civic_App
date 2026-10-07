import storeModule from '../shared/store.cjs';
import { sendPushNotification } from '@mmmike/web-push/send';

const { createStore } = storeModule;
const SESSION_SECONDS = 8 * 60 * 60;
const safeHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(self)',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Content-Security-Policy': "default-src 'self'; script-src 'self' https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://tile.openstreetmap.org; connect-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; font-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
};
const json = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...safeHeaders, ...headers } });
const csvCell = value => {
  let text = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
};
const mailReady = env => Boolean(env.RESEND_API_KEY && env.MAIL_FROM && env.PUBLIC_APP_URL);
async function sendAccountMail(env, to, purpose, token) {
  const base = new URL(env.PUBLIC_APP_URL);
  if (base.protocol !== 'https:') throw new Error('PUBLIC_APP_URL must use HTTPS.');
  const link = `${base.origin}/#${purpose === 'verify' ? 'verify' : 'reset'}=${encodeURIComponent(token)}`;
  const subject = purpose === 'verify' ? 'Verify your CivicPulse email' : 'Reset your CivicPulse password';
  const text = `${subject}\n\nOpen this link: ${link}\n\nThis link expires in ${purpose === 'verify' ? '24 hours' : '30 minutes'}. If you did not request it, ignore this email.`;
  const response = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: env.MAIL_FROM, to: [to], subject, text }) });
  if (!response.ok) throw new Error('Email delivery failed. Please try again later.');
}
const pushReady = env => Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT);
const turnstileReady = env => Boolean(env.TURNSTILE_SITE_KEY && env.TURNSTILE_SECRET_KEY);
async function verifyTurnstile(env, token, ip) {
  if (!turnstileReady(env)) return;
  if (typeof token !== 'string' || token.length < 10 || token.length > 2048) throw new Error('Complete the security check.');
  const form = new URLSearchParams({ secret: env.TURNSTILE_SECRET_KEY, response: token, remoteip: ip || '' });
  const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form });
  if (!response.ok || !(await response.json()).success) throw new Error('Security check failed. Please retry.');
}
const validPushEndpoint = value => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && (url.hostname === 'fcm.googleapis.com' || url.hostname === 'updates.push.services.mozilla.com' || url.hostname.endsWith('.push.apple.com') || url.hostname.endsWith('.push.services.mozilla.com'));
  } catch { return false; }
};
const alertTitlesBn = {
  'New case message': 'অভিযোগে নতুন বার্তা',
  'Please review completed work': 'সম্পন্ন কাজ যাচাই করুন',
  'Due soon': 'সময়সীমা কাছাকাছি',
  'Overdue': 'সময়সীমা পেরিয়েছে',
  'Rework review needed': 'পুনরায় কাজের আবেদন দেখুন',
  'Rework approved': 'পুনরায় কাজ অনুমোদিত',
  'Rework declined': 'পুনরায় কাজের আবেদন বাতিল'
};
const alertTitle = (title, language) => language === 'bn' ? alertTitlesBn[title] || title : title;
async function sendAlertMail(env, to, title, language = 'en') {
  if (!mailReady(env)) return;
  const text = language === 'bn'
    ? `CivicPulse-এ আপনার অভিযোগের নতুন তথ্য আছে। বিস্তারিত দেখতে ${new URL(env.PUBLIC_APP_URL).origin}/-এ প্রবেশ করুন।`
    : `You have an update in CivicPulse. Sign in at ${new URL(env.PUBLIC_APP_URL).origin}/ to view the details.`;
  const response = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: env.MAIL_FROM, to: [to], subject: `CivicPulse: ${alertTitle(title, language)}`, text }) });
  if (!response.ok) throw new Error(`Alert email delivery failed: ${response.status}`);
}

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
    run('CREATE TABLE IF NOT EXISTS push_subscriptions (endpoint TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), p256dh TEXT NOT NULL, auth TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)');
    run('CREATE INDEX IF NOT EXISTS push_subscriptions_user ON push_subscriptions(user_id)');
  }
  async deliverNotifications(afterId) {
    if (!pushReady(this.env) && !mailReady(this.env)) return;
    const rows = this.state.storage.sql.exec('SELECT n.id,n.user_id,n.complaint_id,n.title,u.email,u.email_verified,u.language FROM notifications n JOIN users u ON u.id=n.user_id WHERE n.id>? AND u.active=1 ORDER BY n.id LIMIT 1000', afterId).toArray();
    for (const row of rows) {
      if (pushReady(this.env)) {
        const subscriptions = this.state.storage.sql.exec('SELECT endpoint,p256dh,auth FROM push_subscriptions WHERE user_id=?', row.user_id).toArray();
        for (const sub of subscriptions) {
          try {
            const delivered = await sendPushNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, { title: alertTitle(row.title, row.language), body: row.language === 'bn' ? 'নতুন তথ্য দেখতে CivicPulse খুলুন।' : 'Open CivicPulse to view your update.', url: '/', tag: `civic-${row.id}` }, { publicKey: this.env.VAPID_PUBLIC_KEY, privateKey: this.env.VAPID_PRIVATE_KEY, subject: this.env.VAPID_SUBJECT });
            if (!delivered) this.state.storage.sql.exec('DELETE FROM push_subscriptions WHERE endpoint=?', sub.endpoint);
          } catch (error) { console.error('Push delivery failed:', error?.statusCode || 'network'); this.store.recordOperationalEvent('alert_failure', 'Push delivery failed'); }
        }
      }
      if (mailReady(this.env) && row.email_verified) {
        try { await sendAlertMail(this.env, row.email, row.title, row.language); }
        catch (error) { console.error('Alert email failed:', error instanceof Error ? error.message : 'network'); this.store.recordOperationalEvent('alert_failure', 'Email delivery failed'); }
      }
    }
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
      if (url.pathname === '/internal/backup' && request.headers.get('x-civic-backup') === this.env.BACKUP_ENCRYPTION_KEY && this.env.BACKUP_ENCRYPTION_KEY) {
        return json(200, { ok: true, data: this.store.automaticBackupData() });
      }
      if (url.pathname === '/internal/backup-complete' && request.headers.get('x-civic-backup') === this.env.BACKUP_ENCRYPTION_KEY && this.env.BACKUP_ENCRYPTION_KEY) {
        return json(200, { ok: true, data: this.store.recordOperationalEvent('offsite_backup', request.headers.get('x-civic-backup-name') || '') });
      }
      if (url.pathname === '/internal/escalate' && request.headers.get('x-civic-cron') === this.env.BOOTSTRAP_KEY && this.env.BOOTSTRAP_KEY) {
        const after = this.state.storage.sql.exec('SELECT COALESCE(MAX(id),0) AS id FROM notifications').toArray()[0].id;
        const events = [...this.store.processEscalations(), ...this.store.processCitizenReminders()];
        this.state.waitUntil(this.deliverNotifications(after));
        return json(200, { ok: true, data: events.length });
      }
      const origin = request.headers.get('Origin');
      if (origin && origin !== url.origin) return json(403, { ok: false, error: 'Cross-origin request refused.' });
      if (url.pathname === '/api/export.csv') {
        if (request.method !== 'GET') return json(405, { ok: false, error: 'Method not allowed.' });
        const user = await this.sessionUser(request);
        if (!user) return json(401, { ok: false, error: 'Please sign in again.' });
        if (!['admin', 'superadmin'].includes(user.role)) return json(403, { ok: false, error: 'Only administrators can export reports.' });
        const rows = [['Code','Title','Category','Area','Severity','Priority','Status','Department','Reported','Closure target','Closed','Possible recurrence'],
          ...this.store.exportRows(user).map(c => [c.code,c.title,c.category,c.area,c.severity,c.priority,c.status,c.department || '',c.created_at,c.resolution_due_at || '',c.closed_at || '',c.recurring])];
        return new Response('\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n'), { headers: { ...safeHeaders, 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="civicpulse-dhaka-complaints.csv"', 'Cache-Control': 'no-store' } });
      }
      if (request.method !== 'POST' || url.pathname !== '/api/request') return json(404, { ok: false, error: 'Not found.' });
      if (!(request.headers.get('Content-Type') || '').startsWith('application/json')) return json(415, { ok: false, error: 'JSON request required.' });
      const raw = await request.text();
      if (raw.length > 4_000_000) return json(413, { ok: false, error: 'Request is too large.' });
      const { method, payload = {} } = JSON.parse(raw);
      if (method === 'config') return json(200, { ok: true, data: { demoMode: false, browserMode: true, setupRequired: this.store.setupRequired(), emailEnabled: mailReady(this.env), offsiteBackupEnabled: Boolean(this.env.BACKUP_BUCKET && this.env.BACKUP_ENCRYPTION_KEY), pushPublicKey: pushReady(this.env) ? this.env.VAPID_PUBLIC_KEY : null, turnstileSiteKey: turnstileReady(this.env) ? this.env.TURNSTILE_SITE_KEY : null } });
      if (method === 'session') return json(200, { ok: true, data: await this.sessionUser(request) });
      if (method === 'publicReplay') {
        this.rateLimit(request, 'public-replay', 90);
        return json(200, { ok: true, data: this.store.publicReplay(payload) });
      }
      if (method === 'publicStreetPulse') {
        this.rateLimit(request, 'public-streetpulse', 90);
        return json(200, { ok: true, data: this.store.publicStreetPulse(payload) });
      }
      if (method === 'bootstrap') {
        this.rateLimit(request, 'bootstrap', 10);
        if (!this.env.BOOTSTRAP_KEY || payload.key !== this.env.BOOTSTRAP_KEY) throw new Error('Invalid setup key.');
        const user = this.store.bootstrapAdmin(payload);
        return json(200, { ok: true, data: user }, { 'Set-Cookie': await this.newSession(user) });
      }
      if (method === 'register') {
        this.rateLimit(request, 'register', 8);
        await verifyTurnstile(this.env, payload.turnstileToken, request.headers.get('x-civic-ip'));
        if (this.store.setupRequired()) throw new Error('The platform owner must finish setup first.');
        const user = this.store.register(payload);
        if (mailReady(this.env)) {
          try { const issued = this.store.issueAccountToken(user.id, 'verify'); await sendAccountMail(this.env, issued.email, 'verify', issued.token); }
          catch (error) { console.error('Registration verification email failed:', error instanceof Error ? error.message : 'unknown error'); }
        }
        return json(200, { ok: true, data: user }, { 'Set-Cookie': await this.newSession(user) });
      }
      if (method === 'forgotPassword') {
        this.rateLimit(request, 'forgot', 5);
        if (!mailReady(this.env)) throw new Error('Email recovery is not configured yet. Contact the platform owner.');
        const account = this.store.findActiveEmail(payload.email);
        if (account?.emailVerified) {
          try { const issued = this.store.issueAccountToken(account.id, 'reset'); await sendAccountMail(this.env, issued.email, 'reset', issued.token); }
          catch (error) { console.error('Recovery email failed:', error instanceof Error ? error.message : 'unknown error'); }
        }
        return json(200, { ok: true, data: true });
      }
      if (method === 'resetPassword') {
        this.rateLimit(request, 'reset', 10);
        const accountId = this.store.consumeAccountToken(payload.token, 'reset', payload.newPassword);
        this.state.storage.sql.exec('DELETE FROM sessions WHERE user_id=?', accountId);
        return json(200, { ok: true, data: true }, { 'Set-Cookie': 'civicpulse_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0' });
      }
      if (method === 'recoverWithCode') {
        this.rateLimit(request, 'recover-code', 8);
        const accountId = this.store.consumeAccountToken(payload.code, 'recovery', payload.newPassword);
        this.state.storage.sql.exec('DELETE FROM sessions WHERE user_id=?', accountId);
        return json(200, { ok: true, data: true }, { 'Set-Cookie': 'civicpulse_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0' });
      }
      if (method === 'verifyEmail') {
        this.rateLimit(request, 'verify', 10);
        this.store.consumeAccountToken(payload.token, 'verify');
        return json(200, { ok: true, data: true });
      }
      if (method === 'login') {
        this.rateLimit(request, 'login', 20);
        const user = this.store.login(payload.email, payload.password, payload.code);
        return json(200, { ok: true, data: user }, { 'Set-Cookie': await this.newSession(user) });
      }
      if (method === 'logout') {
        const token = this.cookie(request);
        const oldUser = await this.sessionUser(request);
        if (oldUser) this.state.storage.sql.exec('DELETE FROM push_subscriptions WHERE user_id=?', oldUser.id);
        if (token) this.state.storage.sql.exec('DELETE FROM sessions WHERE token_hash=?', await this.hash(token));
        return json(200, { ok: true, data: true }, { 'Set-Cookie': 'civicpulse_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0' });
      }
      const user = await this.sessionUser(request);
      if (!user) return json(401, { ok: false, error: 'Please sign in again.' });
      if (method === 'pushSubscribe') {
        if (!pushReady(this.env)) throw new Error('Browser alerts are not configured.');
        const sub = payload.subscription;
        if (!sub || typeof sub !== 'object' || typeof sub.endpoint !== 'string' || sub.endpoint.length > 2000 || !validPushEndpoint(sub.endpoint) || !/^[A-Za-z0-9_-]{80,100}$/.test(sub.keys?.p256dh || '') || !/^[A-Za-z0-9_-]{15,30}$/.test(sub.keys?.auth || '')) throw new Error('Invalid browser subscription.');
        const existing = this.state.storage.sql.exec('SELECT endpoint FROM push_subscriptions WHERE endpoint=?', sub.endpoint).toArray()[0];
        const count = this.state.storage.sql.exec('SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id=?', user.id).toArray()[0].n;
        if (!existing && count >= 5) throw new Error('This account already has five devices with alerts. Disable an older device first.');
        this.state.storage.sql.exec('INSERT OR REPLACE INTO push_subscriptions (endpoint,user_id,p256dh,auth) VALUES (?,?,?,?)', sub.endpoint,user.id,sub.keys.p256dh,sub.keys.auth);
        return json(200, { ok: true, data: true });
      }
      if (method === 'pushUnsubscribe') {
        this.state.storage.sql.exec('DELETE FROM push_subscriptions WHERE endpoint=? AND user_id=?', String(payload.endpoint || ''),user.id);
        return json(200, { ok: true, data: true });
      }
      if (method === 'changePassword') {
        this.rateLimit(request, 'password', 10);
        this.store.changePassword(user, payload);
        this.state.storage.sql.exec('DELETE FROM sessions WHERE user_id=?', user.id);
        return json(200, { ok: true, data: true }, { 'Set-Cookie': await this.newSession(user) });
      }
      if (method === 'requestVerification') {
        this.rateLimit(request, 'verify-mail', 5);
        if (!mailReady(this.env)) throw new Error('Email verification is not configured yet.');
        const issued = this.store.issueAccountToken(user.id, 'verify');
        await sendAccountMail(this.env, issued.email, 'verify', issued.token);
        return json(200, { ok: true, data: true });
      }
      if (method === 'issueRecoveryCode') {
        this.rateLimit(request, 'recovery-code-issue', 5);
        return json(200, { ok: true, data: this.store.issueRecoveryCode(user, payload.password) });
      }
      if (method === 'beginMfa') {
        this.rateLimit(request, 'mfa-setup', 5);
        return json(200, { ok: true, data: this.store.beginMfa(user, payload.password) });
      }
      if (method === 'confirmMfa' || method === 'disableMfa') {
        this.rateLimit(request, 'mfa-change', 8);
        const data = method === 'confirmMfa' ? this.store.confirmMfa(user, payload) : this.store.disableMfa(user, payload);
        this.state.storage.sql.exec('DELETE FROM sessions WHERE user_id=?', user.id);
        return json(200, { ok: true, data }, { 'Set-Cookie': await this.newSession(user) });
      }
      if (method === 'requestPrivacyRemoval') {
        this.rateLimit(request, 'privacy-request', 4);
        return json(200, { ok: true, data: this.store.requestPrivacyRemoval(user, payload) });
      }
      if (method === 'decidePrivacyRemoval') {
        this.rateLimit(request, 'privacy-decision', 10);
        const data = this.store.decidePrivacyRemoval(user, payload);
        if (data.approved) {
          this.state.storage.sql.exec('DELETE FROM sessions WHERE user_id=?', data.userId);
          this.state.storage.sql.exec('DELETE FROM push_subscriptions WHERE user_id=?', data.userId);
        }
        return json(200, { ok: true, data });
      }
      if (method === 'retentionPreview') return json(200, { ok: true, data: this.store.retentionPreview(user, payload) });
      if (method === 'applyRetention') {
        this.rateLimit(request, 'retention', 5);
        return json(200, { ok: true, data: this.store.applyRetention(user, payload) });
      }
      if (method === 'complaintPurgePreview') return json(200, { ok: true, data: this.store.complaintPurgePreview(user) });
      if (method === 'purgeComplaints') {
        this.rateLimit(request, 'purge-complaints', 3);
        return json(200, { ok: true, data: this.store.purgeComplaints(user, payload) });
      }
      if (method === 'create' && user.role === 'citizen' && mailReady(this.env) && !user.emailVerified) throw new Error('Verify your email before submitting a complaint. Open Account security to resend the link.');
      const notificationsBefore = this.state.storage.sql.exec('SELECT COALESCE(MAX(id),0) AS id FROM notifications').toArray()[0].id;
      let data;
      switch (method) {
        case 'snapshot': data = this.store.snapshot(user); break;
        case 'performance': data = this.store.performance(user); break;
        case 'requestReopen': data = this.store.requestReopen(user, payload); break;
        case 'decideReopen': data = this.store.decideReopen(user, payload); break;
        case 'readNotification': data = this.store.readNotification(user, payload); break;
        case 'areaSummary': data = this.store.areaSummary(user, payload); break;
        case 'wardSummary': data = this.store.wardSummary(user); break;
        case 'setLanguage': data = this.store.setLanguage(user, payload); break;
        case 'listComplaints': data = this.store.listComplaints(user, payload); break;
        case 'complaintDetail': data = this.store.complaintDetail(user, payload); break;
        case 'streetAlertForComplaint': data = this.store.streetAlertForComplaint(user, payload); break;
        case 'streetAlertAction': this.rateLimit(request, 'street-alert-action', 30); data = this.store.streetAlertAction(user, payload); break;
        case 'streetAlertVote': this.rateLimit(request, 'street-alert-vote', 20); data = this.store.streetAlertVote(user, payload); break;
        case 'caseMessage': this.rateLimit(request, 'case-message', 40); data = this.store.postCaseMessage(user, payload); break;
        case 'nearby': data = this.store.nearby(user, payload); break;
        case 'nearbyIssues': data = this.store.nearbyIssues(user, payload); break;
        case 'wardBoundaryStatus': data = this.store.wardBoundaryStatus(user); break;
        case 'wardBoundaryMap': data = this.store.wardBoundaryMap(user, payload); break;
        case 'wardSuggestion': data = this.store.wardSuggestion(user, payload); break;
        case 'importWardBoundaries': this.rateLimit(request, 'ward-import', 5); data = this.store.importWardBoundaries(user, payload); break;
        case 'workQueue': data = this.store.workQueue(user, payload); break;
        case 'missionCandidates': data = this.store.missionCandidates(user, payload); break;
        case 'listMissions': data = this.store.listMissions(user, payload); break;
        case 'missionDetail': data = this.store.missionDetail(user, payload); break;
        case 'createMission': this.rateLimit(request, 'mission-create', 20); data = this.store.createMission(user, payload); break;
        case 'missionAction': this.rateLimit(request, 'mission-action', 40); data = this.store.missionAction(user, payload); break;
        case 'assignWork': data = this.store.assignWork(user, payload); break;
        case 'setWorkPlan': data = this.store.setWorkPlan(user, payload); break;
        case 'operationsHealth': data = { ...this.store.operationsHealth(user), databaseBytes: this.state.storage.sql.databaseSize }; break;
        case 'recordRecoveryCheck': data = this.store.recordRecoveryCheck(user, payload); break;
        case 'recordManualBackup': data = this.store.recordManualBackup(user); break;
        case 'create': this.rateLimit(request, 'complaint', 8); await verifyTurnstile(this.env, payload.turnstileToken, request.headers.get('x-civic-ip')); data = this.store.createComplaint(user, payload); break;
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
      if (['action','feedback','requestReopen','decideReopen','caseMessage','missionAction'].includes(method)) this.state.waitUntil(this.deliverNotifications(notificationsBefore));
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
      headers.delete('x-civic-backup');
      headers.set('x-civic-ip', request.headers.get('CF-Connecting-IP') || 'local');
      const forwarded = new Request(request, { headers });
      return env.CIVIC_STATE.get(env.CIVIC_STATE.idFromName('dhaka')).fetch(forwarded);
    }
    const response = await env.ASSETS.fetch(request);
    const headers = new Headers(response.headers);
    for (const [key, value] of Object.entries(safeHeaders)) headers.set(key, value);
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  },
  async scheduled(_controller, env) {
    if (env.BOOTSTRAP_KEY) {
      const stub = env.CIVIC_STATE.get(env.CIVIC_STATE.idFromName('dhaka'));
      const response = await stub.fetch(new Request('https://internal.civicpulse/internal/escalate', { headers: { 'x-civic-cron': env.BOOTSTRAP_KEY } }));
      if (!response.ok) console.error('Deadline escalation failed:', response.status);
    }
    if (new Date(_controller.scheduledTime || Date.now()).getUTCHours() !== 18) return;
    if (!env.BACKUP_BUCKET || !env.BACKUP_ENCRYPTION_KEY) return;
    const keyBytes = Uint8Array.from(atob(env.BACKUP_ENCRYPTION_KEY), char => char.charCodeAt(0));
    if (keyBytes.length !== 32) throw new Error('BACKUP_ENCRYPTION_KEY must be 32 random bytes encoded as base64.');
    const stub = env.CIVIC_STATE.get(env.CIVIC_STATE.idFromName('dhaka'));
    const snapshotResponse = await stub.fetch(new Request('https://internal.civicpulse/internal/backup', { headers: { 'x-civic-backup': env.BACKUP_ENCRYPTION_KEY } }));
    if (!snapshotResponse.ok) throw new Error('Could not read the CivicPulse backup snapshot.');
    const snapshot = await snapshotResponse.json();
    if (!snapshot.ok || snapshot.data?.format !== 'civicpulse-offsite-v1') throw new Error('The CivicPulse backup snapshot is incomplete.');
    const plaintext = new TextEncoder().encode(JSON.stringify(snapshot.data));
    const nonce = crypto.getRandomValues(new Uint8Array(12));
    const key = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['encrypt']);
    const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, plaintext));
    const body = new Uint8Array(6 + nonce.length + encrypted.length);
    body.set(new TextEncoder().encode('CPR2V1'));
    body.set(nonce, 6);
    body.set(encrypted, 18);
    const objectKey = `civicpulse-dhaka/${new Date().toISOString().slice(0, 10)}.cpr2`;
    await env.BACKUP_BUCKET.put(objectKey, body, { httpMetadata: { contentType: 'application/octet-stream' } });
    await stub.fetch(new Request('https://internal.civicpulse/internal/backup-complete', { headers: { 'x-civic-backup': env.BACKUP_ENCRYPTION_KEY, 'x-civic-backup-name': objectKey } }));
    if (typeof env.BACKUP_BUCKET.list === 'function') {
      const listed = await env.BACKUP_BUCKET.list({ prefix: 'civicpulse-dhaka/', limit: 1000 });
      const backups = listed.objects.filter(object => /^civicpulse-dhaka\/\d{4}-\d{2}-\d{2}\.cpr2$/.test(object.key)).sort((a, b) => b.key.localeCompare(a.key));
      const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      for (const old of backups.slice(3)) if (old.key.slice(17, 27) < cutoff) await env.BACKUP_BUCKET.delete(old.key);
    }
    console.log(`Encrypted offsite backup stored at ${objectKey}; bytes=${body.length}`);
  },
};
