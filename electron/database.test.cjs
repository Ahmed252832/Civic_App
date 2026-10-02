const test = require('node:test');
const assert = require('node:assert/strict');
const { createDatabase, haversineMeters } = require('./database.cjs');
const initSqlJs = require('sql.js');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { decryptBackup, restoreNew } = require('../scripts/restore-backup.cjs');

const sample = { title: 'Broken crossing at the corner', description: 'Vehicles are swerving around the damaged crossing.', categoryId: 2, area: 'DNCC Ward 15', wardCode: 'DNCC-15', placeName: 'Dhanmondi Lake east gate', latitude: 23.7469, longitude: 90.3754, severity: 'High', image: 'data:image/png;base64,AAAA' };

test('ward queues and private case conversation respect account access', async () => {
  const db = await createDatabase(':memory:');
  try {
    const owner = db.bootstrapAdmin({ name: 'Project Owner', email: 'owner@example.test', password: 'owner-secret-password' });
    const citizen = db.register({ name: 'First Citizen', email: 'first@example.test', area: 'DNCC Ward 15', password: 'citizen-password-123' });
    const otherCitizen = db.register({ name: 'Other Citizen', email: 'other@example.test', area: 'DNCC Ward 16', password: 'citizen-password-123' });
    db.manage(owner, { type: 'user', name: 'Road Worker', email: 'roads@example.test', password: 'staff-password-123', role: 'staff', departmentId: 1 });
    db.manage(owner, { type: 'user', name: 'Waste Worker', email: 'waste@example.test', password: 'staff-password-123', role: 'staff', departmentId: 2 });
    const road = db.login('roads@example.test', 'staff-password-123');
    const waste = db.login('waste@example.test', 'staff-password-123');
    assert.throws(() => db.createComplaint(citizen, { ...sample, wardCode: 'DNCC-55' }), /ward/);
    const id = db.createComplaint(citizen, { ...sample, area: 'untrusted area' });
    assert.equal(db.complaintDetail(citizen, { id }).complaint.area, 'DNCC Ward 15');
    assert.equal(db.listComplaints(citizen, { wardCode: 'DNCC-15' }).total, 1);
    assert.equal(db.listComplaints(otherCitizen, { wardCode: 'DNCC-15' }).total, 0);
    assert.equal(db.wardSummary(owner).find(item => item.code === 'DNCC-15').total, 1);
    assert.equal(db.wardSummary(otherCitizen).length, 0);
    const messageId = db.postCaseMessage(citizen, { id, body: 'Please check the damaged crossing.' });
    assert.ok(messageId > 0);
    assert.equal(db.complaintDetail(owner, { id }).messages.length, 1);
    assert.throws(() => db.complaintDetail(otherCitizen, { id }), /not found/i);
    assert.throws(() => db.postCaseMessage(otherCitizen, { id, body: 'Unauthorized message' }), /permission/);
    db.act(owner, { id, action: 'verify' });
    db.act(owner, { id, action: 'assign', departmentId: 1 });
    assert.equal(db.complaintDetail(road, { id }).messages.length, 1);
    assert.equal(db.complaintDetail(waste, { id }).messages.length, 0);
    assert.throws(() => db.postCaseMessage(waste, { id, body: 'Wrong team' }), /permission/);
    db.postCaseMessage(road, { id, body: '', image: 'data:image/png;base64,AAAA' });
    assert.equal(db.complaintDetail(citizen, { id }).messages.length, 2);
    assert.equal(db.automaticBackupData().tables.case_messages.length, 2);
    assert.equal(db.setLanguage(citizen, { language: 'bn' }), 'bn');
    assert.equal(db.userById(citizen.id).language, 'bn');
  } finally { db.close(); }
});

test('report pins show the named exact place only to the owner and assigned team', async () => {
  const db = await createDatabase(':memory:');
  try {
    const owner = db.bootstrapAdmin({ name: 'Project Owner', email: 'owner@example.test', password: 'owner-secret-password' });
    const citizen = db.register({ name: 'First Citizen', email: 'first@example.test', area: 'DNCC Ward 15', password: 'citizen-password-123' });
    db.manage(owner, { type: 'user', name: 'Road Worker', email: 'roads@example.test', password: 'staff-password-123', role: 'staff', departmentId: 1 });
    db.manage(owner, { type: 'user', name: 'Waste Worker', email: 'waste@example.test', password: 'staff-password-123', role: 'staff', departmentId: 2 });
    const assignedStaff = db.login('roads@example.test', 'staff-password-123');
    const otherStaff = db.login('waste@example.test', 'staff-password-123');
    assert.throws(() => db.createComplaint(citizen, { ...sample, placeName: '' }), /exact place name/);
    const id = db.createComplaint(citizen, sample);
    assert.equal(db.listComplaints(citizen).complaints[0].place_name, sample.placeName);
    assert.equal(db.listComplaints(owner).complaints[0].location_exact, true);
    db.act(owner, { id, action: 'verify' });
    db.act(owner, { id, action: 'assign', departmentId: 1 });
    const own = db.listComplaints(assignedStaff).complaints[0];
    assert.equal(own.place_name, sample.placeName);
    assert.equal(own.location_exact, true);
    const publicCase = db.listComplaints(otherStaff).complaints[0];
    assert.equal(publicCase.place_name, null);
    assert.equal(publicCase.location_exact, false);
    assert.equal(publicCase.latitude, 23.747);
    assert.equal(db.complaintDetail(otherStaff, { id }).complaint.place_name, null);
  } finally { db.close(); }
});

