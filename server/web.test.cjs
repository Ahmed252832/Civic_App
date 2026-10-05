const test = require('node:test');
const assert = require('node:assert/strict');
const { createWebServer, complaintCsv } = require('./web.cjs');

test('web API protects reports and revokes disabled staff sessions', async () => {
  const { server, database } = await createWebServer({ databasePath: ':memory:', setupKey: 'test-setup-key' });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, payload = {}, cookie, origin) => {
    const response = await fetch(`${base}/api/request`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...(origin ? { Origin: origin } : {}) },
      body: JSON.stringify({ method, payload })
    });
    return { response, body: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
  };
  try {
    assert.equal((await call('config')).body.data.setupRequired, true);
    const replay = await call('publicReplay', { corporation: 'DNCC' });
    assert.equal(replay.response.status, 200);
    assert.deepEqual(replay.body.data.wards, []);
    assert.equal((await call('publicSnapshot')).response.status, 401);
    assert.equal((await call('areaSummary')).response.status, 401);
    assert.equal((await call('register', { name: 'First Citizen', email: 'first@example.test', area: 'Dhaka', password: 'citizen-password-123' })).body.ok, false);
    assert.equal((await call('bootstrap', { key: 'wrong', name: 'Project Owner', email: 'owner@example.test', password: 'owner-secret-password' })).body.ok, false);
    const owner = await call('bootstrap', { key: 'test-setup-key', name: 'Project Owner', email: 'owner@example.test', password: 'owner-secret-password' });
    assert.equal(owner.body.data.role, 'superadmin');
    assert.equal((await call('bootstrap', { key: 'test-setup-key', name: 'Second Owner', email: 'second-owner@example.test', password: 'owner-secret-password' })).body.ok, false);
    const citizen = await call('register', { name: 'First Citizen', email: 'first@example.test', area: 'DNCC Ward 15', password: 'citizen-password-123' });
    const neighbor = await call('register', { name: 'Second Citizen', email: 'second@example.test', area: 'DNCC Ward 15', password: 'citizen-password-123' });
    assert.equal((await call('snapshot', {}, citizen.cookie, 'http://evil.invalid')).response.status, 403);
    assert.equal((await call('snapshot')).response.status, 401);
    const created = await call('create', { title: 'Crossing curb is broken', description: 'Residents have to step into traffic to pass this curb.', categoryId: 1, area: 'DNCC Ward 15', wardCode: 'DNCC-15', placeName: 'Dhanmondi Lake east gate', latitude: 23.7468, longitude: 90.3754, severity: 'High', image: 'data:image/png;base64,AAAA' }, citizen.cookie);
    const id = created.body.data;
    assert.equal((await call('areaSummary', {}, citizen.cookie)).body.data.total, 1);
    assert.equal((await call('snapshot', {}, neighbor.cookie)).body.data.complaints.length, 0);
    assert.equal((await call('listComplaints', {}, neighbor.cookie)).body.data.complaints.length, 0);
    assert.equal((await call('complaintDetail', { id }, neighbor.cookie)).body.ok, false);
    assert.equal((await call('nearbyIssues', { latitude: 23.7468, longitude: 90.3754 }, neighbor.cookie)).body.data.length, 0);
    assert.equal((await call('nearbyIssues', { latitude: 23.7468, longitude: 90.3754 }, owner.cookie)).body.data.length, 1);
    assert.equal((await call('action', { id, action: 'verify' }, citizen.cookie)).response.status, 403);
    await call('manage', { type: 'user', name: 'Service Admin', email: 'admin@example.test', password: 'admin-password-123', role: 'admin' }, owner.cookie);
    await call('manage', { type: 'user', name: 'Road Worker', email: 'staff@example.test', password: 'staff-password-123', role: 'staff', departmentId: 1 }, owner.cookie);
    const admin = await call('login', { email: 'admin@example.test', password: 'admin-password-123' });
    const staff = await call('login', { email: 'staff@example.test', password: 'staff-password-123' });
    for (const cookie of [owner.cookie, admin.cookie, staff.cookie, citizen.cookie, neighbor.cookie]) {
      const area = await call('areaSummary', { query: 'DNCC Ward 15' }, cookie);
      assert.equal(area.body.data.total, 1);
      assert.equal(area.body.data.cityTotal, 1);
      assert.equal('complaints' in area.body.data, false);
    }
    assert.equal((await call('action', { id, action: 'verify' }, admin.cookie)).body.ok, true);
    assert.equal((await call('publicSnapshot')).response.status, 401);
    assert.equal((await call('snapshot', {}, neighbor.cookie)).body.data.complaints.length, 0);
    assert.equal((await call('complaintDetail', { id }, neighbor.cookie)).response.status, 400);
    assert.equal((await call('nearby', { latitude: 23.7468, longitude: 90.3754, categoryId: 1 }, neighbor.cookie)).body.data.length, 0);
    assert.equal((await call('areaSummary', { query: 'DNCC' }, neighbor.cookie)).body.data.total, 1);
    assert.equal((await call('complaintDetail', { id }, citizen.cookie)).body.data.complaint.image, 'data:image/png;base64,AAAA');
    assert.equal((await call('snapshot', {}, staff.cookie)).body.data.complaints[0].image, null);
    assert.equal((await fetch(`${base}/api/export.csv`, { headers: { Cookie: citizen.cookie } })).status, 403);
    assert.equal((await fetch(`${base}/api/export.csv`, { headers: { Cookie: admin.cookie } })).status, 200);
    const staffId = (await call('snapshot', {}, owner.cookie)).body.data.users.find(u => u.role === 'staff').id;
    assert.equal((await call('manage', { type: 'userStatus', userId: staffId, active: false }, owner.cookie)).body.ok, true);
    assert.equal((await call('session', {}, staff.cookie)).body.data, null);
    assert.equal((await call('snapshot', {}, staff.cookie)).response.status, 401);
    const changed = await call('changePassword', { currentPassword: 'citizen-password-123', newPassword: 'new-citizen-password-123' }, citizen.cookie);
    assert.equal(changed.body.ok, true);
    assert.equal((await call('session', {}, citizen.cookie)).body.data, null);
    assert.equal((await call('session', {}, changed.cookie)).body.data.role, 'citizen');
    assert.equal((await call('login', { email: 'first@example.test', password: 'citizen-password-123' })).body.ok, false);
    assert.equal((await call('forgotPassword', { email: 'first@example.test' })).body.ok, false);
    const recovery = database.issueAccountToken(citizen.body.data.id, 'reset');
    assert.equal((await call('resetPassword', { token: recovery.token, newPassword: 'recovered-citizen-password-123' })).body.ok, true);
    assert.equal((await call('session', {}, changed.cookie)).body.data, null);
    const recovered = await call('login', { email: 'first@example.test', password: 'recovered-citizen-password-123' });
    assert.equal(recovered.body.ok, true);
    const code = await call('issueRecoveryCode', { password: 'recovered-citizen-password-123' }, recovered.cookie);
    assert.equal(code.body.data.length, 43);
    assert.equal((await call('recoverWithCode', { code: code.body.data, newPassword: 'code-recovered-password-123' })).body.ok, true);
    assert.equal((await call('session', {}, recovered.cookie)).body.data, null);
    assert.match(complaintCsv([{ code: 'C-9', title: '=HYPERLINK("x")', category: 'Other', area: 'DNCC Ward 15', severity: 'Low', priority: 'Normal', status: 'Submitted' }]), /'=HYPERLINK/);
    assert.equal((await call('complaintPurgePreview', {}, neighbor.cookie)).body.ok, false);
    assert.equal((await call('purgeComplaints', { password: 'owner-secret-password', confirm: 'DELETE COMPLAINTS' }, neighbor.cookie)).body.ok, false);
    assert.equal((await call('purgeComplaints', { password: 'owner-secret-password', confirm: 'DELETE COMPLAINTS' }, owner.cookie)).body.data.complaints, 1);
    assert.equal((await call('complaintPurgePreview', {}, owner.cookie)).body.data.complaints, 0);
    assert.equal((await call('session', {}, owner.cookie)).body.data.role, 'superadmin');
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    database.close();
  }
});
