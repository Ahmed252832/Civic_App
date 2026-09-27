const test = require('node:test');
const assert = require('node:assert/strict');
const { createDatabase, haversineMeters } = require('./database.cjs');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { decryptBackup, restoreNew } = require('../scripts/restore-backup.cjs');

const sample = { title: 'Broken crossing at the corner', description: 'Vehicles are swerving around the damaged crossing.', categoryId: 2, area: 'Dhanmondi', latitude: 23.7469, longitude: 90.3754, severity: 'High', image: 'data:image/png;base64,AAAA' };

test('clean setup, private reports, department scope and account controls', async () => {
  assert.equal(Math.round(haversineMeters(sample, sample)), 0);
  const db = await createDatabase(':memory:');
  try {
    assert.equal(db.setupRequired(), true);
    assert.equal(db.publicSnapshot().complaints.length, 0);
    const owner = db.bootstrapAdmin({ name: 'Project Owner', email: 'owner@example.test', password: 'owner-secret-password' });
    assert.equal(db.setupRequired(), false);
    assert.throws(() => db.bootstrapAdmin({ name: 'Another Owner', email: 'another@example.test', password: 'owner-secret-password' }), /already configured/);
    const citizen = db.register({ name: 'First Citizen', email: 'first@example.test', area: 'Dhanmondi', password: 'citizen-password-123' });
    const neighbor = db.register({ name: 'Second Citizen', email: 'second@example.test', area: 'Dhanmondi', password: 'citizen-password-123' });
    db.manage(owner, { type: 'user', name: 'Road Worker', email: 'staff@example.test', password: 'staff-password-123', role: 'staff', departmentId: 1 });
    db.manage(owner, { type: 'user', name: 'Service Admin', email: 'admin@example.test', password: 'admin-password-123', role: 'admin' });
    const staff = db.login('staff@example.test', 'staff-password-123');
    const admin = db.login('admin@example.test', 'admin-password-123');
    const id = db.createComplaint(citizen, sample);
    assert.equal(db.publicSnapshot().complaints.length, 0);
    assert.equal(db.snapshot(neighbor).complaints.length, 0);
    assert.equal(db.snapshot(staff).complaints.length, 0);
    assert.equal(db.snapshot(citizen).complaints[0].image, null);
    assert.equal(db.complaintDetail(citizen, { id }).complaint.image, sample.image);
    assert.throws(() => db.act(staff, { id, action: 'verify' }), /permission/);
    db.act(admin, { id, action: 'verify' });
    const publicCase = db.publicSnapshot().complaints[0];
    assert.equal(publicCase.description, '');
    assert.equal(publicCase.latitude, 23.747);
    const neighborCase = db.snapshot(neighbor).complaints[0];
    assert.equal(neighborCase.reporter_id, null);
    assert.equal(neighborCase.image, null);
    assert.equal(neighborCase.description, '');
    assert.equal(db.snapshot(neighbor).updates.length, 0);
    assert.throws(() => db.act(staff, { id, action: 'start' }), /another department/);
    db.act(admin, { id, action: 'assign', departmentId: 1 });
    db.act(staff, { id, action: 'start' });
    db.act(staff, { id, action: 'resolve', note: 'Crossing surface repaired.' });
    db.submitFeedback(neighbor, { id, rating: 5, resolution: 'Yes', comment: 'My private comment' });
    assert.equal(db.snapshot(citizen).feedback.find(f => f.user_id === null).comment, '');
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
    const citizen = db.register({ name: 'First Citizen', email: 'first@example.test', area: 'Dhanmondi', password: 'citizen-password-123' });
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
    const publicFirst = db.publicSnapshot();
    const publicSecond = db.publicSnapshot({ cursor: publicFirst.nextCursor });
    assert.deepEqual([publicFirst.complaints.length, publicSecond.complaints.length], [25, 5]);
    assert.equal(publicFirst.total, 30);
    assert.equal(db.publicSnapshot({ query: 'number 1' }).total, 11);
    assert.equal(db.listComplaints(owner, { query: 'number 1' }).total, 11);
    assert.equal(db.listComplaints(owner, { scope: 'Needs verification' }).total, 25);
  } finally { db.close(); }
});

test('owner backup requires password, pages complete data, and restores a checked database', async () => {
  const db = await createDatabase(':memory:');
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'civicpulse-backup-'));
  try {
    const owner = db.bootstrapAdmin({ name: 'Project Owner', email: 'owner@example.test', password: 'owner-secret-password' });
    const citizen = db.register({ name: 'First Citizen', email: 'first@example.test', area: 'Dhanmondi', password: 'citizen-password-123' });
    for (let n = 0; n < 7; n++) db.createComplaint(citizen, { ...sample, title: `Crossing ${n}` });
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
    assert.equal(tables.users.length, 2);
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
    try { assert.equal(restored.listComplaints(owner).total, 7); assert.equal(restored.login('owner@example.test', 'owner-secret-password').role, 'superadmin'); }
    finally { restored.close(); }
    db.endBackup(owner, { token: access.token });
    assert.throws(() => db.backupPage(owner, { token: access.token, table: 'users' }), /expired/);
  } finally { db.close(); fs.rmSync(folder, { recursive: true, force: true }); }
});