const authenticatorCode = (secret, step = Math.floor(Date.now() / 30000)) => {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0, value = 0; const key = [];
  for (const letter of secret) { value = (value << 5) | alphabet.indexOf(letter); bits += 5; if (bits >= 8) { key.push((value >>> (bits -= 8)) & 255); value &= (1 << bits) - 1; } }
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(step));
  const digest = crypto.createHmac('sha1', Buffer.from(key)).update(counter).digest();
  const offset = digest[19] & 15;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(6, '0');
};

test('administrator authenticator protects login, blocks replay and survives password change', async () => {
  const db = await createDatabase(':memory:');
  try {
    const owner = db.bootstrapAdmin({ name: 'Project Owner', email: 'owner@example.test', password: 'owner-secret-password' });
    const setup = db.beginMfa(owner, 'owner-secret-password');
    assert.match(setup.uri, /otpauth:\/\/totp\//);
    assert.throws(() => db.confirmMfa(owner, { password: 'owner-secret-password', code: '000000' }), /Invalid authenticator/);
    db.confirmMfa(owner, { password: 'owner-secret-password', code: authenticatorCode(setup.secret) });
    assert.equal(db.userById(owner.id).mfaEnabled, true);
    assert.throws(() => db.login('owner@example.test', 'owner-secret-password'), /Authenticator code required/);
    assert.throws(() => db.login('owner@example.test', 'wrong-password', authenticatorCode(setup.secret)), /Invalid email or password/);
    const currentStep = Math.floor(Date.now() / 30000);
    assert.equal(db.login('owner@example.test', 'owner-secret-password', authenticatorCode(setup.secret, currentStep)).id, owner.id);
    assert.throws(() => db.login('owner@example.test', 'owner-secret-password', authenticatorCode(setup.secret, currentStep)), /Invalid authenticator/);
    db.changePassword(owner, { currentPassword: 'owner-secret-password', newPassword: 'new-owner-secret-password' });
    assert.throws(() => db.login('owner@example.test', 'owner-secret-password', authenticatorCode(setup.secret, currentStep + 1)), /Invalid email or password/);
    assert.equal(db.login('owner@example.test', 'new-owner-secret-password', authenticatorCode(setup.secret, currentStep + 1)).id, owner.id);
    db.disableMfa(owner, { password: 'new-owner-secret-password', code: authenticatorCode(setup.secret) });
    assert.equal(db.login('owner@example.test', 'new-owner-secret-password').mfaEnabled, false);
  } finally { db.close(); }
});

test('citizen data removal requires owner review and scrubs report details', async () => {
  const db = await createDatabase(':memory:');
  try {
    const owner = db.bootstrapAdmin({ name: 'Project Owner', email: 'owner@example.test', password: 'owner-secret-password' });
    const citizen = db.register({ name: 'Private Resident', email: 'private@example.test', area: 'DNCC Ward 15', password: 'citizen-password-123' });
    const complaintId = db.createComplaint(citizen, sample);
    db.postCaseMessage(citizen, { id: complaintId, body: 'Private details for the team', image: 'data:image/png;base64,AAAA' });
    assert.throws(() => db.requestPrivacyRemoval(citizen, { password: 'wrong' }), /password/);
    const requestId = db.requestPrivacyRemoval(citizen, { password: 'citizen-password-123', reason: 'Please remove my details.' });
    assert.equal(db.snapshot(citizen).privacyRequest.status, 'Pending');
    assert.throws(() => db.requestPrivacyRemoval(citizen, { password: 'citizen-password-123' }), /already pending/);
    assert.throws(() => db.decidePrivacyRemoval(citizen, { requestId, decision: 'Approved' }), /permission/);
    const decision = db.decidePrivacyRemoval(owner, { requestId, decision: 'Approved' });
    assert.equal(decision.userId, citizen.id);
    assert.equal(db.userById(citizen.id), null);
    assert.throws(() => db.login('private@example.test', 'citizen-password-123'), /Invalid email or password/);
    const report = db.complaintDetail(owner, { id: complaintId }).complaint;
    assert.equal(report.title, 'Archived citizen report');
    assert.equal(report.image, null);
    assert.equal(report.place_name, null);
    assert.equal(report.location_exact, false);
    assert.equal(report.description.includes('Vehicles'), false);
    const erasedMessage = db.automaticBackupData().tables.case_messages[0];
    assert.equal(erasedMessage.body, '');
    assert.equal(erasedMessage.image, null);
    assert.equal(db.snapshot(owner).privacyRequests[0].reason, '');
  } finally { db.close(); }
});

test('owner can preview and anonymize only old terminal cases', async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'civicpulse-retention-'));
  const file = path.join(folder, 'cases.sqlite');
  try {
    let db = await createDatabase(file);
    const owner = db.bootstrapAdmin({ name: 'Project Owner', email: 'owner@example.test', password: 'owner-secret-password' });
    const citizen = db.register({ name: 'First Citizen', email: 'first@example.test', area: 'DNCC Ward 15', password: 'citizen-password-123' });
    const oldId = db.createComplaint(citizen, sample);
    db.act(owner, { id: oldId, action: 'reject', note: 'Cannot verify the old report.' });
    const activeId = db.createComplaint(citizen, { ...sample, title: 'Current crossing damage' });
    db.close();
    const SQL = await initSqlJs({ locateFile: () => require.resolve('sql.js/dist/sql-wasm.wasm') });
    const raw = new SQL.Database(fs.readFileSync(file));
    raw.run("UPDATE complaints SET created_at=datetime('now','-800 days') WHERE id IN (?,?)", [oldId,activeId]);
    fs.writeFileSync(file, Buffer.from(raw.export())); raw.close();
    db = await createDatabase(file);
    assert.equal(db.retentionPreview(owner, { days: 730 }), 1);
    assert.throws(() => db.applyRetention(citizen, { days: 730, password: 'citizen-password-123', confirm: 'ANONYMIZE' }), /permission/);
    assert.throws(() => db.applyRetention(owner, { days: 730, password: 'wrong', confirm: 'ANONYMIZE' }), /password/);
    assert.equal(db.applyRetention(owner, { days: 730, password: 'owner-secret-password', confirm: 'ANONYMIZE' }).processed, 1);
    assert.equal(db.retentionPreview(owner, { days: 730 }), 0);
    assert.equal(db.complaintDetail(owner, { id: oldId }).complaint.image, null);
    assert.equal(db.complaintDetail(owner, { id: activeId }).complaint.title, 'Current crossing damage');
    assert.equal(db.areaSummary(owner, { query: 'Dhaka' }).total, 1);
    db.close();
  } finally { assert.ok(path.resolve(folder).startsWith(path.resolve(os.tmpdir()) + path.sep)); fs.rmSync(folder, { recursive: true, force: true }); }
});

