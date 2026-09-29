const crypto = require('node:crypto');
const SEVERITIES = ['Low', 'Medium', 'High', 'Critical'];
const ACTIVE = ['Submitted', 'Under Review', 'Verified', 'Assigned', 'In Progress', 'Reopened'];
const BACKUP_TABLES = ['departments', 'categories', 'users', 'complaints', 'updates', 'cycles', 'feedback', 'notifications', 'audit'];
// Operational pilot boundary for Dhaka city; replace with an approved city polygon before municipal use.
const DHAKA_BOUNDS = { south: 23.68, north: 23.92, west: 90.30, east: 90.53 };
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
  run("UPDATE complaints SET closed_at=COALESCE((SELECT MAX(y.closed_at) FROM cycles y WHERE y.complaint_id=complaints.id),updated_at) WHERE closed_at IS NULL AND status='Closed'");
  run(`CREATE TABLE IF NOT EXISTS feedback (
    id INTEGER PRIMARY KEY, complaint_id INTEGER NOT NULL REFERENCES complaints(id), cycle_id INTEGER NOT NULL REFERENCES cycles(id),
    user_id INTEGER NOT NULL REFERENCES users(id), rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
    resolution TEXT NOT NULL, comment TEXT NOT NULL DEFAULT '', local INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(cycle_id, user_id))`);
  run(`CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), complaint_id INTEGER NOT NULL REFERENCES complaints(id),
    title TEXT NOT NULL, message TEXT NOT NULL, read_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
  run(`CREATE TABLE IF NOT EXISTS audit (
    id INTEGER PRIMARY KEY, actor_id INTEGER NOT NULL REFERENCES users(id), action TEXT NOT NULL,
    target_type TEXT NOT NULL, target_id INTEGER NOT NULL, detail TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
  run('CREATE TABLE IF NOT EXISTS backup_access (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), expires_at INTEGER NOT NULL)');
  if (!all('PRAGMA table_info(users)').some(column => column.name === 'email_verified')) run('ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0');
  run('CREATE TABLE IF NOT EXISTS account_tokens (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), purpose TEXT NOT NULL, issued_at INTEGER NOT NULL, expires_at INTEGER NOT NULL)');
  run('CREATE INDEX IF NOT EXISTS account_tokens_user_purpose ON account_tokens(user_id,purpose)');
  run('CREATE INDEX IF NOT EXISTS complaints_reporter_id ON complaints(reporter_id,id)');
  run('CREATE INDEX IF NOT EXISTS complaints_department_id ON complaints(department_id,id)');
  run('CREATE INDEX IF NOT EXISTS complaints_status_id ON complaints(status,id)');
  run('CREATE INDEX IF NOT EXISTS complaints_resolution_due ON complaints(closed_at,resolution_due_at)');
  run('CREATE INDEX IF NOT EXISTS complaints_recurrence_of ON complaints(recurrence_of)');
  run('CREATE INDEX IF NOT EXISTS complaints_category_resolution ON complaints(category_id,status,resolved_at)');
  run('CREATE INDEX IF NOT EXISTS updates_complaint_id ON updates(complaint_id,id)');
  run('CREATE INDEX IF NOT EXISTS feedback_complaint_id ON feedback(complaint_id,id)');
  run('CREATE INDEX IF NOT EXISTS notifications_user_id ON notifications(user_id,id)');
  run('CREATE INDEX IF NOT EXISTS cycles_complaint_id ON cycles(complaint_id,id)');

  const log = (actor, complaint, action, oldStatus, newStatus, note = '') => {
    run('INSERT INTO updates (complaint_id,actor_id,action,old_status,new_status,note) VALUES (?,?,?,?,?,?)', [complaint, actor, action, oldStatus, newStatus, note]);
    run('INSERT INTO audit (actor_id,action,target_type,target_id,detail) VALUES (?,?,?,?,?)', [actor, action, 'complaint', complaint, note]);
  };
  const changeStatus = (complaint, actor, action, status, note = '') => {
    run('UPDATE complaints SET status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?', [status, complaint.id]);
    log(actor.id, complaint.id, action, complaint.status, status, note);
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
    const visible = privateCase(user, row) ? row : { ...row, reporter_id: null, reporter: 'Resident', description: '', image: null, completion_image: null,
      latitude: Math.round(row.latitude * 1000) / 1000, longitude: Math.round(row.longitude * 1000) / 1000 };
    return { ...visible, recurrence_flag: Boolean(row.recurrence_of), recurrence_of: user.role === 'citizen' || !privateCase(user, row) ? null : row.recurrence_of };
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

  const publicUser = row => row && ({ id: row.id, name: row.name, email: row.email, role: row.role, area: row.area, departmentId: row.department_id || null, verifiedArea: Boolean(row.verified_area), emailVerified: Boolean(row.email_verified), active: Boolean(row.active) });
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
      demand(area.length >= 2, 'Enter your area.');
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
    login(email, password) {
      demand(typeof email === 'string' && email.length <= 200 && typeof password === 'string' && password.length <= 128, 'Invalid email or password.');
      const user = one('SELECT * FROM users WHERE lower(email)=lower(?) AND active=1', [safeText(email, 200)]);
      demand(user && verifyPassword(String(password || ''), user.password_hash), 'Invalid email or password.');
      return publicUser(user);
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
          run('UPDATE users SET password_hash=? WHERE id=?', [hashPassword(newPassword),row.user_id]);
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
      const saved = one('SELECT password_hash FROM users WHERE id=? AND active=1', [user.id]);
      demand(saved && verifyPassword(current, saved.password_hash), 'Current password is incorrect.');
      demand(current !== next, 'Choose a different password.');
      return transact(() => {
        run('UPDATE users SET password_hash=? WHERE id=?', [hashPassword(next), user.id]);
        run("DELETE FROM account_tokens WHERE user_id=? AND purpose='recovery'", [user.id]);
        run('INSERT INTO audit (actor_id,action,target_type,target_id,detail) VALUES (?,?,?,?,?)', [user.id,'Changed password','user',user.id,'']);
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
      if (status && status !== 'All statuses') { where.push('c.status=?'); params.push(status); }
      if (search) { where.push('(c.code LIKE ? OR c.title LIKE ? OR c.area LIKE ? OR k.name LIKE ?)'); params.push(...Array(4).fill(`%${search}%`)); }
      const from = 'FROM complaints c JOIN categories k ON k.id=c.category_id LEFT JOIN departments d ON d.id=c.department_id JOIN users u ON u.id=c.reporter_id';
      const total = one(`SELECT COUNT(*) AS n ${from} WHERE ${where.join(' AND ')}`, params).n;
      if (cursor) { where.push('c.id<?'); params.push(cursor); }
      const rows = all(`SELECT c.id,c.code,c.reporter_id,c.title,c.description,c.category_id,c.area,c.latitude,c.longitude,c.severity,c.priority,c.status,c.department_id,c.duplicate_of,c.recurrence_of,c.resolution_due_at,c.closed_at,c.created_at,c.updated_at,c.resolved_at,
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
        .filter(row => fullAccess || row.action !== 'Community feedback' || row.actor_id === user.id)
        .map(row => fullAccess || row.actor_role !== 'citizen' || row.actor_id === user.id ? row : { ...row, actor_id: null, actor: 'Resident' }) : [];
      const cycles = all('SELECT * FROM cycles WHERE complaint_id=? ORDER BY id DESC', [complaint.id]);
      const feedback = all(`SELECT f.*,u.name AS author FROM feedback f JOIN users u ON u.id=f.user_id WHERE f.complaint_id=? ORDER BY f.id DESC`, [complaint.id])
        .map(row => fullAccess || row.user_id === user.id ? row : { ...row, user_id: null, author: 'Resident', comment: '' });
      const recurrence = complaint.recurrence_of && privateAccess && user.role !== 'citizen'
        ? one('SELECT code,title,closed_at FROM complaints WHERE id=?', [complaint.recurrence_of]) : null;
      return { complaint: safeCase(user, complaint), recurrence, updates, cycles, feedback };
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
      return { departments, areas };
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
        categories: all('SELECT * FROM categories ORDER BY name'),
        departments: all('SELECT * FROM departments ORDER BY name'),
        updates: all(`SELECT x.*, u.name AS actor, u.role AS actor_role FROM updates x JOIN users u ON u.id=x.actor_id WHERE x.complaint_id IN (${placeholders}) ORDER BY x.id DESC LIMIT 100`, ids)
          .filter(row => privateIds.has(row.complaint_id) && (fullAccess || row.action !== 'Community feedback' || row.actor_id === user.id))
          .map(row => fullAccess || row.actor_role !== 'citizen' || row.actor_id === user.id ? row : { ...row, actor_id: null, actor: 'Resident' }),
        cycles: all(`SELECT * FROM cycles WHERE complaint_id IN (${placeholders}) ORDER BY id DESC LIMIT 100`, ids).filter(row => visibleIds.has(row.complaint_id)),
        feedback: all(`SELECT f.*, u.name AS author FROM feedback f JOIN users u ON u.id=f.user_id WHERE f.complaint_id IN (${placeholders}) ORDER BY f.id DESC LIMIT 100`, ids)
          .filter(row => visibleIds.has(row.complaint_id))
          .map(row => fullAccess || row.user_id === user.id ? row : { ...row, user_id: null, author: 'Resident', comment: '' }),
        users: user.role === 'superadmin' ? all("SELECT id,name,email,role,area,department_id,verified_area,active,created_at FROM users WHERE role IN ('superadmin','admin','staff') ORDER BY id DESC") : [],
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
    createComplaint(user, payload) {
      requireRole(user, ['citizen']);
      const title = safeText(payload.title, 120), description = safeText(payload.description, 2000), area = safeText(payload.area, 100);
      const latitude = Number(payload.latitude), longitude = Number(payload.longitude), categoryId = Number(payload.categoryId);
      demand(title.length >= 6 && description.length >= 12, 'Enter a title and a useful description.');
      demand(area.length >= 2, 'Enter the area name.');
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
        run(`INSERT INTO complaints (reporter_id,title,description,category_id,area,latitude,longitude,severity,image,resolution_due_at,recurrence_of)
          VALUES (?,?,?,?,?,?,?,?,?,datetime('now','+' || ? || ' hours'),?)`, [user.id,title,description,categoryId,area,latitude,longitude,payload.severity,image,category.resolution_hours,recurrence?.id || null]);
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
          demand(!image || (typeof image === 'string' && /^data:image\/(png|jpeg|webp);base64,/.test(image) && image.length < 600000), 'Completion image is too large after optimization.');
          const next = (one('SELECT MAX(number) AS n FROM cycles WHERE complaint_id=?', [complaint.id]).n || 0) + 1;
          run('INSERT INTO cycles (complaint_id,number) VALUES (?,?)', [complaint.id,next]);
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
          run('UPDATE complaints SET closed_at=NULL WHERE id=?', [complaint.id]);
          changeStatus(complaint,user,'Reopened','Reopened',note);
        } else if (action === 'finish') {
          demand(complaint.status === 'Citizen Verified', 'The citizen must confirm the repair before it can be finished.');
          const cycle = one('SELECT * FROM cycles WHERE complaint_id=? ORDER BY number DESC LIMIT 1', [complaint.id]);
          demand(cycle, 'No resolution cycle found.');
          demand(one("SELECT id FROM feedback WHERE cycle_id=? AND user_id=? AND resolution='Yes'", [cycle.id,complaint.reporter_id]), 'Citizen confirmation is required.');
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
    close() { close(); }
  };
  return store;
}
module.exports = { createStore, haversineMeters, inDhaka, DHAKA_BOUNDS };
