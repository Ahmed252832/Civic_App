const crypto = require('node:crypto');
const WARD_LIMITS = require('./wards.json');
const { parseWardFeatures, geometryContains, boundaryDistanceMeters } = require('./ward-geometry.cjs');
const SEVERITIES = ['Low', 'Medium', 'High', 'Critical'];
const ACTIVE = ['Submitted', 'Under Review', 'Verified', 'Assigned', 'In Progress', 'Reopened'];
const BACKUP_TABLES = ['departments', 'categories', 'users', 'complaints', 'updates', 'cycles', 'feedback', 'notifications', 'escalation_events', 'citizen_reminders', 'reopen_requests', 'privacy_requests', 'audit', 'case_messages', 'ward_boundaries', 'recovery_checks', 'operational_events'];
const validWard = value => {
  const match = /^(DNCC|DSCC)-(\d{2})$/.exec(String(value || ''));
  return match && Number(match[2]) >= 1 && Number(match[2]) <= WARD_LIMITS[match[1]];
};
const wardLabel = code => `${code.slice(0, 4)} Ward ${code.slice(5)}`;
// Operational pilot boundary for Dhaka city; replace with an approved city polygon before municipal use.
const DHAKA_BOUNDS = { south: 23.65, north: 23.94, west: 90.30, east: 90.54 };
const inDhaka = (latitude, longitude) => latitude >= DHAKA_BOUNDS.south && latitude <= DHAKA_BOUNDS.north && longitude >= DHAKA_BOUNDS.west && longitude <= DHAKA_BOUNDS.east;
const haversineMeters = (a, b) => {
  const toRad = n => n * Math.PI / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
};
const hashPassword = password => {
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}:${crypto.scryptSync(password, salt, 64).toString('hex')}`;
};
const verifyPassword = (password, saved) => {
  if (!saved || !saved.includes(':')) return false;
  const [salt, hash] = saved.split(':');
  const candidate = crypto.scryptSync(password, salt, 64);
  const original = Buffer.from(hash, 'hex');
  return original.length === candidate.length && crypto.timingSafeEqual(original, candidate);
};
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const base32 = bytes => {
  let bits = 0, value = 0, output = '';
  for (const byte of bytes) { value = (value << 8) | byte; bits += 8; while (bits >= 5) { output += BASE32[(value >>> (bits -= 5)) & 31]; } }
  if (bits) output += BASE32[(value << (5 - bits)) & 31];
  return output;
};
const unbase32 = value => {
  let bits = 0, number = 0; const output = [];
  for (const character of value) { const digit = BASE32.indexOf(character); if (digit < 0) throw new Error('Invalid authenticator secret.'); number = (number << 5) | digit; bits += 5; if (bits >= 8) { output.push((number >>> (bits -= 8)) & 255); number &= (1 << bits) - 1; } }
  return Buffer.from(output);
};
const sealMfa = (secret, password) => {
  const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12);
  const key = crypto.scryptSync(password, salt, 32);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return Buffer.concat([salt, iv, cipher.getAuthTag(), body]).toString('base64');
};
const openMfa = (sealed, password) => {
  const bytes = Buffer.from(sealed, 'base64');
  if (bytes.length < 45) throw new Error('Authenticator setup is invalid.');
  const key = crypto.scryptSync(password, bytes.subarray(0, 16), 32);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, bytes.subarray(16, 28));
  decipher.setAuthTag(bytes.subarray(28, 44));
  return Buffer.concat([decipher.update(bytes.subarray(44)), decipher.final()]).toString('utf8');
};
const totpValue = (secret, step) => {
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(step));
  const digest = crypto.createHmac('sha1', unbase32(secret)).update(counter).digest();
  const offset = digest[digest.length - 1] & 15;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(6, '0');
};
const matchingTotpStep = (secret, code, lastStep = -1) => {
  if (typeof code !== 'string' || !/^\d{6}$/.test(code)) return null;
  const current = Math.floor(Date.now() / 30000);
  for (const step of [current - 1, current, current + 1]) {
    if (step > lastStep && crypto.timingSafeEqual(Buffer.from(totpValue(secret, step)), Buffer.from(code))) return step;
  }
  return null;
};
const demand = (condition, message) => { if (!condition) throw new Error(message); };
const safeText = (value, max = 500) => String(value ?? '').trim().slice(0, max);

function createStore(adapter, options = {}) {
  const { all, one, run, id, transact, persist, close } = adapter;
  run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
    role TEXT NOT NULL, area TEXT NOT NULL DEFAULT '', department_id INTEGER REFERENCES departments(id), verified_area INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
  run(`CREATE TABLE IF NOT EXISTS departments (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, active INTEGER NOT NULL DEFAULT 1)`);
  if (!all('PRAGMA table_info(users)').some(column => column.name === 'department_id')) run('ALTER TABLE users ADD COLUMN department_id INTEGER REFERENCES departments(id)');
  run(`CREATE TABLE IF NOT EXISTS categories (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, department_id INTEGER REFERENCES departments(id), active INTEGER NOT NULL DEFAULT 1)`);
  if (!all('PRAGMA table_info(categories)').some(column => column.name === 'resolution_hours')) run('ALTER TABLE categories ADD COLUMN resolution_hours INTEGER NOT NULL DEFAULT 168');
  run(`CREATE TABLE IF NOT EXISTS complaints (
    id INTEGER PRIMARY KEY, code TEXT UNIQUE, reporter_id INTEGER NOT NULL REFERENCES users(id),
    title TEXT NOT NULL, description TEXT NOT NULL, category_id INTEGER NOT NULL REFERENCES categories(id),
    area TEXT NOT NULL, latitude REAL NOT NULL, longitude REAL NOT NULL, severity TEXT NOT NULL,
    priority TEXT NOT NULL DEFAULT 'Normal', status TEXT NOT NULL DEFAULT 'Submitted',
    department_id INTEGER REFERENCES departments(id), image TEXT, completion_image TEXT,
    duplicate_of INTEGER REFERENCES complaints(id), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, resolved_at TEXT)`);
  const complaintColumns = new Set(all('PRAGMA table_info(complaints)').map(column => column.name));
  if (!complaintColumns.has('resolution_due_at')) run('ALTER TABLE complaints ADD COLUMN resolution_due_at TEXT');
  if (!complaintColumns.has('closed_at')) run('ALTER TABLE complaints ADD COLUMN closed_at TEXT');
  if (!complaintColumns.has('recurrence_of')) run('ALTER TABLE complaints ADD COLUMN recurrence_of INTEGER REFERENCES complaints(id)');
  if (!complaintColumns.has('finished_at')) run('ALTER TABLE complaints ADD COLUMN finished_at TEXT');
  if (!complaintColumns.has('escalation_level')) run('ALTER TABLE complaints ADD COLUMN escalation_level INTEGER NOT NULL DEFAULT 0');
  if (!complaintColumns.has('retained_at')) run('ALTER TABLE complaints ADD COLUMN retained_at TEXT');
  if (!complaintColumns.has('place_name')) run('ALTER TABLE complaints ADD COLUMN place_name TEXT');
  if (!complaintColumns.has('ward_code')) run('ALTER TABLE complaints ADD COLUMN ward_code TEXT');
  if (!complaintColumns.has('assignee_id')) run('ALTER TABLE complaints ADD COLUMN assignee_id INTEGER REFERENCES users(id)');
  if (!complaintColumns.has('accepted_at')) run('ALTER TABLE complaints ADD COLUMN accepted_at TEXT');
  if (!complaintColumns.has('blocked_reason')) run('ALTER TABLE complaints ADD COLUMN blocked_reason TEXT');
  if (!complaintColumns.has('next_action_at')) run('ALTER TABLE complaints ADD COLUMN next_action_at TEXT');
  run(`CREATE TABLE IF NOT EXISTS ward_boundaries (
    id INTEGER PRIMARY KEY, code TEXT NOT NULL UNIQUE, geometry TEXT NOT NULL, south REAL NOT NULL, north REAL NOT NULL,
    west REAL NOT NULL, east REAL NOT NULL, source TEXT NOT NULL, imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
  run('CREATE INDEX IF NOT EXISTS ward_boundaries_extent ON ward_boundaries(south,north,west,east)');
  run(`CREATE TABLE IF NOT EXISTS recovery_checks (
    id INTEGER PRIMARY KEY, actor_id INTEGER NOT NULL REFERENCES users(id),
    archive_created_at TEXT NOT NULL, accounts INTEGER NOT NULL, complaints INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
  run(`CREATE TABLE IF NOT EXISTS operational_events (
    id INTEGER PRIMARY KEY, kind TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
  run("UPDATE complaints SET finished_at=updated_at WHERE status='Finished' AND finished_at IS NULL");
  run("UPDATE complaints SET resolution_due_at=(SELECT datetime(complaints.created_at, '+' || COALESCE(k.resolution_hours,168) || ' hours') FROM categories k WHERE k.id=complaints.category_id) WHERE resolution_due_at IS NULL");
  run('CREATE TABLE IF NOT EXISTS area_counts (area_key TEXT PRIMARY KEY, total INTEGER NOT NULL)');
  if (!one('SELECT area_key FROM area_counts LIMIT 1') && one('SELECT COUNT(*) AS n FROM complaints').n > 0) {
    run('INSERT INTO area_counts (area_key,total) SELECT lower(trim(area)),COUNT(*) FROM complaints GROUP BY lower(trim(area))');
  }
  run(`CREATE TABLE IF NOT EXISTS updates (
    id INTEGER PRIMARY KEY, complaint_id INTEGER NOT NULL REFERENCES complaints(id), actor_id INTEGER NOT NULL REFERENCES users(id),
    action TEXT NOT NULL, old_status TEXT, new_status TEXT, note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
  run(`CREATE TABLE IF NOT EXISTS cycles (
    id INTEGER PRIMARY KEY, complaint_id INTEGER NOT NULL REFERENCES complaints(id), number INTEGER NOT NULL,
    resolved_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, reopened_at TEXT, closed_at TEXT,
    UNIQUE(complaint_id, number))`);
  const cycleColumns = new Set(all('PRAGMA table_info(cycles)').map(column => column.name));
  if (!cycleColumns.has('completion_image')) run('ALTER TABLE cycles ADD COLUMN completion_image TEXT');
  if (!cycleColumns.has('completion_note')) run("ALTER TABLE cycles ADD COLUMN completion_note TEXT NOT NULL DEFAULT ''");
  run('UPDATE cycles SET completion_image=(SELECT completion_image FROM complaints WHERE complaints.id=cycles.complaint_id) WHERE completion_image IS NULL AND id=(SELECT MAX(id) FROM cycles y WHERE y.complaint_id=cycles.complaint_id)');
  run("UPDATE complaints SET closed_at=COALESCE((SELECT MAX(y.closed_at) FROM cycles y WHERE y.complaint_id=complaints.id),updated_at) WHERE closed_at IS NULL AND status='Closed'");
  run(`CREATE TABLE IF NOT EXISTS feedback (
    id INTEGER PRIMARY KEY, complaint_id INTEGER NOT NULL REFERENCES complaints(id), cycle_id INTEGER NOT NULL REFERENCES cycles(id),
    user_id INTEGER NOT NULL REFERENCES users(id), rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
    resolution TEXT NOT NULL, comment TEXT NOT NULL DEFAULT '', local INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(cycle_id, user_id))`);
  run(`CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), complaint_id INTEGER NOT NULL REFERENCES complaints(id),
    title TEXT NOT NULL, message TEXT NOT NULL, read_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
  run(`CREATE TABLE IF NOT EXISTS citizen_reminders (
    id INTEGER PRIMARY KEY, cycle_id INTEGER NOT NULL REFERENCES cycles(id), complaint_id INTEGER NOT NULL REFERENCES complaints(id),
    stage INTEGER NOT NULL CHECK(stage IN (1,2)), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(cycle_id,stage))`);
  run('CREATE INDEX IF NOT EXISTS citizen_reminders_complaint ON citizen_reminders(complaint_id,id)');
  run(`CREATE TABLE IF NOT EXISTS case_messages (
    id INTEGER PRIMARY KEY, complaint_id INTEGER NOT NULL REFERENCES complaints(id), sender_id INTEGER NOT NULL REFERENCES users(id),
    body TEXT NOT NULL DEFAULT '', image TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
  run(`CREATE TABLE IF NOT EXISTS escalation_events (
    id INTEGER PRIMARY KEY, complaint_id INTEGER NOT NULL REFERENCES complaints(id), stage TEXT NOT NULL,
    message TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
  run(`CREATE TABLE IF NOT EXISTS reopen_requests (
    id INTEGER PRIMARY KEY, complaint_id INTEGER NOT NULL REFERENCES complaints(id), user_id INTEGER NOT NULL REFERENCES users(id),
    reason TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'Pending', decision_note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, decided_at TEXT)`);
  run(`CREATE TABLE IF NOT EXISTS audit (
    id INTEGER PRIMARY KEY, actor_id INTEGER NOT NULL REFERENCES users(id), action TEXT NOT NULL,
    target_type TEXT NOT NULL, target_id INTEGER NOT NULL, detail TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
  run('CREATE TABLE IF NOT EXISTS backup_access (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), expires_at INTEGER NOT NULL)');
  if (!all('PRAGMA table_info(users)').some(column => column.name === 'email_verified')) run('ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0');
  const userColumns = new Set(all('PRAGMA table_info(users)').map(column => column.name));
  if (!userColumns.has('mfa_secret')) run('ALTER TABLE users ADD COLUMN mfa_secret TEXT');
  if (!userColumns.has('mfa_pending')) run('ALTER TABLE users ADD COLUMN mfa_pending TEXT');
  if (!userColumns.has('mfa_pending_expires')) run('ALTER TABLE users ADD COLUMN mfa_pending_expires INTEGER');
  if (!userColumns.has('mfa_last_step')) run('ALTER TABLE users ADD COLUMN mfa_last_step INTEGER NOT NULL DEFAULT -1');
  if (!userColumns.has('language')) run("ALTER TABLE users ADD COLUMN language TEXT NOT NULL DEFAULT 'en'");
  run(`CREATE TABLE IF NOT EXISTS privacy_requests (
    id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), status TEXT NOT NULL DEFAULT 'Pending',
    reason TEXT NOT NULL DEFAULT '', decision_note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    decided_at TEXT)`);
  run('CREATE INDEX IF NOT EXISTS privacy_requests_user ON privacy_requests(user_id,id)');
  run('CREATE TABLE IF NOT EXISTS account_tokens (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), purpose TEXT NOT NULL, issued_at INTEGER NOT NULL, expires_at INTEGER NOT NULL)');
  run('CREATE INDEX IF NOT EXISTS account_tokens_user_purpose ON account_tokens(user_id,purpose)');
  run('CREATE INDEX IF NOT EXISTS complaints_reporter_id ON complaints(reporter_id,id)');
  run('CREATE INDEX IF NOT EXISTS complaints_department_id ON complaints(department_id,id)');
  run('CREATE INDEX IF NOT EXISTS complaints_status_id ON complaints(status,id)');
  run('CREATE INDEX IF NOT EXISTS complaints_ward_id ON complaints(ward_code,id)');
  run('CREATE INDEX IF NOT EXISTS complaints_resolution_due ON complaints(closed_at,resolution_due_at)');
  run('CREATE INDEX IF NOT EXISTS complaints_recurrence_of ON complaints(recurrence_of)');
  run('CREATE INDEX IF NOT EXISTS complaints_category_resolution ON complaints(category_id,status,resolved_at)');
  run('CREATE INDEX IF NOT EXISTS complaints_geo ON complaints(latitude,longitude)');
  run('CREATE INDEX IF NOT EXISTS updates_complaint_id ON updates(complaint_id,id)');
  run('CREATE INDEX IF NOT EXISTS replay_complaints_ward_date ON complaints(ward_code,created_at)');
  run('CREATE INDEX IF NOT EXISTS replay_updates_case_date ON updates(complaint_id,created_at,id)');
  run('CREATE INDEX IF NOT EXISTS feedback_complaint_id ON feedback(complaint_id,id)');
  run('CREATE INDEX IF NOT EXISTS notifications_user_id ON notifications(user_id,id)');
  run('CREATE INDEX IF NOT EXISTS case_messages_complaint_id ON case_messages(complaint_id,id)');
  run('CREATE INDEX IF NOT EXISTS cycles_complaint_id ON cycles(complaint_id,id)');
  run('CREATE INDEX IF NOT EXISTS reopen_requests_complaint_id ON reopen_requests(complaint_id,id)');
  run('CREATE INDEX IF NOT EXISTS escalation_events_complaint_id ON escalation_events(complaint_id,id)');

  const log = (actor, complaint, action, oldStatus, newStatus, note = '') => {
    run('INSERT INTO updates (complaint_id,actor_id,action,old_status,new_status,note) VALUES (?,?,?,?,?,?)', [complaint, actor, action, oldStatus, newStatus, note]);
    run('INSERT INTO audit (actor_id,action,target_type,target_id,detail) VALUES (?,?,?,?,?)', [actor, action, 'complaint', complaint, note]);
  };
  const changeStatus = (complaint, actor, action, status, note = '') => {
    run('UPDATE complaints SET status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?', [status, complaint.id]);
    log(actor.id, complaint.id, action, complaint.status, status, note);
  };
  const scrubCase = (complaintId, area) => {
    run('UPDATE area_counts SET total=total-1 WHERE area_key=lower(trim(?))', [area]);
    run('DELETE FROM area_counts WHERE area_key=lower(trim(?)) AND total<=0', [area]);
    run("INSERT INTO area_counts (area_key,total) VALUES ('dhaka',1) ON CONFLICT(area_key) DO UPDATE SET total=total+1");
    run("UPDATE complaints SET title='Archived citizen report',description='Personal case details removed.',area='Dhaka',place_name=NULL,blocked_reason=NULL,latitude=round(latitude,2),longitude=round(longitude,2),image=NULL,completion_image=NULL,retained_at=CURRENT_TIMESTAMP WHERE id=?", [complaintId]);
    run("UPDATE cycles SET completion_image=NULL,completion_note='' WHERE complaint_id=?", [complaintId]);
    run("UPDATE updates SET note='' WHERE complaint_id=?", [complaintId]);
    run("UPDATE feedback SET comment='',local=0 WHERE complaint_id=?", [complaintId]);
    run("UPDATE reopen_requests SET reason='',decision_note='' WHERE complaint_id=?", [complaintId]);
    run("UPDATE notifications SET title='Case updated',message='Personal case details removed.' WHERE complaint_id=?", [complaintId]);
    run("UPDATE case_messages SET body='',image=NULL WHERE complaint_id=?", [complaintId]);
    run("UPDATE escalation_events SET message='Case deadline recorded.' WHERE complaint_id=?", [complaintId]);
    run("UPDATE audit SET detail='' WHERE target_type='complaint' AND target_id=?", [complaintId]);
  };
  const findComplaint = complaintId => {
    const complaint = one('SELECT * FROM complaints WHERE id=?', [Number(complaintId)]);
    demand(complaint, 'Complaint not found.');
    return complaint;
  };
  const requireRole = (user, roles) => demand(user && roles.includes(user.role), 'You do not have permission for this action.');
  const pageSize = value => Math.min(50, Math.max(1, Number.isInteger(Number(value)) ? Number(value) : 25));
  const cursorId = value => value && Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;
  const visibility = user => {
    if (['admin','superadmin'].includes(user.role)) return { sql: '1=1', params: [] };
    const publicCase = "c.status NOT IN ('Submitted','Under Review','Rejected','Duplicate')";
    if (user.role === 'staff') return { sql: `(c.department_id=? OR ${publicCase})`, params: [user.departmentId || -1] };
    return { sql: 'c.reporter_id=?', params: [user.id] };
  };
  const privateCase = (user, row) => ['admin','superadmin'].includes(user.role) || row.reporter_id === user.id || (user.role === 'staff' && row.department_id === user.departmentId);
  const safeCase = (user, row) => {
    const exact = privateCase(user, row) && !row.retained_at;
    const visible = exact ? row : { ...row, reporter_id: null, reporter: 'Resident', description: '', image: null, completion_image: null, place_name: null,
      latitude: Math.round(row.latitude * 1000) / 1000, longitude: Math.round(row.longitude * 1000) / 1000 };
    const workFields = user.role === 'citizen' ? { assignee_id: null, accepted_at: null, blocked_reason: null, next_action_at: null } : {};
    return { ...visible, ...workFields, location_exact: exact, recurrence_flag: Boolean(row.recurrence_of), recurrence_of: user.role === 'citizen' || !exact ? null : row.recurrence_of };
  };

  if (!one('SELECT id FROM categories LIMIT 1')) {
    transact(() => {
      for (const name of ['Road Maintenance', 'Waste Management', 'Drainage & Water', 'Electrical Services']) run('INSERT INTO departments (name) VALUES (?)', [name]);
      for (const [name, department] of [
        ['Road Damage', 1], ['Potholes', 1], ['Garbage / Waste', 2], ['Drainage Problems', 3],
        ['Water Leakage', 3], ['Flooding / Waterlogging', 3], ['Streetlight Failure', 4],
        ['Public Safety', null], ['Other', null]
      ]) run('INSERT INTO categories (name, department_id) VALUES (?,?)', [name, department]);
    });
  }
  persist();

  const publicUser = row => row && ({ id: row.id, name: row.name, email: row.email, role: row.role, area: row.area, language: row.language || 'en', departmentId: row.department_id || null, verifiedArea: Boolean(row.verified_area), emailVerified: Boolean(row.email_verified), mfaEnabled: Boolean(row.mfa_secret), active: Boolean(row.active) });
  const store = {
    setupRequired() { return !one("SELECT id FROM users WHERE role='superadmin' LIMIT 1"); },
    bootstrapAdmin(payload) {
      demand(!one("SELECT id FROM users WHERE role='superadmin' LIMIT 1"), 'The platform owner is already configured.');
      const name = safeText(payload.name, 80), email = safeText(payload.email, 200).toLowerCase();
      const password = String(payload.password || '');
      demand(name.length >= 3, 'Enter your full name.');
      demand(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email), 'Enter a valid email address.');
      demand(password.length >= 12 && password.length <= 128, 'Use a password of 12 to 128 characters.');
      return transact(() => {
        run('INSERT INTO users (name,email,password_hash,role,area) VALUES (?,?,?,?,?)', [name,email,hashPassword(password),'superadmin','Dhaka']);
        return publicUser(one('SELECT * FROM users WHERE id=?', [id()]));
      });
    },
    register(payload) {
      const name = safeText(payload.name, 80), email = safeText(payload.email, 200).toLowerCase();
      const area = safeText(payload.area, 100), password = String(payload.password || '');
      demand(name.length >= 2, 'Enter your full name.');
      demand(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email), 'Enter a valid email address.');
      const ward = /^(DNCC|DSCC) Ward (\d{2})$/.exec(area);
      demand(ward && validWard(`${ward[1]}-${ward[2]}`), 'Choose a valid Dhaka North or South ward.');
      demand(password.length >= 10 && password.length <= 128, 'Use a password of 10 to 128 characters.');
      demand(!one('SELECT id FROM users WHERE lower(email)=lower(?)', [email]), 'This email is already registered.');
      return transact(() => {
        run('INSERT INTO users (name,email,password_hash,role,area,verified_area) VALUES (?,?,?,?,?,0)', [name,email,hashPassword(password),'citizen',area]);
        return publicUser(one('SELECT * FROM users WHERE id=?', [id()]));
      });
    },
    areaSummary(user, payload = {}) {
      demand(user, 'Please sign in.');
      const query = safeText(payload.query, 80);
      const cityTotal = one('SELECT COALESCE(SUM(total),0) AS n FROM area_counts').n;
      const total = query ? one('SELECT COALESCE(SUM(total),0) AS n FROM area_counts WHERE instr(area_key,lower(?)) > 0', [query]).n : cityTotal;
      return { total, cityTotal, query };
    },
    login(email, password, code) {
      demand(typeof email === 'string' && email.length <= 200 && typeof password === 'string' && password.length <= 128, 'Invalid email or password.');
      const user = one('SELECT * FROM users WHERE lower(email)=lower(?) AND active=1', [safeText(email, 200)]);
      demand(user && verifyPassword(String(password || ''), user.password_hash), 'Invalid email or password.');
      if (!user.mfa_secret) return publicUser(user);
      demand(code, 'Authenticator code required.');
      let secret;
      try { secret = openMfa(user.mfa_secret, password); } catch { throw new Error('Invalid email or password.'); }
      return transact(() => {
        const current = one('SELECT mfa_last_step FROM users WHERE id=?', [user.id]);
        const step = matchingTotpStep(secret, code, Number(current.mfa_last_step ?? -1));
        demand(step !== null, 'Invalid authenticator code.');
        run('UPDATE users SET mfa_last_step=? WHERE id=?', [step, user.id]);
        return publicUser(user);
      });
    },
    userById(userId) { return publicUser(one('SELECT * FROM users WHERE id=? AND active=1', [userId])); },
    findActiveEmail(email) {
      if (typeof email !== 'string' || email.length > 200) return null;
      return publicUser(one('SELECT * FROM users WHERE lower(email)=lower(?) AND active=1', [safeText(email, 200)]));
    },
    issueAccountToken(userId, purpose) {
      demand(['verify','reset'].includes(purpose), 'Unknown account action.');
      const user = one('SELECT id,email,email_verified FROM users WHERE id=? AND active=1', [userId]);
      demand(user, 'Account not found.');
      if (purpose === 'verify') demand(!user.email_verified, 'Email is already verified.');
      const now = Date.now();
      const recent = one('SELECT issued_at FROM account_tokens WHERE user_id=? AND purpose=?', [userId,purpose]);
      demand(!recent || now - recent.issued_at >= 60_000, 'Please wait a minute before requesting another email.');
      const token = crypto.randomBytes(32).toString('base64url');
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      transact(() => {
        run('DELETE FROM account_tokens WHERE user_id=? AND purpose=?', [userId,purpose]);
        run('DELETE FROM account_tokens WHERE expires_at<=?', [now]);
        run('INSERT INTO account_tokens (token_hash,user_id,purpose,issued_at,expires_at) VALUES (?,?,?,?,?)', [tokenHash,userId,purpose,now,now + (purpose === 'verify' ? 24 * 60 * 60 * 1000 : 30 * 60 * 1000)]);
      });
      return { token, email: user.email };
    },
    consumeAccountToken(token, purpose, newPassword) {
      demand(typeof token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(token), 'Invalid or expired link.');
      demand(['verify','reset','recovery'].includes(purpose), 'Unknown account action.');
      if (purpose !== 'verify') demand(typeof newPassword === 'string' && newPassword.length >= 12 && newPassword.length <= 128, 'Use a password of 12 to 128 characters.');
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      return transact(() => {
        const row = one('SELECT t.user_id FROM account_tokens t JOIN users u ON u.id=t.user_id WHERE t.token_hash=? AND t.purpose=? AND t.expires_at>? AND u.active=1', [tokenHash,purpose,Date.now()]);
        demand(row, 'Invalid or expired link.');
        if (purpose === 'verify') run('UPDATE users SET email_verified=1 WHERE id=?', [row.user_id]);
        else {
          run('UPDATE users SET password_hash=?,mfa_secret=NULL,mfa_pending=NULL,mfa_pending_expires=NULL,mfa_last_step=-1 WHERE id=?', [hashPassword(newPassword),row.user_id]);
          if (purpose === 'reset') run("DELETE FROM account_tokens WHERE user_id=? AND purpose='recovery'", [row.user_id]);
        }
        run('DELETE FROM account_tokens WHERE user_id=? AND purpose=?', [row.user_id,purpose]);
        run('INSERT INTO audit (actor_id,action,target_type,target_id,detail) VALUES (?,?,?,?,?)', [row.user_id,purpose === 'verify' ? 'Verified email' : 'Recovered password','user',row.user_id,purpose === 'recovery' ? 'Recovery code used' : '']);
        return row.user_id;
      });
    },
    issueRecoveryCode(user, password) {
      demand(user, 'Please sign in.');
      const saved = one('SELECT password_hash FROM users WHERE id=? AND active=1', [user.id]);
      demand(typeof password === 'string' && password.length <= 128 && saved && verifyPassword(password, saved.password_hash), 'Current password is incorrect.');
      const token = crypto.randomBytes(32).toString('base64url');
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      transact(() => {
        run("DELETE FROM account_tokens WHERE user_id=? AND purpose='recovery'", [user.id]);
        run('INSERT INTO account_tokens (token_hash,user_id,purpose,issued_at,expires_at) VALUES (?,?,?,?,?)', [tokenHash,user.id,'recovery',Date.now(),Date.now() + 365 * 24 * 60 * 60 * 1000]);
        run('INSERT INTO audit (actor_id,action,target_type,target_id,detail) VALUES (?,?,?,?,?)', [user.id,'Generated recovery code','user',user.id,'']);
      });
      return token;
    },
    changePassword(user, payload) {
      demand(user, 'Please sign in.');
      const current = String(payload.currentPassword || '');
      const next = String(payload.newPassword || '');
      demand(current.length <= 128 && next.length >= 12 && next.length <= 128, 'Use a new password of 12 to 128 characters.');
      const saved = one('SELECT password_hash,mfa_secret FROM users WHERE id=? AND active=1', [user.id]);
      demand(saved && verifyPassword(current, saved.password_hash), 'Current password is incorrect.');
      demand(current !== next, 'Choose a different password.');
      return transact(() => {
        const rewrapped = saved.mfa_secret ? sealMfa(openMfa(saved.mfa_secret, current), next) : null;
        run('UPDATE users SET password_hash=?,mfa_secret=?,mfa_pending=NULL,mfa_pending_expires=NULL WHERE id=?', [hashPassword(next),rewrapped,user.id]);
        run("DELETE FROM account_tokens WHERE user_id=? AND purpose='recovery'", [user.id]);
        run('INSERT INTO audit (actor_id,action,target_type,target_id,detail) VALUES (?,?,?,?,?)', [user.id,'Changed password','user',user.id,'']);
        return true;
      });
    },
    beginMfa(user, password) {
      requireRole(user, ['admin','superadmin']);
      const saved = one('SELECT password_hash,mfa_secret,email FROM users WHERE id=? AND active=1', [user.id]);
      demand(saved && typeof password === 'string' && password.length <= 128 && verifyPassword(password, saved.password_hash), 'Current password is incorrect.');
      demand(!saved.mfa_secret, 'Authenticator sign-in is already enabled.');
      const secret = base32(crypto.randomBytes(20));
      transact(() => run('UPDATE users SET mfa_pending=?,mfa_pending_expires=? WHERE id=?', [sealMfa(secret, password),Date.now() + 10 * 60_000,user.id]));
      return { secret, uri: `otpauth://totp/${encodeURIComponent(`CivicPulse:${saved.email}`)}?secret=${secret}&issuer=CivicPulse&algorithm=SHA1&digits=6&period=30` };
    },
    confirmMfa(user, payload) {
      requireRole(user, ['admin','superadmin']);
      return transact(() => {
        const saved = one('SELECT password_hash,mfa_secret,mfa_pending,mfa_pending_expires FROM users WHERE id=? AND active=1', [user.id]);
        demand(saved && !saved.mfa_secret && saved.mfa_pending && saved.mfa_pending_expires > Date.now(), 'Authenticator setup expired. Start again.');
        demand(typeof payload.password === 'string' && payload.password.length <= 128 && verifyPassword(payload.password, saved.password_hash), 'Current password is incorrect.');
        let secret;
        try { secret = openMfa(saved.mfa_pending, payload.password); } catch { throw new Error('Current password is incorrect.'); }
        demand(matchingTotpStep(secret, payload.code) !== null, 'Invalid authenticator code. Check your device clock.');
        run('UPDATE users SET mfa_secret=mfa_pending,mfa_pending=NULL,mfa_pending_expires=NULL,mfa_last_step=-1 WHERE id=?', [user.id]);
        run('INSERT INTO audit (actor_id,action,target_type,target_id,detail) VALUES (?,?,?,?,?)', [user.id,'Enabled authenticator','user',user.id,'']);
        return true;
      });
    },
    disableMfa(user, payload) {
      requireRole(user, ['admin','superadmin']);
      return transact(() => {
        const saved = one('SELECT password_hash,mfa_secret FROM users WHERE id=? AND active=1', [user.id]);
        demand(saved && saved.mfa_secret, 'Authenticator sign-in is not enabled.');
        demand(typeof payload.password === 'string' && payload.password.length <= 128 && verifyPassword(payload.password, saved.password_hash), 'Current password is incorrect.');
        let secret;
        try { secret = openMfa(saved.mfa_secret, payload.password); } catch { throw new Error('Current password is incorrect.'); }
        demand(matchingTotpStep(secret, payload.code) !== null, 'Invalid authenticator code.');
        run('UPDATE users SET mfa_secret=NULL,mfa_pending=NULL,mfa_pending_expires=NULL,mfa_last_step=-1 WHERE id=?', [user.id]);
        run('INSERT INTO audit (actor_id,action,target_type,target_id,detail) VALUES (?,?,?,?,?)', [user.id,'Disabled authenticator','user',user.id,'']);
        return true;
      });
    },
    beginBackup(user, payload) {
      requireRole(user, ['superadmin']);
      const password = String(payload.password || '');
      demand(password.length <= 128, 'Invalid password.');
      const saved = one('SELECT password_hash FROM users WHERE id=? AND active=1', [user.id]);
      demand(saved && verifyPassword(password, saved.password_hash), 'Invalid password.');
      const token = crypto.randomBytes(32).toString('base64url');
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      transact(() => {
        run('DELETE FROM backup_access WHERE expires_at<=?', [Date.now()]);
        run('INSERT INTO backup_access (token_hash,user_id,expires_at) VALUES (?,?,?)', [tokenHash,user.id,Date.now() + 30 * 60 * 1000]);
        run('INSERT INTO audit (actor_id,action,target_type,target_id,detail) VALUES (?,?,?,?,?)', [user.id,'Started encrypted backup','user',user.id,'']);
      });
      return { token, tables: BACKUP_TABLES };
    },
    backupPage(user, payload) {
      requireRole(user, ['superadmin']);
      const token = String(payload.token || '');
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      demand(token.length === 43 && one('SELECT token_hash FROM backup_access WHERE token_hash=? AND user_id=? AND expires_at>?', [tokenHash,user.id,Date.now()]), 'Backup access expired. Start again.');
      const table = safeText(payload.table, 30);
      demand(BACKUP_TABLES.includes(table), 'Unknown backup table.');
      const cursor = cursorId(payload.cursor) || 0;
      const limit = table === 'complaints' ? 5 : 50;
      const rows = all(`SELECT * FROM ${table} WHERE id>? ORDER BY id LIMIT ?`, [cursor, limit + 1]);
      const more = rows.length > limit;
      return { rows: rows.slice(0, limit), nextCursor: more ? rows[limit - 1].id : null };
    },
    endBackup(user, payload) {
      requireRole(user, ['superadmin']);
      const tokenHash = crypto.createHash('sha256').update(String(payload.token || '')).digest('hex');
      return transact(() => { run('DELETE FROM backup_access WHERE token_hash=? AND user_id=?', [tokenHash,user.id]); return true; });
    },
    automaticBackupData() {
      return transact(() => ({ format: 'civicpulse-offsite-v1', createdAt: new Date().toISOString(), tables: Object.fromEntries(BACKUP_TABLES.map(table => [table, all(`SELECT * FROM ${table} ORDER BY id`)])) }));
    },
    listComplaints(user, payload = {}) {
      demand(user, 'Please sign in.');
      const limit = pageSize(payload.limit), cursor = cursorId(payload.cursor);
      const search = safeText(payload.query, 80), scope = safeText(payload.scope, 40), status = safeText(payload.status, 30);
      const wardCode = safeText(payload.wardCode, 7);
      const access = visibility(user), where = [access.sql], params = [...access.params];
      if (scope === 'My reports' && user.role === 'citizen') { where.push('c.reporter_id=?'); params.push(user.id); }
      if (scope === 'My area' && user.role === 'citizen') { where.push('c.area=?'); params.push(user.area); }
      if (scope === 'Assigned to my department' && user.role === 'staff') { where.push('c.department_id=?'); params.push(user.departmentId || -1); }
      if (scope === 'Needs verification' && ['admin','superadmin'].includes(user.role)) where.push("c.status='Submitted'");
      if (scope === 'Awaiting feedback' && ['admin','superadmin'].includes(user.role)) where.push("c.status='Awaiting Feedback'");
      if (scope === 'Overdue closure' && ['admin','superadmin'].includes(user.role)) where.push("c.status NOT IN ('Closed','Citizen Verified','Finished','Rejected','Duplicate') AND c.resolution_due_at<CURRENT_TIMESTAMP");
      if (scope === 'Recurring issues' && ['admin','superadmin'].includes(user.role)) where.push('c.recurrence_of IS NOT NULL');
      if (scope === 'Citizen verified' && ['admin','superadmin'].includes(user.role)) where.push("c.status='Citizen Verified'");
      if (scope === 'Finished work' && ['admin','superadmin'].includes(user.role)) where.push("c.status='Finished'");
      if (scope === 'Total reports' && user.role === 'staff') { where.push('c.department_id=?'); params.push(user.departmentId || -1); }
      if (scope === 'Awaiting review' && user.role === 'citizen') where.push("c.status='Submitted'");
      if (scope === 'Open issues' || scope === 'Still open') {
        where.push("c.status NOT IN ('Closed','Citizen Verified','Finished','Rejected','Duplicate')");
        if (user.role === 'staff') { where.push('c.department_id=?'); params.push(user.departmentId || -1); }
      }
      if (scope === 'Resolved' || scope === 'Completed') {
        where.push("c.status IN ('Awaiting Feedback','Citizen Verified','Finished','Closed')");
        if (user.role === 'staff') { where.push('c.department_id=?'); params.push(user.departmentId || -1); }
      }
      if (scope === 'Finished / legacy closed') where.push("c.status IN ('Closed','Finished')");
      if (scope === 'Critical alerts') where.push("c.severity='Critical' AND c.status NOT IN ('Closed','Citizen Verified','Finished','Rejected','Duplicate')");
      if (scope === 'Repair cycles reopened') where.push("c.status='Reopened'");
      if (status && status !== 'All statuses') { where.push('c.status=?'); params.push(status); }
      if (wardCode) { demand(validWard(wardCode), 'Choose a valid ward.'); where.push('c.ward_code=?'); params.push(wardCode); }
      if (search) { where.push('(c.code LIKE ? OR c.title LIKE ? OR c.area LIKE ? OR k.name LIKE ?)'); params.push(...Array(4).fill(`%${search}%`)); }
      const from = 'FROM complaints c JOIN categories k ON k.id=c.category_id LEFT JOIN departments d ON d.id=c.department_id JOIN users u ON u.id=c.reporter_id';
      const total = one(`SELECT COUNT(*) AS n ${from} WHERE ${where.join(' AND ')}`, params).n;
      if (cursor) { where.push('c.id<?'); params.push(cursor); }
      const rows = all(`SELECT c.id,c.code,c.reporter_id,c.title,c.description,c.category_id,c.area,c.ward_code,c.place_name,c.latitude,c.longitude,c.severity,c.priority,c.status,c.department_id,c.duplicate_of,c.recurrence_of,c.resolution_due_at,c.closed_at,c.retained_at,c.created_at,c.updated_at,c.resolved_at,
        k.name AS category,d.name AS department,u.name AS reporter ${from} WHERE ${where.join(' AND ')} ORDER BY c.id DESC LIMIT ?`, [...params, limit + 1]);
      const more = rows.length > limit;
      const complaints = rows.slice(0, limit).map(row => safeCase(user, { ...row, image: null, completion_image: null }));
      return { complaints, nextCursor: more ? complaints.at(-1).id : null, total };
    },
    complaintDetail(user, payload) {
      demand(user, 'Please sign in.');
      const complaint = one(`SELECT c.*,k.name AS category,d.name AS department,u.name AS reporter FROM complaints c
        JOIN categories k ON k.id=c.category_id LEFT JOIN departments d ON d.id=c.department_id JOIN users u ON u.id=c.reporter_id WHERE c.id=?`, [Number(payload.id)]);
      demand(complaint && (privateCase(user, complaint) || (user.role !== 'citizen' && !['Submitted','Under Review','Rejected','Duplicate'].includes(complaint.status))), 'Complaint not found.');
      const fullAccess = ['admin','superadmin'].includes(user.role), privateAccess = privateCase(user, complaint);
      const updates = privateAccess ? all(`SELECT x.*,u.name AS actor,u.role AS actor_role FROM updates x JOIN users u ON u.id=x.actor_id WHERE x.complaint_id=? ORDER BY x.id DESC`, [complaint.id])
        .filter(row => user.role !== 'citizen' || !['Updated work plan','Accepted work','Released work'].includes(row.action))
        .filter(row => fullAccess || row.action !== 'Community feedback' || row.actor_id === user.id)
        .map(row => fullAccess || row.actor_role !== 'citizen' || row.actor_id === user.id ? row : { ...row, actor_id: null, actor: 'Resident' }) : [];
      const cycles = all('SELECT * FROM cycles WHERE complaint_id=? ORDER BY id DESC', [complaint.id]);
      const feedback = all(`SELECT f.*,u.name AS author FROM feedback f JOIN users u ON u.id=f.user_id WHERE f.complaint_id=? ORDER BY f.id DESC`, [complaint.id])
        .map(row => fullAccess || row.user_id === user.id ? row : { ...row, user_id: null, author: 'Resident', comment: '' });
      const recurrence = complaint.recurrence_of && privateAccess && user.role !== 'citizen'
        ? one('SELECT code,title,closed_at FROM complaints WHERE id=?', [complaint.recurrence_of]) : null;
      const escalationEvents = privateAccess ? all('SELECT * FROM escalation_events WHERE complaint_id=? ORDER BY id DESC', [complaint.id]) : [];
      const reopenRequests = (fullAccess || (user.role === 'citizen' && complaint.reporter_id === user.id))
        ? all('SELECT * FROM reopen_requests WHERE complaint_id=? ORDER BY id DESC', [complaint.id]) : [];
      const messages = privateAccess && !complaint.retained_at ? all(`SELECT m.id,m.complaint_id,m.sender_id,m.body,m.image,m.created_at,u.name AS sender,u.role AS sender_role
        FROM case_messages m JOIN users u ON u.id=m.sender_id WHERE m.complaint_id=? ORDER BY m.id DESC LIMIT 200`, [complaint.id]).reverse() : [];
      const includeImages = payload.includeImages !== false;
      return { complaint: safeCase(user, includeImages ? complaint : { ...complaint, image: null, completion_image: null }), recurrence, updates,
        cycles: includeImages ? cycles : cycles.map(row => ({ ...row, completion_image: null })), feedback, escalationEvents, reopenRequests,
        messages: includeImages ? messages : messages.map(row => ({ ...row, image: null })), imagesDeferred: !includeImages };
    },
    postCaseMessage(user, payload) {
      demand(user, 'Please sign in.');
      const complaint = findComplaint(payload.id);
      demand(privateCase(user, complaint) && !complaint.retained_at, 'You do not have permission for this conversation.');
      const body = safeText(payload.body, 1000);
      const image = payload.image || null;
      demand(body.length >= 3 || image, 'Write a message or attach a photo.');
      demand(!image || (typeof image === 'string' && /^data:image\/(png|jpeg|webp);base64,/.test(image) && image.length < 600000), 'Image is too large after optimization.');
      return transact(() => {
        run('INSERT INTO case_messages (complaint_id,sender_id,body,image) VALUES (?,?,?,?)', [complaint.id,user.id,body,image]);
        const messageId = id();
        run('INSERT INTO audit (actor_id,action,target_type,target_id,detail) VALUES (?,?,?,?,?)', [user.id,'Private case message','complaint',complaint.id,'']);
        const recipients = user.role === 'citizen'
          ? all("SELECT id FROM users WHERE active=1 AND (role IN ('admin','superadmin') OR (role='staff' AND department_id=?))", [complaint.department_id || -1])
          : user.role === 'staff' ? [{ id: complaint.reporter_id }] : [
              { id: complaint.reporter_id },
              ...all("SELECT id FROM users WHERE active=1 AND role='staff' AND department_id=?", [complaint.department_id || -1])
            ];
        for (const recipient of recipients) if (recipient.id !== user.id) run('INSERT INTO notifications (user_id,complaint_id,title,message) VALUES (?,?,?,?)',
          [recipient.id,complaint.id,'New case message',`${complaint.code}: Open the private conversation to read and reply.`]);
        return messageId;
      });
    },
    setLanguage(user, payload) {
      demand(user, 'Please sign in.');
      const language = payload.language;
      demand(language === 'en' || language === 'bn', 'Choose English or Bangla.');
      return transact(() => { run('UPDATE users SET language=? WHERE id=?', [language,user.id]); return language; });
    },
    wardSummary(user) {
      demand(user, 'Please sign in.');
      const access = user.role === 'staff' ? { sql: 'c.department_id=?', params: [user.departmentId || -1] } : visibility(user);
      return all(`SELECT c.ward_code AS code,COUNT(*) AS total,
        SUM(CASE WHEN c.status NOT IN ('Closed','Citizen Verified','Finished','Rejected','Duplicate') THEN 1 ELSE 0 END) AS open,
        SUM(CASE WHEN c.status='Submitted' THEN 1 ELSE 0 END) AS awaiting
        FROM complaints c WHERE ${access.sql} GROUP BY c.ward_code ORDER BY open DESC,total DESC LIMIT 130`, access.params);
    },
    publicReplay(payload = {}) {
      const corporation = payload.corporation === 'DSCC' ? 'DSCC' : 'DNCC';
      demand(payload.corporation === undefined || payload.corporation === 'DNCC' || payload.corporation === 'DSCC', 'Choose Dhaka North or South.');
      const now = new Date();
      const currentMonth = new Date(now.getTime() + 6 * 3600000).toISOString().slice(0, 7);
      const month = payload.month === undefined ? currentMonth : String(payload.month);
      demand(/^20\d{2}-(0[1-9]|1[0-2])$/.test(month) && month <= currentMonth, 'Choose a valid month up to today.');
      const [year, number] = month.split('-').map(Number);
      const start = new Date(Date.UTC(year, number - 1, 1) - 6 * 3600000).toISOString().slice(0, 19).replace('T', ' ');
      const monthEnd = Date.UTC(year, number, 1) - 6 * 3600000;
      const cutoff = new Date(Math.min(monthEnd, now.getTime() + 1000)).toISOString().slice(0, 19).replace('T', ' ');
      const rows = all(`WITH history AS (
        SELECT c.ward_code,c.created_at,c.resolution_due_at,
          COALESCE((SELECT u.new_status FROM updates u WHERE u.complaint_id=c.id AND u.created_at<? AND u.new_status IS NOT NULL ORDER BY u.created_at DESC,u.id DESC LIMIT 1),'Submitted') AS state
        FROM complaints c WHERE c.ward_code LIKE ? AND c.created_at<?
      ) SELECT ward_code AS code,COUNT(*) AS reported,
        SUM(CASE WHEN created_at>=? THEN 1 ELSE 0 END) AS new_reports,
        SUM(CASE WHEN state NOT IN ('Closed','Citizen Verified','Finished','Rejected','Duplicate') THEN 1 ELSE 0 END) AS open,
        SUM(CASE WHEN state IN ('Closed','Citizen Verified','Finished') THEN 1 ELSE 0 END) AS confirmed,
        SUM(CASE WHEN state NOT IN ('Closed','Citizen Verified','Finished','Rejected','Duplicate') AND resolution_due_at<? THEN 1 ELSE 0 END) AS overdue
        FROM history GROUP BY ward_code HAVING COUNT(*)>=5 ORDER BY ward_code`, [cutoff, `${corporation}-%`, cutoff, start, cutoff]);
      const ratings = all(`SELECT c.ward_code AS code,ROUND(AVG(f.rating),1) AS average_rating
        FROM feedback f JOIN complaints c ON c.id=f.complaint_id
        WHERE c.ward_code LIKE ? AND f.resolution='Yes' AND f.created_at<?
        GROUP BY c.ward_code HAVING COUNT(*)>=5`, [`${corporation}-%`, cutoff]);
      const ratingByWard = new Map(ratings.map(row => [row.code, Number(row.average_rating)]));
      return { corporation, month, currentMonth, wards: rows.map(row => ({
        code: row.code, reported: Number(row.reported), newReports: Number(row.new_reports), open: Number(row.open), confirmed: Number(row.confirmed),
        overdue: month === currentMonth ? Number(row.overdue) : null, averageRating: ratingByWard.get(row.code) ?? null
      })) };
    },
    summary(user) {
      demand(user, 'Please sign in.');
      const access = visibility(user), where = `WHERE ${access.sql}`, params = access.params;
      const counts = one(`SELECT COUNT(*) AS total,
        SUM(CASE WHEN c.status IN ('Closed','Finished') THEN 1 ELSE 0 END) AS closed,
        SUM(CASE WHEN c.status NOT IN ('Closed','Citizen Verified','Finished','Rejected','Duplicate') THEN 1 ELSE 0 END) AS open,
        SUM(CASE WHEN c.status='Submitted' THEN 1 ELSE 0 END) AS pending,
        SUM(CASE WHEN c.status='Awaiting Feedback' THEN 1 ELSE 0 END) AS awaiting,
        SUM(CASE WHEN c.status='Citizen Verified' THEN 1 ELSE 0 END) AS citizen_verified,
        SUM(CASE WHEN c.status='Finished' THEN 1 ELSE 0 END) AS finished,
        SUM(CASE WHEN c.severity='Critical' AND c.status NOT IN ('Closed','Citizen Verified','Finished') THEN 1 ELSE 0 END) AS critical,
        SUM(CASE WHEN c.status NOT IN ('Closed','Citizen Verified','Finished','Rejected','Duplicate') AND c.resolution_due_at<CURRENT_TIMESTAMP THEN 1 ELSE 0 END) AS overdue_closure,
        SUM(CASE WHEN c.recurrence_of IS NOT NULL THEN 1 ELSE 0 END) AS recurring
        FROM complaints c ${where}`, params);
      const categories = all(`SELECT c.category_id AS id,COUNT(*) AS count FROM complaints c ${where} GROUP BY c.category_id ORDER BY count DESC LIMIT 20`, params);
      const areas = all(`SELECT c.area,COUNT(*) AS count,SUM(CASE WHEN c.status NOT IN ('Closed','Citizen Verified','Finished') THEN 1 ELSE 0 END) AS open
        FROM complaints c ${where} GROUP BY c.area ORDER BY count DESC LIMIT 20`, params);
      const departments = all(`SELECT c.department_id AS id,COUNT(*) AS count,
        SUM(CASE WHEN c.status IN ('Closed','Citizen Verified','Finished','Awaiting Feedback') THEN 1 ELSE 0 END) AS resolved
        FROM complaints c ${where} AND c.department_id IS NOT NULL GROUP BY c.department_id ORDER BY count DESC LIMIT 20`, params);
      const reopened = one(`SELECT COUNT(*) AS n FROM cycles y JOIN complaints c ON c.id=y.complaint_id ${where} AND y.reopened_at IS NOT NULL`, params).n;
      const feedback = one(`SELECT COUNT(*) AS count,AVG(f.rating) AS average FROM feedback f JOIN complaints c ON c.id=f.complaint_id ${where}`, params);
      const own = one(`SELECT COUNT(*) AS total,
        SUM(CASE WHEN c.status NOT IN ('Closed','Citizen Verified','Finished','Rejected','Duplicate') THEN 1 ELSE 0 END) AS open,
        SUM(CASE WHEN c.status IN ('Closed','Citizen Verified','Finished','Awaiting Feedback') THEN 1 ELSE 0 END) AS resolved
        FROM complaints c WHERE c.reporter_id=?`, [user.id]);
      const assigned = user.role === 'staff' ? one(`SELECT COUNT(*) AS total,
        SUM(CASE WHEN c.status NOT IN ('Closed','Citizen Verified','Finished','Rejected','Duplicate') THEN 1 ELSE 0 END) AS open,
        SUM(CASE WHEN c.status IN ('Closed','Citizen Verified','Finished','Awaiting Feedback') THEN 1 ELSE 0 END) AS resolved
        FROM complaints c WHERE c.department_id=?`, [user.departmentId || -1]) : null;
      return { counts, categories, areas, departments, reopened, feedback, own, assigned };
    },
    performance(user) {
      requireRole(user, ['superadmin']);
      const departments = all(`SELECT d.id,d.name,
        (SELECT COUNT(*) FROM complaints c WHERE c.department_id=d.id AND c.status='Citizen Verified') AS awaiting_finish,
        COUNT(c.id) AS finished,AVG(f.rating) AS average_rating
        FROM departments d LEFT JOIN complaints c ON c.department_id=d.id AND c.status IN ('Finished','Closed')
          AND EXISTS (SELECT 1 FROM feedback f3 JOIN cycles y3 ON y3.id=f3.cycle_id WHERE y3.complaint_id=c.id AND f3.resolution='Yes' AND y3.number=(SELECT MAX(number) FROM cycles WHERE complaint_id=c.id))
        LEFT JOIN feedback f ON f.id=(SELECT f2.id FROM feedback f2 JOIN cycles y ON y.id=f2.cycle_id WHERE y.complaint_id=c.id ORDER BY y.number DESC LIMIT 1)
        GROUP BY d.id,d.name ORDER BY d.name`);
      const areas = all(`SELECT c.department_id,d.name AS department,c.area,COUNT(*) AS finished,AVG(f.rating) AS average_rating
        FROM complaints c JOIN departments d ON d.id=c.department_id
        JOIN feedback f ON f.id=(SELECT f2.id FROM feedback f2 JOIN cycles y ON y.id=f2.cycle_id WHERE y.complaint_id=c.id ORDER BY y.number DESC LIMIT 1)
        WHERE c.status IN ('Finished','Closed') AND f.resolution='Yes'
        GROUP BY c.department_id,c.area ORDER BY finished DESC,c.area`);
      const completed = all(`SELECT c.id,c.department_id,c.created_at,c.resolution_due_at,c.closed_at
        FROM complaints c WHERE c.status IN ('Finished','Closed') AND c.department_id IS NOT NULL AND c.closed_at IS NOT NULL
        AND EXISTS (SELECT 1 FROM feedback f JOIN cycles y ON y.id=f.cycle_id WHERE y.complaint_id=c.id AND f.resolution='Yes' AND y.number=(SELECT MAX(number) FROM cycles WHERE complaint_id=c.id))`);
      const everConfirmed = all(`SELECT c.id,c.department_id,MAX(CASE WHEN y.reopened_at IS NOT NULL THEN 1 ELSE 0 END) AS reopened
        FROM complaints c JOIN cycles y ON y.complaint_id=c.id WHERE c.department_id IS NOT NULL AND y.closed_at IS NOT NULL
        GROUP BY c.id,c.department_id`);
      const byDepartment = new Map();
      const byConfirmedDepartment = new Map();
      for (const row of completed) {
        if (!byDepartment.has(row.department_id)) byDepartment.set(row.department_id, []);
        byDepartment.get(row.department_id).push(row);
      }
      for (const row of everConfirmed) {
        if (!byConfirmedDepartment.has(row.department_id)) byConfirmedDepartment.set(row.department_id, []);
        byConfirmedDepartment.get(row.department_id).push(row);
      }
      for (const row of departments) {
        const cases = byDepartment.get(row.id) || [];
        const confirmedCases = byConfirmedDepartment.get(row.id) || [];
        const durations = cases.map(c => (Date.parse(`${c.closed_at}Z`) - Date.parse(`${c.created_at}Z`)) / 3600000).filter(n => Number.isFinite(n) && n >= 0).sort((a,b) => a-b);
        const middle = Math.floor(durations.length / 2);
        row.median_confirmation_hours = durations.length ? Math.round((durations.length % 2 ? durations[middle] : (durations[middle-1] + durations[middle]) / 2) * 10) / 10 : null;
        row.on_time_percent = cases.length ? Math.round(100 * cases.filter(c => c.resolution_due_at && c.closed_at <= c.resolution_due_at).length / cases.length) : null;
        row.reopened_percent = confirmedCases.length ? Math.round(100 * confirmedCases.filter(c => c.reopened).length / confirmedCases.length) : null;
        row.reopen_sample_count = confirmedCases.length;
        row.rating_count = cases.length;
        row.sample_count = cases.length;
      }
      return { departments, areas, pendingReopenRequests: all(`SELECT r.id,r.complaint_id,c.code,c.title,r.reason,r.created_at FROM reopen_requests r JOIN complaints c ON c.id=r.complaint_id WHERE r.status='Pending' ORDER BY r.id DESC LIMIT 50`) };
    },
    requestReopen(user, payload) {
      requireRole(user, ['citizen']);
      const complaint = findComplaint(payload.id), reason = safeText(payload.reason, 1000);
      demand(complaint.reporter_id === user.id && complaint.status === 'Finished', 'Only the reporter can request another repair after Finished work.');
      demand(reason.length >= 12, 'Explain what failed again in at least 12 characters.');
      demand(complaint.finished_at && Date.now() - Date.parse(`${complaint.finished_at}Z`) <= 14 * 86400000, 'The 14-day rework request period has ended. Submit a new report instead.');
      demand(!one("SELECT id FROM reopen_requests WHERE complaint_id=? AND status='Pending'", [complaint.id]), 'A rework request is already awaiting review.');
      return transact(() => {
        run('INSERT INTO reopen_requests (complaint_id,user_id,reason) VALUES (?,?,?)', [complaint.id,user.id,reason]);
        const requestId = id();
        log(user.id,complaint.id,'Rework requested',complaint.status,complaint.status,reason);
        const owners = all("SELECT id FROM users WHERE role='superadmin' AND active=1");
        for (const owner of owners) run('INSERT INTO notifications (user_id,complaint_id,title,message) VALUES (?,?,?,?)', [owner.id,complaint.id,'Rework review needed',`${complaint.code}: The reporter says the repair failed again.`]);
        return requestId;
      });
    },
    decideReopen(user, payload) {
      requireRole(user, ['superadmin']);
      const requestId = Number(payload.requestId), decision = safeText(payload.decision, 20), note = safeText(payload.note, 1000);
      demand(['Approved','Declined'].includes(decision), 'Choose approve or decline.');
      demand(note.length >= 5, 'Explain the decision.');
      const item = one('SELECT r.*,c.code,c.status AS complaint_status FROM reopen_requests r JOIN complaints c ON c.id=r.complaint_id WHERE r.id=?', [requestId]);
      demand(item && item.status === 'Pending', 'This request was already reviewed.');
      demand(item.status === 'Pending' && item.code && item.complaint_id, 'Rework request not found.');
      const complaint = findComplaint(item.complaint_id);
      demand(complaint.status === 'Finished', 'This case is no longer Finished.');
      return transact(() => {
        run('UPDATE reopen_requests SET status=?,decision_note=?,decided_at=CURRENT_TIMESTAMP WHERE id=?', [decision,note,requestId]);
        if (decision === 'Approved') {
          const cycle = one('SELECT * FROM cycles WHERE complaint_id=? ORDER BY number DESC LIMIT 1', [complaint.id]);
          demand(cycle, 'No resolution cycle found.');
          run('UPDATE cycles SET reopened_at=CURRENT_TIMESTAMP WHERE id=?', [cycle.id]);
          run('UPDATE complaints SET closed_at=NULL,finished_at=NULL,escalation_level=0,resolution_due_at=datetime(\'now\',\'+\' || (SELECT resolution_hours FROM categories WHERE id=?) || \' hours\') WHERE id=?', [complaint.category_id,complaint.id]);
          changeStatus(complaint,user,'Rework approved','Reopened',note);
        } else log(user.id,complaint.id,'Rework declined',complaint.status,complaint.status,note);
        run('INSERT INTO notifications (user_id,complaint_id,title,message) VALUES (?,?,?,?)', [item.user_id,complaint.id,`Rework ${decision.toLowerCase()}`,`${complaint.code}: ${note}`]);
        return true;
      });
    },
    processEscalations() {
      const cases = all(`SELECT c.id,c.code,c.reporter_id,c.department_id,c.resolution_due_at,c.created_at,c.escalation_level,k.resolution_hours FROM complaints c JOIN categories k ON k.id=c.category_id
        WHERE c.resolution_due_at IS NOT NULL AND c.escalation_level<2 AND c.status NOT IN ('Closed','Citizen Verified','Finished','Rejected','Duplicate') ORDER BY c.resolution_due_at LIMIT 500`);
      const now = Date.now(), created = [];
      transact(() => {
        for (const c of cases) {
          const due = Date.parse(`${c.resolution_due_at}Z`);
          const warn = Math.min(24, c.resolution_hours * 0.25) * 3600000;
          const stage = now >= due ? 2 : now >= due - warn ? 1 : 0;
          if (stage <= c.escalation_level) continue;
          const label = stage === 2 ? 'Overdue' : 'Due soon';
          const message = stage === 2 ? `${c.code} passed its resolution deadline. Administrators must review and act.` : `${c.code} is approaching its resolution deadline.`;
          run('INSERT INTO escalation_events (complaint_id,stage,message) VALUES (?,?,?)', [c.id,label,message]);
          const recipients = stage === 2 ? all("SELECT id FROM users WHERE role IN ('admin','superadmin') AND active=1")
            : c.department_id ? all("SELECT id FROM users WHERE role='staff' AND department_id=? AND active=1", [c.department_id]) : all("SELECT id FROM users WHERE role IN ('admin','superadmin') AND active=1");
          for (const recipient of recipients) {
            run('INSERT INTO notifications (user_id,complaint_id,title,message) VALUES (?,?,?,?)', [recipient.id,c.id,label,message]);
            created.push({ userId: recipient.id, complaintId: c.id, title: label, message });
          }
          run('UPDATE complaints SET escalation_level=? WHERE id=?', [stage,c.id]);
        }
      });
      return created;
    },
    processCitizenReminders() {
      const pending = all(`SELECT c.id,c.code,c.reporter_id,y.id AS cycle_id,y.resolved_at,
        CASE WHEN y.resolved_at<=datetime('now','-7 days') THEN 2 ELSE 1 END AS stage
        FROM complaints c JOIN cycles y ON y.id=(SELECT MAX(id) FROM cycles WHERE complaint_id=c.id)
        JOIN users u ON u.id=c.reporter_id AND u.active=1
        WHERE c.status='Awaiting Feedback' AND y.resolved_at<=datetime('now','-2 days')
          AND NOT EXISTS (SELECT 1 FROM feedback f WHERE f.cycle_id=y.id)
          AND NOT EXISTS (SELECT 1 FROM citizen_reminders r WHERE r.cycle_id=y.id AND r.stage=CASE WHEN y.resolved_at<=datetime('now','-7 days') THEN 2 ELSE 1 END)
        ORDER BY y.resolved_at LIMIT 500`);
      const created = [];
      transact(() => {
        for (const item of pending) {
          for (let stage = 1; stage <= item.stage; stage++) {
            if (one('SELECT id FROM citizen_reminders WHERE cycle_id=? AND stage=?', [item.cycle_id,stage])) continue;
            if (item.stage === 2 && stage === 1) {
              run('INSERT INTO citizen_reminders (cycle_id,complaint_id,stage) VALUES (?,?,?)', [item.cycle_id,item.id,stage]);
              continue;
            }
            const title = 'Review reminder';
            const message = `${item.code}: Please check the completed work and confirm whether the issue is resolved.`;
            run('INSERT INTO citizen_reminders (cycle_id,complaint_id,stage) VALUES (?,?,?)', [item.cycle_id,item.id,stage]);
            run('INSERT INTO notifications (user_id,complaint_id,title,message) VALUES (?,?,?,?)', [item.reporter_id,item.id,title,message]);
            created.push({ userId: item.reporter_id, complaintId: item.id, title, message });
          }
        }
      });
      return created;
    },
    readNotification(user, payload) {
      demand(user, 'Please sign in.');
      const notificationId = Number(payload.id);
      demand(Number.isSafeInteger(notificationId) && notificationId > 0, 'Choose a notification.');
      return transact(() => {
        const notification = one('SELECT id FROM notifications WHERE id=? AND user_id=?', [notificationId,user.id]);
        demand(notification, 'Notification not found.');
        run('UPDATE notifications SET read_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=?', [notificationId,user.id]);
        return true;
      });
    },
    exportRows(user) {
      requireRole(user, ['admin','superadmin']);
      return all(`SELECT c.code,c.title,k.name AS category,c.area,c.severity,c.priority,c.status,d.name AS department,c.created_at,c.resolution_due_at,c.closed_at,CASE WHEN c.recurrence_of IS NOT NULL THEN 'Yes' ELSE 'No' END AS recurring
        FROM complaints c JOIN categories k ON k.id=c.category_id LEFT JOIN departments d ON d.id=c.department_id ORDER BY c.id DESC`);
    },
    snapshot(user) {
      demand(user, 'Please sign in.');
      const page = store.listComplaints(user, { limit: 25 });
      const complaints = page.complaints;
      const visibleIds = new Set(complaints.map(row => row.id));
      const privateIds = new Set(complaints.filter(row => privateCase(user, row)).map(row => row.id));
      const fullAccess = ['admin', 'superadmin'].includes(user.role);
      const ids = [...visibleIds], placeholders = ids.map(() => '?').join(',') || 'NULL';
      return {
        user,
        notifications: all('SELECT id,complaint_id,title,message,read_at,created_at FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 30', [user.id]),
        complaints,
        nextCursor: page.nextCursor,
        summary: store.summary(user),
        wardSummary: store.wardSummary(user),
        categories: all('SELECT * FROM categories ORDER BY name'),
        departments: all('SELECT * FROM departments ORDER BY name'),
        updates: all(`SELECT x.*, u.name AS actor, u.role AS actor_role FROM updates x JOIN users u ON u.id=x.actor_id WHERE x.complaint_id IN (${placeholders}) ORDER BY x.id DESC LIMIT 100`, ids)
          .filter(row => privateIds.has(row.complaint_id) && (user.role !== 'citizen' || !['Updated work plan','Accepted work','Released work'].includes(row.action)) && (fullAccess || row.action !== 'Community feedback' || row.actor_id === user.id))
          .map(row => fullAccess || row.actor_role !== 'citizen' || row.actor_id === user.id ? row : { ...row, actor_id: null, actor: 'Resident' }),
        cycles: all(`SELECT * FROM cycles WHERE complaint_id IN (${placeholders}) ORDER BY id DESC LIMIT 100`, ids).filter(row => visibleIds.has(row.complaint_id)),
        feedback: all(`SELECT f.*, u.name AS author FROM feedback f JOIN users u ON u.id=f.user_id WHERE f.complaint_id IN (${placeholders}) ORDER BY f.id DESC LIMIT 100`, ids)
          .filter(row => visibleIds.has(row.complaint_id))
          .map(row => fullAccess || row.user_id === user.id ? row : { ...row, user_id: null, author: 'Resident', comment: '' }),
        users: user.role === 'superadmin' ? all("SELECT id,name,email,role,area,department_id,verified_area,active,created_at FROM users WHERE role IN ('superadmin','admin','staff') ORDER BY id DESC") : [],
        privacyRequest: user.role === 'citizen' ? one('SELECT id,status,created_at,decided_at,decision_note FROM privacy_requests WHERE user_id=? ORDER BY id DESC LIMIT 1', [user.id]) : null,
        privacyRequests: user.role === 'superadmin' ? all("SELECT p.id,p.user_id,p.status,p.reason,p.created_at,p.decided_at,p.decision_note,u.name,u.email FROM privacy_requests p JOIN users u ON u.id=p.user_id ORDER BY CASE WHEN p.status='Pending' THEN 0 ELSE 1 END,p.id DESC LIMIT 50") : [],
        audit: user.role === 'superadmin' ? all(`SELECT a.*,u.name AS actor FROM audit a JOIN users u ON u.id=a.actor_id ORDER BY a.id DESC LIMIT 100`) : []
      };
    },
    nearby(user, payload) {
      demand(user, 'Please sign in.');
      const lat = Number(payload.latitude), lon = Number(payload.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return [];
      const access = visibility(user);
      return all(`SELECT c.id,c.code,c.title,c.status,c.category_id,c.latitude,c.longitude FROM complaints c WHERE c.category_id=? AND c.status NOT IN ('Submitted','Under Review','Rejected','Duplicate','Closed','Citizen Verified','Finished') AND ${access.sql}`, [Number(payload.categoryId), ...access.params])
        .map(item => ({ ...item, distance: Math.round(haversineMeters({ latitude: lat, longitude: lon }, item)) }))
        .filter(item => item.distance <= 200).sort((a,b) => a.distance - b.distance).slice(0, 5)
        .map(({ latitude, longitude, ...item }) => item);
    },
    nearbyIssues(user, payload) {
      demand(user, 'Please sign in.');
      const latitude = Number(payload.latitude), longitude = Number(payload.longitude);
      demand(Number.isFinite(latitude) && Number.isFinite(longitude) && inDhaka(latitude, longitude), 'Choose a location inside the Dhaka service area.');
      const wardCode = safeText(payload.wardCode, 7);
      if (wardCode) demand(validWard(wardCode), 'Choose a valid ward.');
      const access = visibility(user);
      const latitudeSpan = 2 / 111;
      const longitudeSpan = 2 / (111 * Math.cos(latitude * Math.PI / 180));
      const where = [access.sql, 'c.latitude BETWEEN ? AND ?', 'c.longitude BETWEEN ? AND ?'];
      const params = [...access.params, latitude - latitudeSpan, latitude + latitudeSpan, longitude - longitudeSpan, longitude + longitudeSpan];
      if (wardCode) { where.push('c.ward_code=?'); params.push(wardCode); }
      const rows = all(`SELECT c.id,c.code,c.title,c.status,c.area,c.ward_code,c.department_id,c.reporter_id,c.latitude,c.longitude,k.name AS category
        FROM complaints c JOIN categories k ON k.id=c.category_id WHERE ${where.join(' AND ')}`, params);
      return rows.map(row => ({ row, distance: Math.round(haversineMeters({ latitude, longitude }, row)) }))
        .filter(item => item.distance <= 2000).sort((a,b) => a.distance - b.distance).slice(0, 50)
        .map(({ row, distance }) => { const safe = safeCase(user, row); return { id: safe.id, code: safe.code, title: safe.title, status: safe.status,
          area: safe.area, ward_code: safe.ward_code, category: safe.category, distance }; });
    },
    wardBoundaryStatus(user) {
      demand(user, 'Please sign in.');
      return all("SELECT substr(code,1,4) AS corporation,COUNT(*) AS count,MAX(imported_at) AS imported_at,MAX(source) AS source FROM ward_boundaries GROUP BY substr(code,1,4) ORDER BY corporation");
    },
    wardBoundaryMap(user, payload) {
      demand(user, 'Please sign in.');
      const corporation = safeText(payload.corporation, 4);
      demand(['DNCC','DSCC'].includes(corporation), 'Choose Dhaka North or South.');
      return all('SELECT code,geometry FROM ward_boundaries WHERE code LIKE ? ORDER BY code', [`${corporation}-%`])
        .map(row => ({ code: row.code, geometry: JSON.parse(row.geometry) }));
    },
    wardSuggestion(user, payload) {
      demand(user, 'Please sign in.');
      const latitude = Number(payload.latitude), longitude = Number(payload.longitude);
      demand(Number.isFinite(latitude) && Number.isFinite(longitude) && inDhaka(latitude, longitude), 'Choose a location inside the Dhaka service area.');
      const rows = all('SELECT code,geometry,source FROM ward_boundaries WHERE south<=? AND north>=? AND west<=? AND east>=?', [latitude,latitude,longitude,longitude]);
      const matches = rows.filter(row => geometryContains(JSON.parse(row.geometry), longitude, latitude));
      if (!matches.length) return { code: null, confidence: 'unmapped', source: null };
      if (matches.length > 1) return { code: null, confidence: 'ambiguous', source: null };
      const matched = matches[0];
      const distance = boundaryDistanceMeters(JSON.parse(matched.geometry), longitude, latitude);
      return { code: matched.code, confidence: distance < 50 ? 'boundary' : 'inside', distanceToBoundaryMetres: distance, source: matched.source };
    },
    importWardBoundaries(user, payload) {
      requireRole(user, ['superadmin']);
      demand(payload.confirm === 'APPROVED WARD MAP', 'Type APPROVED WARD MAP to confirm the source.');
      const saved = one('SELECT password_hash FROM users WHERE id=? AND active=1', [user.id]);
      demand(saved && typeof payload.password === 'string' && payload.password.length <= 128 && verifyPassword(payload.password, saved.password_hash), 'Current password is incorrect.');
      const source = safeText(payload.source, 300);
      demand(source.length >= 12, 'Describe the approving authority and source date.');
      const corporation = safeText(payload.corporation, 4);
      demand(['DNCC','DSCC'].includes(corporation), 'Choose Dhaka North or South.');
      const features = parseWardFeatures(payload.geojson);
      demand(features.every(item => item.code.startsWith(`${corporation}-`)), 'All features must belong to the selected corporation.');
      return transact(() => {
        if (payload.replace === true) run('DELETE FROM ward_boundaries WHERE code LIKE ?', [`${corporation}-%`]);
        for (const item of features) run('INSERT OR REPLACE INTO ward_boundaries (code,geometry,south,north,west,east,source,imported_at) VALUES (?,?,?,?,?,?,?,CURRENT_TIMESTAMP)', [item.code,JSON.stringify(item.geometry),item.south,item.north,item.west,item.east,source]);
        run('INSERT INTO audit (actor_id,action,target_type,target_id,detail) VALUES (?,?,?,?,?)', [user.id,'Imported ward boundaries','system',0,`${corporation}: ${features.length} polygons from ${source}`]);
        return { imported: features.length, total: one('SELECT COUNT(*) AS n FROM ward_boundaries WHERE code LIKE ?', [`${corporation}-%`]).n };
      });
    },
    workQueue(user, payload = {}) {
      requireRole(user, ['staff','admin','superadmin']);
      const filter = safeText(payload.filter || 'all', 16);
      demand(['all','unaccepted','mine','blocked','overdue'].includes(filter), 'Choose a work queue filter.');
      const page = payload.page == null ? 1 : Number(payload.page);
      demand(Number.isSafeInteger(page) && page >= 1 && page <= 100000, 'Choose a valid work queue page.');
      const limit = 25;
      const where = ["c.department_id IS NOT NULL", "c.status NOT IN ('Closed','Finished','Citizen Verified','Rejected','Duplicate')"];
      const params = [];
      if (user.role === 'staff') { where.push('c.department_id=?'); params.push(user.departmentId || -1); }
      if (filter === 'unaccepted') where.push('c.assignee_id IS NULL');
      if (filter === 'mine') { where.push('c.assignee_id=?'); params.push(user.id); }
      if (filter === 'blocked') where.push("c.blocked_reason IS NOT NULL AND c.blocked_reason<>''");
      if (filter === 'overdue') where.push('c.resolution_due_at<CURRENT_TIMESTAMP');
      const total = one(`SELECT COUNT(*) AS n FROM complaints c WHERE ${where.join(' AND ')}`, params).n;
      const rows = all(`SELECT c.id,c.code,c.title,c.status,c.priority,c.ward_code,c.area,c.department_id,c.assignee_id,c.accepted_at,c.blocked_reason,c.next_action_at,c.resolution_due_at,c.created_at,d.name AS department,u.name AS assignee
        FROM complaints c JOIN departments d ON d.id=c.department_id LEFT JOIN users u ON u.id=c.assignee_id WHERE ${where.join(' AND ')}
        ORDER BY CASE WHEN c.blocked_reason IS NOT NULL AND c.blocked_reason<>'' THEN 1 WHEN c.assignee_id IS NULL THEN 0 ELSE 2 END,c.resolution_due_at ASC,c.id DESC LIMIT ? OFFSET ?`, [...params,limit,(page-1)*limit]);
      return { cases: rows, total, page, pageSize: limit, staff: user.role === 'staff' ? [] : all("SELECT id,name,department_id FROM users WHERE role='staff' AND active=1 ORDER BY name") };
    },
    assignWork(user, payload) {
      requireRole(user, ['staff','admin','superadmin']);
      const complaint = findComplaint(payload.id);
      demand(complaint.department_id && !['Closed','Finished','Citizen Verified','Rejected','Duplicate'].includes(complaint.status), 'Choose an active assigned case.');
      let assigneeId;
      if (user.role === 'staff') {
        demand(complaint.department_id === user.departmentId, 'This case belongs to another department.');
        demand(!complaint.assignee_id || complaint.assignee_id === user.id, 'Another staff member has accepted this case.');
        assigneeId = payload.release === true ? null : user.id;
      } else {
        assigneeId = payload.assigneeId == null ? null : Number(payload.assigneeId);
        if (assigneeId !== null) demand(one("SELECT id FROM users WHERE id=? AND role='staff' AND active=1 AND department_id=?", [assigneeId,complaint.department_id]), 'Choose active staff in the assigned department.');
      }
      return transact(() => {
        run('UPDATE complaints SET assignee_id=?,accepted_at=?,updated_at=CURRENT_TIMESTAMP WHERE id=?', [assigneeId,assigneeId ? new Date().toISOString() : null,complaint.id]);
        log(user.id,complaint.id,assigneeId ? 'Accepted work' : 'Released work',complaint.status,complaint.status,assigneeId ? `Staff ${assigneeId}` : '');
        return true;
      });
    },
    setWorkPlan(user, payload) {
      requireRole(user, ['staff','admin','superadmin']);
      const complaint = findComplaint(payload.id);
      demand(complaint.department_id && !['Closed','Finished','Citizen Verified','Rejected','Duplicate'].includes(complaint.status), 'Choose an active assigned case.');
      if (user.role === 'staff') demand(complaint.department_id === user.departmentId && complaint.assignee_id === user.id, 'Accept the case before changing its work plan.');
      const blockedReason = safeText(payload.blockedReason, 300);
      demand(!blockedReason || blockedReason.length >= 5, 'Explain the block in at least five characters.');
      const nextActionAt = payload.nextActionAt ? new Date(payload.nextActionAt) : null;
      demand(!nextActionAt || Number.isFinite(nextActionAt.getTime()), 'Choose a valid next action time.');
      return transact(() => {
        run('UPDATE complaints SET blocked_reason=?,next_action_at=?,updated_at=CURRENT_TIMESTAMP WHERE id=?', [blockedReason || null,nextActionAt?.toISOString() || null,complaint.id]);
        log(user.id,complaint.id,'Updated work plan',complaint.status,complaint.status,blockedReason || (nextActionAt ? `Next action ${nextActionAt.toISOString()}` : 'Cleared work plan'));
        return true;
      });
    },
    operationsHealth(user) {
      requireRole(user, ['superadmin']);
      const counts = one(`SELECT COUNT(*) AS total,
        COALESCE(SUM(CASE WHEN department_id IS NULL AND status NOT IN ('Closed','Finished','Rejected','Duplicate') THEN 1 ELSE 0 END),0) AS unassigned_department,
        COALESCE(SUM(CASE WHEN department_id IS NOT NULL AND assignee_id IS NULL AND status NOT IN ('Closed','Finished','Citizen Verified','Rejected','Duplicate') THEN 1 ELSE 0 END),0) AS unaccepted,
        COALESCE(SUM(CASE WHEN blocked_reason IS NOT NULL AND blocked_reason<>'' AND status NOT IN ('Closed','Finished','Citizen Verified','Rejected','Duplicate') THEN 1 ELSE 0 END),0) AS blocked,
        COALESCE(SUM(CASE WHEN resolution_due_at<CURRENT_TIMESTAMP AND status NOT IN ('Closed','Finished','Citizen Verified','Rejected','Duplicate') THEN 1 ELSE 0 END),0) AS overdue FROM complaints`);
      const media = one(`SELECT (SELECT COALESCE(SUM(COALESCE(length(image),0)+COALESCE(length(completion_image),0)),0) FROM complaints) +
        (SELECT COALESCE(SUM(length(completion_image)),0) FROM cycles) +
        (SELECT COALESCE(SUM(length(image)),0) FROM case_messages) AS bytes`);
      return { counts, mediaBytesEstimate: media.bytes, lastRecoveryCheck: one('SELECT archive_created_at,accounts,complaints,created_at FROM recovery_checks ORDER BY id DESC LIMIT 1'), lastOffsiteBackup: one("SELECT created_at,detail FROM operational_events WHERE kind='offsite_backup' ORDER BY id DESC LIMIT 1"), lastManualBackup: one("SELECT created_at FROM operational_events WHERE kind='manual_backup' ORDER BY id DESC LIMIT 1"), alertFailures: one("SELECT COUNT(*) AS n FROM operational_events WHERE kind='alert_failure' AND created_at>=datetime('now','-7 days')").n };
    },
    recordManualBackup(user) {
      requireRole(user, ['superadmin']);
      run("INSERT INTO operational_events (kind,detail) VALUES ('manual_backup','Encrypted archive generated by owner')");
      return true;
    },
    recordRecoveryCheck(user, payload) {
      requireRole(user, ['superadmin']);
      const createdAt = safeText(payload.createdAt, 40), accounts = Number(payload.accounts), complaints = Number(payload.complaints);
      demand(Number.isFinite(Date.parse(createdAt)) && Number.isSafeInteger(accounts) && accounts >= 0 && Number.isSafeInteger(complaints) && complaints >= 0, 'Backup check results are invalid.');
      return transact(() => { run('INSERT INTO recovery_checks (actor_id,archive_created_at,accounts,complaints) VALUES (?,?,?,?)', [user.id,createdAt,accounts,complaints]); return true; });
    },
    recordOperationalEvent(kind, detail = '') {
      demand(['offsite_backup','alert_failure'].includes(kind), 'Unknown operational event.');
      run('INSERT INTO operational_events (kind,detail) VALUES (?,?)', [kind,safeText(detail, 300)]);
      run("DELETE FROM operational_events WHERE created_at<datetime('now','-90 days')");
      return true;
    },
    complaintPurgePreview(user) {
      requireRole(user, ['superadmin']);
      return one('SELECT COUNT(*) AS complaints FROM complaints');
    },
    purgeComplaints(user, payload) {
      requireRole(user, ['superadmin']);
      demand(payload.confirm === 'DELETE COMPLAINTS', 'Type DELETE COMPLAINTS to confirm.');
      const saved = one('SELECT password_hash FROM users WHERE id=? AND active=1', [user.id]);
      demand(saved && typeof payload.password === 'string' && payload.password.length <= 128 && verifyPassword(payload.password, saved.password_hash), 'Current password is incorrect.');
      return transact(() => {
        const count = one('SELECT COUNT(*) AS n FROM complaints').n;
        for (const table of ['case_messages','notifications','feedback','updates','escalation_events','citizen_reminders','reopen_requests','cycles']) run(`DELETE FROM ${table}`);
        run('UPDATE complaints SET duplicate_of=NULL, recurrence_of=NULL');
        run('DELETE FROM complaints');
        run('DELETE FROM area_counts');
        run("DELETE FROM audit WHERE target_type='complaint' OR target_type='retention'");
        run('INSERT INTO audit (actor_id,action,target_type,target_id,detail) VALUES (?,?,?,?,?)', [user.id,'Purged complaints','system',0,`${count} complaints and related history removed`]);
        return { complaints: count };
      });
    },
    createComplaint(user, payload) {
      requireRole(user, ['citizen']);
      const title = safeText(payload.title, 120), description = safeText(payload.description, 2000), placeName = safeText(payload.placeName, 150);
      const wardCode = safeText(payload.wardCode, 7);
      demand(validWard(wardCode), 'Choose a Dhaka North or South ward.');
      const area = wardLabel(wardCode);
      const latitude = Number(payload.latitude), longitude = Number(payload.longitude), categoryId = Number(payload.categoryId);
      demand(title.length >= 6 && description.length >= 12, 'Enter a title and a useful description.');
      demand(area.length >= 2, 'Enter the area name.');
      demand(placeName.length >= 3, 'Enter the exact place name or nearby landmark.');
      demand(Number.isFinite(latitude) && latitude >= -90 && latitude <= 90 && Number.isFinite(longitude) && longitude >= -180 && longitude <= 180, 'Select a valid map location.');
      demand(inDhaka(latitude, longitude), 'Choose a location inside the Dhaka city service area.');
      const category = one('SELECT id,resolution_hours FROM categories WHERE id=? AND active=1', [categoryId]);
      demand(category, 'Choose a valid category.');
      demand(SEVERITIES.includes(payload.severity), 'Choose a valid severity.');
      const image = payload.image || null;
      demand(!image || (typeof image === 'string' && /^data:image\/(png|jpeg|webp);base64,/.test(image) && image.length < 600000), 'Image is too large after optimization.');
      return transact(() => {
        const recurrence = all(`SELECT id,latitude,longitude,closed_at FROM complaints WHERE category_id=? AND status IN ('Closed','Finished') AND closed_at>=datetime('now','-90 days')
          AND latitude BETWEEN ? AND ? AND longitude BETWEEN ? AND ? ORDER BY closed_at DESC`, [categoryId,latitude-0.001,latitude+0.001,longitude-0.0013,longitude+0.0013])
          .map(row => ({ ...row, distance: haversineMeters({ latitude, longitude }, row) }))
          .filter(row => row.distance <= 100).sort((a,b) => a.distance - b.distance || b.id - a.id)[0];
        run(`INSERT INTO complaints (reporter_id,title,description,category_id,area,ward_code,place_name,latitude,longitude,severity,image,resolution_due_at,recurrence_of)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,datetime('now','+' || ? || ' hours'),?)`, [user.id,title,description,categoryId,area,wardCode,placeName,latitude,longitude,payload.severity,image,category.resolution_hours,recurrence?.id || null]);
        run('INSERT INTO area_counts (area_key,total) VALUES (lower(trim(?)),1) ON CONFLICT(area_key) DO UPDATE SET total=total+1', [area]);
        const complaintId = id();
        run('UPDATE complaints SET code=? WHERE id=?', [`C-${String(1000 + complaintId)}`, complaintId]);
        log(user.id, complaintId, 'Submitted', null, 'Submitted', 'Citizen report received');
        return complaintId;
      });
    },
    act(user, payload) {
      const action = safeText(payload.action, 30), note = safeText(payload.note, 1000);
      demand(['verify','reject','duplicate','assign','finish','reopen','priority','start','progress','resolve','dismissRecurrence'].includes(action), 'Unknown action.');
      if (['start','progress','resolve'].includes(action)) requireRole(user, ['staff']);
      else if (action === 'finish') requireRole(user, ['superadmin']);
      else requireRole(user, ['admin','superadmin']);
      const complaint = findComplaint(payload.id);
      if (user.role === 'staff') demand(complaint.department_id === user.departmentId, 'This complaint belongs to another department.');
      return transact(() => {
        if (action === 'verify') {
          demand(complaint.status === 'Submitted' || complaint.status === 'Under Review', 'Only new complaints can be verified.');
          changeStatus(complaint,user,'Verified','Verified',note);
        } else if (action === 'reject') {
          demand(['Submitted','Under Review'].includes(complaint.status), 'Only new complaints can be rejected.');
          demand(note.length >= 5, 'Give a reason for rejection.');
          changeStatus(complaint,user,'Rejected','Rejected',note);
        } else if (action === 'duplicate') {
          demand(['Submitted','Under Review'].includes(complaint.status), 'Only new complaints can be marked duplicate.');
          const original = findComplaint(payload.duplicateOf);
          demand(original.id !== complaint.id && original.category_id === complaint.category_id, 'Choose an existing complaint of the same category.');
          demand(haversineMeters(complaint, original) <= 200, 'The existing complaint must be within 200 meters.');
          demand(!['Rejected','Duplicate'].includes(original.status), 'Choose a valid original complaint.');
          run('UPDATE complaints SET duplicate_of=? WHERE id=?', [original.id,complaint.id]);
          changeStatus(complaint,user,'Marked duplicate','Duplicate',`Linked to ${original.code}${note ? ` · ${note}` : ''}`);
        } else if (action === 'assign') {
          demand(['Verified','Assigned','Reopened'].includes(complaint.status), 'Verify the complaint before assigning it.');
          const departmentId = Number(payload.departmentId);
          demand(one('SELECT id FROM departments WHERE id=? AND active=1', [departmentId]), 'Choose an active department.');
          run('UPDATE complaints SET department_id=? WHERE id=?', [departmentId,complaint.id]);
          changeStatus(complaint,user,'Assigned','Assigned',note);
        } else if (action === 'priority') {
          demand(['Normal','High','Urgent'].includes(payload.priority), 'Choose a valid priority.');
          run('UPDATE complaints SET priority=?, updated_at=CURRENT_TIMESTAMP WHERE id=?', [payload.priority,complaint.id]);
          log(user.id,complaint.id,'Priority changed',complaint.status,complaint.status,payload.priority);
        } else if (action === 'dismissRecurrence') {
          demand(complaint.recurrence_of, 'There is no recurrence flag to dismiss.');
          demand(note.length >= 5, 'Explain why this is not a recurrence.');
          run('UPDATE complaints SET recurrence_of=NULL, updated_at=CURRENT_TIMESTAMP WHERE id=?', [complaint.id]);
          log(user.id,complaint.id,'Recurrence dismissed',complaint.status,complaint.status,note);
        } else if (action === 'start') {
          demand(['Assigned','Reopened'].includes(complaint.status), 'Only assigned work can be started.');
          changeStatus(complaint,user,'Work started','In Progress',note);
        } else if (action === 'progress') {
          demand(complaint.status === 'In Progress', 'Work must be in progress.');
          demand(note.length >= 5, 'Enter a progress note.');
          log(user.id,complaint.id,'Progress update',complaint.status,complaint.status,note);
        } else if (action === 'resolve') {
          demand(complaint.status === 'In Progress', 'Only work in progress can be resolved.');
          demand(note.length >= 5, 'Describe the completed work.');
          const image = payload.image || null;
          demand(image && typeof image === 'string' && /^data:image\/(png|jpeg|webp);base64,/.test(image) && image.length < 600000, 'Attach a completion photo before marking work complete.');
          const next = (one('SELECT MAX(number) AS n FROM cycles WHERE complaint_id=?', [complaint.id]).n || 0) + 1;
          run('INSERT INTO cycles (complaint_id,number,completion_image,completion_note) VALUES (?,?,?,?)', [complaint.id,next,image,note]);
          run('UPDATE complaints SET completion_image=?, resolved_at=CURRENT_TIMESTAMP WHERE id=?', [image,complaint.id]);
          changeStatus(complaint,user,'Work completed','Awaiting Feedback',note);
          run('INSERT INTO notifications (user_id,complaint_id,title,message) VALUES (?,?,?,?)',
            [complaint.reporter_id,complaint.id,'Please review completed work',`${complaint.code}: Department staff marked the work complete. Open your report to confirm it and give a rating.`]);
        } else if (action === 'reopen') {
          demand(['Awaiting Feedback','Citizen Verified','Finished','Closed'].includes(complaint.status), 'Only completed complaints can be reopened.');
          if (complaint.status === 'Finished') requireRole(user, ['superadmin']);
          demand(note.length >= 5, 'Give a reason for reopening.');
          const cycle = one('SELECT * FROM cycles WHERE complaint_id=? ORDER BY number DESC LIMIT 1', [complaint.id]);
          demand(cycle, 'No resolution cycle found.');
          run('UPDATE cycles SET reopened_at=CURRENT_TIMESTAMP WHERE id=?', [cycle.id]);
          run('UPDATE complaints SET closed_at=NULL,finished_at=NULL,escalation_level=0,resolution_due_at=datetime(\'now\',\'+\' || (SELECT resolution_hours FROM categories WHERE id=?) || \' hours\') WHERE id=?', [complaint.category_id,complaint.id]);
          changeStatus(complaint,user,'Reopened','Reopened',note);
        } else if (action === 'finish') {
          demand(complaint.status === 'Citizen Verified', 'The citizen must confirm the repair before it can be finished.');
          const cycle = one('SELECT * FROM cycles WHERE complaint_id=? ORDER BY number DESC LIMIT 1', [complaint.id]);
          demand(cycle, 'No resolution cycle found.');
          demand(one("SELECT id FROM feedback WHERE cycle_id=? AND user_id=? AND resolution='Yes'", [cycle.id,complaint.reporter_id]), 'Citizen confirmation is required.');
          run('UPDATE complaints SET finished_at=CURRENT_TIMESTAMP WHERE id=?', [complaint.id]);
          changeStatus(complaint,user,'Moved to finished work','Finished',note);
        } else throw new Error('Unknown action.');
        return true;
      });
    },
    submitFeedback(user, payload) {
      requireRole(user, ['citizen']);
      const complaint = findComplaint(payload.id);
      demand(complaint.reporter_id === user.id, 'You can review only your own report.');
      demand(complaint.status === 'Awaiting Feedback', 'Feedback is open only after completed work.');
      const cycle = one('SELECT * FROM cycles WHERE complaint_id=? ORDER BY number DESC LIMIT 1', [complaint.id]);
      demand(cycle, 'No resolution cycle found.');
      demand(!one('SELECT id FROM feedback WHERE cycle_id=? AND user_id=?', [cycle.id,user.id]), 'You already reviewed this repair cycle.');
      const rating = Number(payload.rating), resolution = safeText(payload.resolution, 20), comment = safeText(payload.comment, 1000);
      demand(Number.isInteger(rating) && rating >= 1 && rating <= 5, 'Select a rating from 1 to 5.');
      demand(['Yes','Partially','No'].includes(resolution), 'Select whether the issue was resolved.');
      return transact(() => {
        const local = Number(user.verifiedArea && user.area === complaint.area);
        run('INSERT INTO feedback (complaint_id,cycle_id,user_id,rating,resolution,comment,local) VALUES (?,?,?,?,?,?,?)', [complaint.id,cycle.id,user.id,rating,resolution,comment,local]);
        log(user.id,complaint.id,'Community feedback',complaint.status,complaint.status,`${rating}/5 · ${resolution}${comment ? ` · ${comment}` : ''}`);
        if (resolution === 'Yes') {
          run('UPDATE cycles SET closed_at=CURRENT_TIMESTAMP WHERE id=?', [cycle.id]);
          run('UPDATE complaints SET closed_at=CURRENT_TIMESTAMP WHERE id=?', [complaint.id]);
          changeStatus(complaint,user,'Citizen confirmed resolution','Citizen Verified','Reporter confirmed the completed work and rated it. Awaiting super administrator review.');
        }
        return true;
      });
    },
    manage(user, payload) {
      requireRole(user, ['superadmin']);
      if (payload.type === 'resolutionTime') {
        const categoryId = Number(payload.categoryId), hours = Number(payload.hours);
        demand(Number.isInteger(hours) && hours >= 1 && hours <= 720, 'Choose a closure target from 1 to 720 hours.');
        demand(one('SELECT id FROM categories WHERE id=?', [categoryId]), 'Choose a valid category.');
        return transact(() => {
          run('UPDATE categories SET resolution_hours=? WHERE id=?', [hours,categoryId]);
          run('INSERT INTO audit (actor_id,action,target_type,target_id,detail) VALUES (?,?,?,?,?)', [user.id,'Updated closure target','category',categoryId,`${hours} hours; applies to new reports`]);
          return true;
        });
      }
      if (payload.type === 'userStatus') {
        const targetId = Number(payload.userId);
        const active = payload.active === true;
        const target = one('SELECT id,role,active FROM users WHERE id=?', [targetId]);
        demand(target && ['admin','staff'].includes(target.role), 'Only administrator and staff accounts can be changed here.');
        demand(target.id !== user.id, 'You cannot change your own account.');
        return transact(() => {
          run('UPDATE users SET active=? WHERE id=?', [Number(active), targetId]);
          run('INSERT INTO audit (actor_id,action,target_type,target_id,detail) VALUES (?,?,?,?,?)', [user.id, active ? 'Reactivated' : 'Deactivated', 'user', targetId, target.role]);
          return targetId;
        });
      }
      const type = payload.type, name = safeText(payload.name, 80);
      demand(['category','department','user'].includes(type), 'Invalid setting type.');
      demand(name.length >= 3, 'Enter a name.');
      return transact(() => {
        if (type === 'user') {
          const email = safeText(payload.email, 200).toLowerCase();
          const role = safeText(payload.role, 20);
          const password = String(payload.password || '');
          const departmentId = role === 'staff' ? Number(payload.departmentId) : null;
          demand(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email), 'Enter a valid email.');
          demand(['staff','admin'].includes(role), 'Choose staff or administrator.');
          demand(password.length >= 10 && password.length <= 128, 'Use a password of 10 to 128 characters.');
          demand(!one('SELECT id FROM users WHERE lower(email)=lower(?)', [email]), 'This email is already registered.');
          if (role === 'staff') demand(one('SELECT id FROM departments WHERE id=? AND active=1', [departmentId]), 'Choose an active department.');
          run('INSERT INTO users (name,email,password_hash,role,area,department_id) VALUES (?,?,?,?,?,?)', [name,email,hashPassword(password),role,'Dhaka',departmentId]);
        } else if (type === 'category') {
          const departmentId = payload.departmentId ? Number(payload.departmentId) : null;
          if (departmentId) demand(one('SELECT id FROM departments WHERE id=? AND active=1', [departmentId]), 'Invalid department.');
          run('INSERT INTO categories (name,department_id) VALUES (?,?)', [name,departmentId]);
        } else run('INSERT INTO departments (name) VALUES (?)', [name]);
        const target = id();
        run('INSERT INTO audit (actor_id,action,target_type,target_id,detail) VALUES (?,?,?,?,?)', [user.id,'Created',type,target,name]);
        return target;
      });
    },
    requestPrivacyRemoval(user, payload) {
      requireRole(user, ['citizen']);
      const saved = one('SELECT password_hash FROM users WHERE id=? AND active=1', [user.id]);
      demand(saved && typeof payload.password === 'string' && payload.password.length <= 128 && verifyPassword(payload.password, saved.password_hash), 'Current password is incorrect.');
      demand(!one("SELECT id FROM privacy_requests WHERE user_id=? AND status='Pending'", [user.id]), 'A removal request is already pending.');
      return transact(() => {
        run('INSERT INTO privacy_requests (user_id,reason) VALUES (?,?)', [user.id,safeText(payload.reason, 500)]);
        const requestId = id();
        run('INSERT INTO audit (actor_id,action,target_type,target_id,detail) VALUES (?,?,?,?,?)', [user.id,'Requested data removal','privacy_request',requestId,'']);
        return requestId;
      });
    },
    decidePrivacyRemoval(user, payload) {
      requireRole(user, ['superadmin']);
      const requestId = Number(payload.requestId);
      demand(Number.isSafeInteger(requestId) && requestId > 0, 'Choose a valid request.');
      demand(['Approved','Declined'].includes(payload.decision), 'Choose approve or decline.');
      const note = safeText(payload.note, 500);
      if (payload.decision === 'Declined') demand(note.length >= 5, 'Explain why the request was declined.');
      return transact(() => {
        const item = one("SELECT p.user_id FROM privacy_requests p JOIN users u ON u.id=p.user_id WHERE p.id=? AND p.status='Pending' AND u.role='citizen'", [requestId]);
        demand(item, 'Pending citizen request not found.');
        if (payload.decision === 'Approved') {
          const cases = all('SELECT id,area FROM complaints WHERE reporter_id=?', [item.user_id]);
          for (const { id: complaintId, area } of cases) scrubCase(complaintId, area);
          run("UPDATE audit SET detail='' WHERE actor_id=?", [item.user_id]);
          run("UPDATE privacy_requests SET reason='',decision_note='' WHERE user_id=?", [item.user_id]);
          run('DELETE FROM notifications WHERE user_id=?', [item.user_id]);
          run('DELETE FROM account_tokens WHERE user_id=?', [item.user_id]);
          run('DELETE FROM backup_access WHERE user_id=?', [item.user_id]);
          run("UPDATE users SET name='Deleted resident',email=?,area='',password_hash=?,verified_area=0,email_verified=0,active=0,mfa_secret=NULL,mfa_pending=NULL,mfa_pending_expires=NULL WHERE id=?", [`deleted-${item.user_id}@invalid.local`,hashPassword(crypto.randomBytes(32).toString('hex')),item.user_id]);
        }
        run('UPDATE privacy_requests SET status=?,decision_note=?,decided_at=CURRENT_TIMESTAMP WHERE id=?', [payload.decision,payload.decision === 'Approved' ? '' : note,requestId]);
        run('INSERT INTO audit (actor_id,action,target_type,target_id,detail) VALUES (?,?,?,?,?)', [user.id,`${payload.decision} data removal`,'privacy_request',requestId,payload.decision === 'Approved' ? '' : note]);
        return { userId: item.user_id, approved: payload.decision === 'Approved' };
      });
    },
    retentionPreview(user, payload) {
      requireRole(user, ['superadmin']);
      const days = Number(payload.days);
      demand(Number.isInteger(days) && days >= 365 && days <= 3650, 'Choose 1 to 10 years.');
      return one("SELECT COUNT(*) AS total FROM complaints WHERE status IN ('Closed','Finished','Rejected','Duplicate') AND retained_at IS NULL AND created_at<=datetime('now','-' || ? || ' days')", [days]).total;
    },
    applyRetention(user, payload) {
      requireRole(user, ['superadmin']);
      const days = Number(payload.days);
      demand(Number.isInteger(days) && days >= 365 && days <= 3650, 'Choose 1 to 10 years.');
      demand(payload.confirm === 'ANONYMIZE', 'Type ANONYMIZE to confirm.');
      const saved = one('SELECT password_hash FROM users WHERE id=? AND active=1', [user.id]);
      demand(saved && typeof payload.password === 'string' && payload.password.length <= 128 && verifyPassword(payload.password, saved.password_hash), 'Current password is incorrect.');
      return transact(() => {
        const cases = all("SELECT id,area FROM complaints WHERE status IN ('Closed','Finished','Rejected','Duplicate') AND retained_at IS NULL AND created_at<=datetime('now','-' || ? || ' days') ORDER BY id LIMIT 50", [days]);
        for (const row of cases) scrubCase(row.id, row.area);
        const remaining = one("SELECT COUNT(*) AS total FROM complaints WHERE status IN ('Closed','Finished','Rejected','Duplicate') AND retained_at IS NULL AND created_at<=datetime('now','-' || ? || ' days')", [days]).total;
        run('INSERT INTO audit (actor_id,action,target_type,target_id,detail) VALUES (?,?,?,?,?)', [user.id,'Anonymized old cases','retention',0,`${days} days; ${cases.length} cases; ${remaining} remaining`]);
        return { processed: cases.length, remaining };
      });
    },
    close() { close(); }
  };
  return store;
}
module.exports = { createStore, haversineMeters, inDhaka, DHAKA_BOUNDS };