test('repair evidence, citizen rework review and department scorecard', async () => {
  const db = await createDatabase(':memory:');
  try {
    const owner = db.bootstrapAdmin({ name: 'Project Owner', email: 'owner@example.test', password: 'owner-secret-password' });
    const citizen = db.register({ name: 'First Citizen', email: 'first@example.test', area: 'DNCC Ward 15', password: 'citizen-password-123' });
    const other = db.register({ name: 'Other Citizen', email: 'other@example.test', area: 'DNCC Ward 15', password: 'citizen-password-123' });
    db.manage(owner, { type: 'user', name: 'Road Worker', email: 'staff@example.test', password: 'staff-password-123', role: 'staff', departmentId: 1 });
    const staff = db.login('staff@example.test', 'staff-password-123');
    const id = db.createComplaint(citizen, sample);
    db.act(owner, { id, action: 'verify' });
    db.act(owner, { id, action: 'assign', departmentId: 1 });
    db.act(staff, { id, action: 'start' });
    assert.throws(() => db.act(staff, { id, action: 'resolve', note: 'Completed repair.' }), /completion photo/i);
    db.act(staff, { id, action: 'resolve', note: 'Completed repair.', image: sample.image });
    const evidence = db.complaintDetail(citizen, { id }).cycles[0];
    assert.equal(evidence.completion_image, sample.image);
    assert.equal(evidence.completion_note, 'Completed repair.');
    db.submitFeedback(citizen, { id, rating: 4, resolution: 'Yes' });
    db.act(owner, { id, action: 'finish' });
    assert.throws(() => db.requestReopen(other, { id, reason: 'The repair failed again.' }), /Only the reporter/);
    const requestId = db.requestReopen(citizen, { id, reason: 'The repaired surface broke again.' });
    assert.throws(() => db.requestReopen(citizen, { id, reason: 'The repaired surface broke again.' }), /already awaiting/);
    assert.equal(db.performance(owner).pendingReopenRequests[0].id, requestId);
    assert.throws(() => db.complaintDetail(other, { id }), /Complaint not found/);
    db.decideReopen(owner, { requestId, decision: 'Approved', note: 'Return to department for inspection.' });
    assert.equal(db.complaintDetail(owner, { id }).complaint.status, 'Reopened');
    assert.equal(db.performance(owner).pendingReopenRequests.length, 0);
    assert.equal(db.performance(owner).departments.find(row => row.id === 1).reopened_percent, 100);
    db.act(owner, { id, action: 'assign', departmentId: 1 });
    db.act(staff, { id, action: 'start' });
    db.act(staff, { id, action: 'resolve', note: 'Repaired again after inspection.', image: sample.image });
    db.submitFeedback(citizen, { id, rating: 5, resolution: 'Yes' });
    db.act(owner, { id, action: 'finish' });
    const score = db.performance(owner).departments.find(row => row.id === 1);
    assert.equal(score.finished, 1);
    assert.equal(score.rating_count, 1);
    assert.equal(score.reopened_percent, 100);
    assert.equal(score.reopen_sample_count, 1);
    assert.equal(score.on_time_percent, 100);
    assert.equal(db.complaintDetail(citizen, { id }).cycles.length, 2);
  } finally { db.close(); }
});

test('deadline escalation is recorded once and reaches staff then administrators', async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'civicpulse-escalation-'));
  const file = path.join(folder, 'cases.sqlite');
  try {
    let db = await createDatabase(file);
    const owner = db.bootstrapAdmin({ name: 'Project Owner', email: 'owner@example.test', password: 'owner-secret-password' });
    const citizen = db.register({ name: 'First Citizen', email: 'first@example.test', area: 'DNCC Ward 15', password: 'citizen-password-123' });
    db.manage(owner, { type: 'user', name: 'Road Worker', email: 'staff@example.test', password: 'staff-password-123', role: 'staff', departmentId: 1 });
    const staff = db.login('staff@example.test', 'staff-password-123');
    const id = db.createComplaint(citizen, sample);
    db.act(owner, { id, action: 'verify' });
    db.act(owner, { id, action: 'assign', departmentId: 1 });
    db.close();
    const SQL = await initSqlJs({ locateFile: () => require.resolve('sql.js/dist/sql-wasm.wasm') });
    let raw = new SQL.Database(fs.readFileSync(file));
    raw.run("UPDATE complaints SET resolution_due_at=datetime('now','+1 hour') WHERE id=?", [id]);
    fs.writeFileSync(file, Buffer.from(raw.export())); raw.close();
    db = await createDatabase(file);
    assert.equal(db.processEscalations().length, 1);
    assert.equal(db.processEscalations().length, 0);
    assert.match(db.snapshot(staff).notifications[0].title, /Due soon/);
    db.close();
    raw = new SQL.Database(fs.readFileSync(file));
    raw.run("UPDATE complaints SET resolution_due_at=datetime('now','-1 hour') WHERE id=?", [id]);
    fs.writeFileSync(file, Buffer.from(raw.export())); raw.close();
    db = await createDatabase(file);
    assert.equal(db.processEscalations().length, 1);
    assert.equal(db.processEscalations().length, 0);
    assert.match(db.snapshot(owner).notifications[0].title, /Overdue/);
    assert.equal(db.complaintDetail(owner, { id }).escalationEvents.length, 2);
    db.close();
  } finally { fs.rmSync(folder, { recursive: true, force: true }); }
});

test('closure targets and recurring issues keep other reporter details private', async () => {
  const db = await createDatabase(':memory:');
  try {
    const owner = db.bootstrapAdmin({ name: 'Project Owner', email: 'owner@example.test', password: 'owner-secret-password' });
    const firstReporter = db.register({ name: 'First Citizen', email: 'first@example.test', area: 'DNCC Ward 15', password: 'citizen-password-123' });
    const nextReporter = db.register({ name: 'Second Citizen', email: 'second@example.test', area: 'DNCC Ward 15', password: 'citizen-password-123' });
    db.manage(owner, { type: 'resolutionTime', categoryId: 2, hours: 24 });
    const originalId = db.createComplaint(firstReporter, sample);
    const first = db.complaintDetail(owner, { id: originalId }).complaint;
    assert.equal((Date.parse(first.resolution_due_at.replace(' ', 'T') + 'Z') - Date.parse(first.created_at.replace(' ', 'T') + 'Z')) / 3600000, 24);
    db.manage(owner, { type: 'resolutionTime', categoryId: 2, hours: 48 });
    assert.equal(db.complaintDetail(owner, { id: originalId }).complaint.resolution_due_at, first.resolution_due_at);
    db.act(owner, { id: originalId, action: 'verify' });
    db.act(owner, { id: originalId, action: 'assign', departmentId: 1 });
    const staff = db.manage(owner, { type: 'user', name: 'Road Worker', email: 'staff@example.test', password: 'staff-password-123', role: 'staff', departmentId: 1 });
    assert.ok(staff);
    const worker = db.login('staff@example.test', 'staff-password-123');
    db.act(worker, { id: originalId, action: 'start' });
    db.act(worker, { id: originalId, action: 'resolve', note: 'Crossing repaired and inspected.', image: sample.image });
    const alert = db.snapshot(firstReporter).notifications[0];
    assert.match(alert.message, /give a rating/);
    assert.equal(db.snapshot(nextReporter).notifications.length, 0);
    assert.throws(() => db.readNotification(nextReporter, { id: alert.id }), /not found/);
    db.readNotification(firstReporter, { id: alert.id });
    assert.ok(db.snapshot(firstReporter).notifications[0].read_at);
    assert.throws(() => db.act(owner, { id: originalId, action: 'finish' }), /citizen must confirm/i);
    db.submitFeedback(firstReporter, { id: originalId, rating: 5, resolution: 'Yes', comment: 'Confirmed fixed.' });
    assert.equal(db.complaintDetail(owner, { id: originalId }).complaint.status, 'Citizen Verified');
    assert.ok(db.complaintDetail(owner, { id: originalId }).complaint.closed_at);
    assert.equal(db.summary(owner).counts.citizen_verified, 1);
    assert.throws(() => db.act(worker, { id: originalId, action: 'finish' }), /permission/);
    assert.throws(() => db.act(firstReporter, { id: originalId, action: 'finish' }), /permission/);
    db.act(owner, { id: originalId, action: 'finish' });
    assert.equal(db.complaintDetail(owner, { id: originalId }).complaint.status, 'Finished');
    const performance = db.performance(owner);
    assert.equal(performance.departments.find(row => row.id === 1).average_rating, 5);
    assert.equal(performance.departments.find(row => row.id === 1).finished, 1);
    assert.equal(performance.areas.find(row => row.area === 'DNCC Ward 15').finished, 1);
    assert.throws(() => db.performance(worker), /permission/);
    assert.throws(() => db.performance(firstReporter), /permission/);
    const recurringId = db.createComplaint(nextReporter, { ...sample, title: 'Same crossing has broken again', latitude: sample.latitude + 0.0001 });
    const adminDetail = db.complaintDetail(owner, { id: recurringId });
    assert.equal(adminDetail.complaint.recurrence_of, originalId);
    assert.equal(adminDetail.recurrence.code, first.code);
    assert.equal(db.listComplaints(owner, { scope: 'Recurring issues' }).total, 1);
    const citizenDetail = db.complaintDetail(nextReporter, { id: recurringId });
    assert.equal(citizenDetail.complaint.recurrence_flag, true);
    assert.equal(citizenDetail.complaint.recurrence_of, null);
    assert.equal(citizenDetail.recurrence, null);
    assert.throws(() => db.complaintDetail(nextReporter, { id: originalId }), /not found/);
    assert.throws(() => db.manage(nextReporter, { type: 'resolutionTime', categoryId: 2, hours: 1 }), /permission/);
    assert.throws(() => db.act(nextReporter, { id: recurringId, action: 'dismissRecurrence', note: 'Different location' }), /permission/);
    db.act(owner, { id: recurringId, action: 'dismissRecurrence', note: 'Separate damaged curb.' });
    assert.equal(db.complaintDetail(owner, { id: recurringId }).complaint.recurrence_flag, false);
    const farId = db.createComplaint(nextReporter, { ...sample, title: 'Another crossing broken farther away', latitude: sample.latitude + 0.003 });
    assert.equal(db.complaintDetail(owner, { id: farId }).complaint.recurrence_flag, false);
  } finally { db.close(); }
});

test('older database receives closure fields without losing a closed report', async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'civicpulse-migrate-'));
  const file = path.join(folder, 'legacy.sqlite');
  try {
    const SQL = await initSqlJs({ locateFile: () => require.resolve('sql.js/dist/sql-wasm.wasm') });
    const old = new SQL.Database();
    old.run("CREATE TABLE users (id INTEGER PRIMARY KEY,name TEXT NOT NULL,email TEXT NOT NULL UNIQUE,password_hash TEXT NOT NULL,role TEXT NOT NULL,area TEXT NOT NULL DEFAULT '',verified_area INTEGER NOT NULL DEFAULT 0,active INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)");
    old.run('CREATE TABLE departments (id INTEGER PRIMARY KEY,name TEXT NOT NULL UNIQUE,active INTEGER NOT NULL DEFAULT 1)');
    old.run('CREATE TABLE categories (id INTEGER PRIMARY KEY,name TEXT NOT NULL UNIQUE,department_id INTEGER,active INTEGER NOT NULL DEFAULT 1)');
    old.run("CREATE TABLE complaints (id INTEGER PRIMARY KEY,code TEXT UNIQUE,reporter_id INTEGER NOT NULL,title TEXT NOT NULL,description TEXT NOT NULL,category_id INTEGER NOT NULL,area TEXT NOT NULL,latitude REAL NOT NULL,longitude REAL NOT NULL,severity TEXT NOT NULL,priority TEXT NOT NULL DEFAULT 'Normal',status TEXT NOT NULL DEFAULT 'Submitted',department_id INTEGER,image TEXT,completion_image TEXT,duplicate_of INTEGER,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,resolved_at TEXT)");
    old.run("CREATE TABLE cycles (id INTEGER PRIMARY KEY,complaint_id INTEGER NOT NULL,number INTEGER NOT NULL,resolved_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,reopened_at TEXT,closed_at TEXT,UNIQUE(complaint_id,number))");
    old.run("INSERT INTO users (id,name,email,password_hash,role,area) VALUES (1,'Owner','owner@example.test','unused:hash','superadmin','Dhaka')");
    old.run("INSERT INTO departments (id,name) VALUES (1,'Roads')");
    old.run("INSERT INTO categories (id,name,department_id) VALUES (1,'Potholes',1)");
    old.run("INSERT INTO complaints (id,code,reporter_id,title,description,category_id,area,latitude,longitude,severity,status,created_at,updated_at) VALUES (1,'C-1001',1,'Old pothole','A pothole existed here.',1,'Dhanmondi',23.7469,90.3754,'High','Closed','2026-01-01 00:00:00','2026-01-02 00:00:00')");
    old.run("INSERT INTO cycles (complaint_id,number,closed_at) VALUES (1,1,'2026-01-03 00:00:00')");
    fs.writeFileSync(file, Buffer.from(old.export())); old.close();
    const migrated = await createDatabase(file);
    try {
      const caseRow = migrated.complaintDetail(migrated.userById(1), { id: 1 }).complaint;
      assert.equal(caseRow.code, 'C-1001');
      assert.equal(caseRow.closed_at, '2026-01-03 00:00:00');
      assert.equal(caseRow.resolution_due_at, '2026-01-08 00:00:00');
      assert.equal(migrated.snapshot(migrated.userById(1)).categories[0].resolution_hours, 168);
    } finally { migrated.close(); }
  } finally { fs.rmSync(folder, { recursive: true, force: true }); }
});

test('unconfirmed work cannot be finished and a new repair cycle needs fresh confirmation', async () => {
  const db = await createDatabase(':memory:');
  try {
    const owner = db.bootstrapAdmin({ name: 'Owner', email: 'owner@review.test', password: 'owner-secret-password' });
    const citizen = db.register({ name: 'Resident', email: 'resident@review.test', area: 'DNCC Ward 15', password: 'citizen-password-123' });
    db.manage(owner, { type: 'user', name: 'Road Team', email: 'roads@review.test', password: 'staff-password-123', role: 'staff', departmentId: 1 });
    const worker = db.login('roads@review.test', 'staff-password-123');
    const id = db.createComplaint(citizen, sample);
    db.act(owner, { id, action: 'verify' });
    db.act(owner, { id, action: 'assign', departmentId: 1 });
    db.act(worker, { id, action: 'start' });
    db.act(worker, { id, action: 'resolve', note: 'First repair attempt completed.', image: sample.image });
    db.submitFeedback(citizen, { id, rating: 2, resolution: 'Partially', comment: 'Damage remains.' });
    assert.equal(db.complaintDetail(owner, { id }).complaint.status, 'Awaiting Feedback');
    assert.throws(() => db.act(owner, { id, action: 'finish' }), /citizen must confirm/i);
    assert.equal(db.performance(owner).departments.find(row => row.id === 1).finished, 0);
    db.act(owner, { id, action: 'reopen', note: 'Redo the incomplete repair.' });
    db.act(worker, { id, action: 'start' });
    db.act(worker, { id, action: 'resolve', note: 'Second repair completed and inspected.', image: sample.image });
    assert.equal(db.snapshot(citizen).notifications.length, 2);
    db.submitFeedback(citizen, { id, rating: 4, resolution: 'Yes', comment: 'Now fixed.' });
    db.act(owner, { id, action: 'finish' });
    const result = db.performance(owner);
    assert.equal(result.departments.find(row => row.id === 1).finished, 1);
    assert.equal(result.departments.find(row => row.id === 1).average_rating, 4);
    assert.equal(result.areas.find(row => row.area === 'DNCC Ward 15').finished, 1);
  } finally { db.close(); }
});

test('overdue closure filters clear on confirmation and a rework gets a new deadline', async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'civicpulse-deadline-'));
  const file = path.join(folder, 'cases.sqlite');
  try {
    const db = await createDatabase(file);
    const owner = db.bootstrapAdmin({ name: 'Project Owner', email: 'owner@example.test', password: 'owner-secret-password' });
    const citizen = db.register({ name: 'First Citizen', email: 'first@example.test', area: 'DNCC Ward 15', password: 'citizen-password-123' });
    const reportId = db.createComplaint(citizen, sample);
    db.close();
    const SQL = await initSqlJs({ locateFile: () => require.resolve('sql.js/dist/sql-wasm.wasm') });
    const raw = new SQL.Database(fs.readFileSync(file));
    raw.run("UPDATE complaints SET resolution_due_at=datetime('now','-1 hour') WHERE id=?", [reportId]);
    fs.writeFileSync(file, Buffer.from(raw.export())); raw.close();
    const reopened = await createDatabase(file);
    try {
      assert.equal(reopened.summary(owner).counts.overdue_closure, 1);
      assert.equal(reopened.listComplaints(owner, { scope: 'Overdue closure' }).total, 1);
      reopened.act(owner, { id: reportId, action: 'verify' });
      reopened.act(owner, { id: reportId, action: 'assign', departmentId: 1 });
      reopened.manage(owner, { type: 'user', name: 'Road Worker', email: 'staff@example.test', password: 'staff-password-123', role: 'staff', departmentId: 1 });
      const staff = reopened.login('staff@example.test', 'staff-password-123');
      reopened.act(staff, { id: reportId, action: 'start' });
      reopened.act(staff, { id: reportId, action: 'resolve', note: 'The repair has been completed.', image: sample.image });
      reopened.submitFeedback(citizen, { id: reportId, rating: 5, resolution: 'Yes' });
      assert.equal(reopened.summary(owner).counts.overdue_closure, 0);
      assert.equal(reopened.listComplaints(owner, { scope: 'Overdue closure' }).total, 0);
      reopened.act(owner, { id: reportId, action: 'reopen', note: 'The repair failed on inspection.' });
      assert.equal(reopened.summary(owner).counts.overdue_closure, 0);
      assert.equal(reopened.complaintDetail(owner, { id: reportId }).complaint.closed_at, null);
      assert.ok(reopened.complaintDetail(owner, { id: reportId }).complaint.resolution_due_at > reopened.complaintDetail(owner, { id: reportId }).complaint.updated_at);
    } finally { reopened.close(); }
  } finally { fs.rmSync(folder, { recursive: true, force: true }); }
});

test('email verification and recovery links are single use', async () => {
  const db = await createDatabase(':memory:');
  try {
    db.bootstrapAdmin({ name: 'Project Owner', email: 'owner@example.test', password: 'owner-secret-password' });
    const citizen = db.register({ name: 'First Citizen', email: 'first@example.test', area: 'DNCC Ward 15', password: 'citizen-password-123' });
    assert.equal(citizen.emailVerified, false);
    const verify = db.issueAccountToken(citizen.id, 'verify');
    assert.equal(verify.email, citizen.email);
    assert.throws(() => db.issueAccountToken(citizen.id, 'verify'), /wait a minute/);
    assert.equal(db.consumeAccountToken(verify.token, 'verify'), citizen.id);
    assert.equal(db.userById(citizen.id).emailVerified, true);
    assert.throws(() => db.consumeAccountToken(verify.token, 'verify'), /expired link/);
    const reset = db.issueAccountToken(citizen.id, 'reset');
    assert.throws(() => db.consumeAccountToken(reset.token, 'reset', 'short'), /12 to 128/);
    db.consumeAccountToken(reset.token, 'reset', 'recovered-password-123');
    assert.throws(() => db.login(citizen.email, 'citizen-password-123'), /Invalid email/);
    assert.equal(db.login(citizen.email, 'recovered-password-123').id, citizen.id);
    assert.throws(() => db.consumeAccountToken(reset.token, 'reset', 'another-password-123'), /expired link/);
    const code = db.issueRecoveryCode(citizen, 'recovered-password-123');
    assert.equal(code.length, 43);
    assert.throws(() => db.issueRecoveryCode(citizen, 'wrong'), /Current password/);
    db.consumeAccountToken(code, 'recovery', 'another-password-123');
    assert.equal(db.login(citizen.email, 'another-password-123').id, citizen.id);
    assert.throws(() => db.consumeAccountToken(code, 'recovery', 'yet-another-password-123'), /expired link/);
  } finally { db.close(); }
});

test('clean setup, private reports, department scope and account controls', async () => {
  assert.equal(Math.round(haversineMeters(sample, sample)), 0);
  const db = await createDatabase(':memory:');
  try {
    assert.equal(db.setupRequired(), true);
    assert.throws(() => db.areaSummary(null), /sign in/);
    const owner = db.bootstrapAdmin({ name: 'Project Owner', email: 'owner@example.test', password: 'owner-secret-password' });
    assert.equal(db.setupRequired(), false);
    assert.throws(() => db.bootstrapAdmin({ name: 'Another Owner', email: 'another@example.test', password: 'owner-secret-password' }), /already configured/);
    const citizen = db.register({ name: 'First Citizen', email: 'first@example.test', area: 'DNCC Ward 15', password: 'citizen-password-123' });
    const neighbor = db.register({ name: 'Second Citizen', email: 'second@example.test', area: 'DNCC Ward 15', password: 'citizen-password-123' });
    db.manage(owner, { type: 'user', name: 'Road Worker', email: 'staff@example.test', password: 'staff-password-123', role: 'staff', departmentId: 1 });
    db.manage(owner, { type: 'user', name: 'Service Admin', email: 'admin@example.test', password: 'admin-password-123', role: 'admin' });
    const staff = db.login('staff@example.test', 'staff-password-123');
    const admin = db.login('admin@example.test', 'admin-password-123');
    const id = db.createComplaint(citizen, sample);
    assert.equal(db.areaSummary(owner).total, 1);
    assert.equal(db.areaSummary(neighbor, { query: 'DNCC' }).total, 1);
    assert.equal(db.snapshot(neighbor).complaints.length, 0);
    assert.equal(db.snapshot(staff).complaints.length, 0);
    assert.equal(db.snapshot(citizen).complaints[0].image, null);
    assert.equal(db.complaintDetail(citizen, { id }).complaint.image, sample.image);
    assert.throws(() => db.act(staff, { id, action: 'verify' }), /permission/);
    db.act(admin, { id, action: 'verify' });
    assert.equal(db.snapshot(neighbor).complaints.length, 0);
    assert.equal(db.listComplaints(neighbor).total, 0);
    assert.equal(db.nearby(neighbor, sample).length, 0);
    assert.throws(() => db.complaintDetail(neighbor, { id }), /not found/);
    assert.equal(db.snapshot(neighbor).updates.length, 0);
    assert.throws(() => db.act(staff, { id, action: 'start' }), /another department/);
    db.act(admin, { id, action: 'assign', departmentId: 1 });
    db.act(staff, { id, action: 'start' });
    db.act(staff, { id, action: 'resolve', note: 'Crossing surface repaired.', image: sample.image });
    assert.throws(() => db.submitFeedback(neighbor, { id, rating: 5, resolution: 'Yes' }), /own report/);
    db.submitFeedback(citizen, { id, rating: 5, resolution: 'Yes', comment: 'Repair confirmed' });
    assert.equal(db.snapshot(citizen).feedback[0].comment, 'Repair confirmed');
    const staffId = db.snapshot(owner).users.find(u => u.email === 'staff@example.test').id;
    db.manage(owner, { type: 'userStatus', userId: staffId, active: false });
    assert.equal(db.userById(staffId), null);
    assert.throws(() => db.login('staff@example.test', 'staff-password-123'), /Invalid email/);
    db.manage(owner, { type: 'userStatus', userId: staffId, active: true });
    assert.equal(db.userById(staffId).role, 'staff');
    assert.throws(() => db.manage(owner, { type: 'userStatus', userId: owner.id, active: false }), /Only administrator/);
    assert.throws(() => db.changePassword(owner, { currentPassword: 'wrong', newPassword: 'new-owner-password-123' }), /Current password/);
    db.changePassword(owner, { currentPassword: 'owner-secret-password', newPassword: 'new-owner-password-123' });
    assert.throws(() => db.login('owner@example.test', 'owner-secret-password'), /Invalid email/);
    assert.equal(db.login('owner@example.test', 'new-owner-password-123').role, 'superadmin');
  } finally { db.close(); }
});

test('cursor pages cover all visible reports and search reaches older records', async () => {
  const db = await createDatabase(':memory:');
  try {
    const owner = db.bootstrapAdmin({ name: 'Project Owner', email: 'owner@example.test', password: 'owner-secret-password' });
    const citizen = db.register({ name: 'First Citizen', email: 'first@example.test', area: 'DNCC Ward 15', password: 'citizen-password-123' });
    for (let n = 1; n <= 55; n++) {
      const id = db.createComplaint(citizen, { ...sample, title: `Broken crossing number ${n}` });
      if (n <= 30) db.act(owner, { id, action: 'verify' });
    }
    const first = db.listComplaints(citizen);
    const second = db.listComplaints(citizen, { cursor: first.nextCursor });
    const third = db.listComplaints(citizen, { cursor: second.nextCursor });
    assert.deepEqual([first.complaints.length, second.complaints.length, third.complaints.length], [25, 25, 5]);
    assert.equal(first.total, 55);
    assert.equal(third.nextCursor, null);
    assert.equal(new Set([...first.complaints, ...second.complaints, ...third.complaints].map(c => c.id)).size, 55);
    assert.equal(db.snapshot(citizen).complaints.length, 25);
    assert.equal(db.snapshot(citizen).summary.counts.total, 55);
    assert.equal(db.areaSummary(owner).total, 55);
    assert.equal(db.areaSummary(citizen, { query: 'DNCC Ward 15' }).total, 55);
    assert.equal(db.listComplaints(owner, { query: 'number 1' }).total, 11);
    assert.equal(db.listComplaints(owner, { scope: 'Needs verification' }).total, 25);
  } finally { db.close(); }
});

test('owner backup requires password, pages complete data, and restores a checked database', async () => {
  const db = await createDatabase(':memory:');
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'civicpulse-backup-'));
  try {
    const owner = db.bootstrapAdmin({ name: 'Project Owner', email: 'owner@example.test', password: 'owner-secret-password' });
    const citizen = db.register({ name: 'First Citizen', email: 'first@example.test', area: 'DNCC Ward 15', password: 'citizen-password-123' });
    for (let n = 0; n < 7; n++) db.createComplaint(citizen, { ...sample, title: `Crossing ${n}` });
    const firstId = db.listComplaints(owner).complaints[0].id;
    db.act(owner, { id: firstId, action: 'verify' });
    db.act(owner, { id: firstId, action: 'assign', departmentId: 1 });
    db.manage(owner, { type: 'user', name: 'Road Worker', email: 'road@backup.test', password: 'staff-password-123', role: 'staff', departmentId: 1 });
    const worker = db.login('road@backup.test', 'staff-password-123');
    db.act(worker, { id: firstId, action: 'start' });
    db.act(worker, { id: firstId, action: 'resolve', note: 'The damaged area was repaired.', image: sample.image });
    assert.throws(() => db.beginBackup(citizen, { password: 'citizen-password-123' }), /permission/);
    assert.throws(() => db.beginBackup(owner, { password: 'wrong' }), /Invalid password/);
    const access = db.beginBackup(owner, { password: 'owner-secret-password' });
    const tables = {};
    for (const table of access.tables) {
      tables[table] = [];
      let cursor = null;
      do {
        const page = db.backupPage(owner, { token: access.token, table, cursor });
        tables[table].push(...page.rows);
        cursor = page.nextCursor;
      } while (cursor !== null);
    }
    assert.equal(tables.complaints.length, 7);
    assert.equal(tables.users.length, 3);
    assert.equal(tables.notifications.length, 1);
    assert.ok(tables.users[0].password_hash);
    assert.throws(() => db.backupPage(citizen, { token: access.token, table: 'users' }), /permission/);
    assert.throws(() => db.backupPage(owner, { token: access.token, table: 'sessions' }), /Unknown backup table/);
    const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12);
    const key = crypto.pbkdf2Sync('test-secret-passphrase', salt, 310_000, 32, 'sha256');
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify({ format: 'civicpulse-backup-v1', createdAt: new Date().toISOString(), tables })), cipher.final(), cipher.getAuthTag()]);
    const bytes = Buffer.concat([Buffer.from('CPBK1'), salt, iv, ciphertext]);
    assert.equal(decryptBackup(bytes, 'test-secret-passphrase').tables.complaints.length, 7);
    assert.throws(() => decryptBackup(bytes, 'wrong-passphrase'));
    const target = path.join(folder, 'restored.sqlite');
    await restoreNew(decryptBackup(bytes, 'test-secret-passphrase'), target);
    const restored = await createDatabase(target);
    try { assert.equal(restored.listComplaints(owner).total, 7); assert.equal(restored.areaSummary(owner, { query: 'DNCC Ward 15' }).total, 7); assert.equal(restored.login('owner@example.test', 'owner-secret-password').role, 'superadmin'); assert.equal(restored.snapshot(citizen).notifications.length, 1); }
    finally { restored.close(); }
    const legacyTables = { ...tables }; delete legacyTables.notifications;
    const olderTarget = path.join(folder, 'older-backup.sqlite');
    await restoreNew({ format: 'civicpulse-backup-v1', tables: legacyTables }, olderTarget);
    const older = await createDatabase(olderTarget);
    try { assert.equal(older.snapshot(citizen).notifications.length, 0); }
    finally { older.close(); }
    db.endBackup(owner, { token: access.token });
    assert.throws(() => db.backupPage(owner, { token: access.token, table: 'users' }), /expired/);
  } finally { db.close(); fs.rmSync(folder, { recursive: true, force: true }); }
});
