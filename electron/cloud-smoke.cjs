const { _electron } = require('playwright-core');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createWebServer } = require('../server/web.cjs');

(async () => {
  const { server, database } = await createWebServer({ databasePath: ':memory:', setupKey: 'test-only-key' });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  let application;
  const call = async (method, payload = {}, cookie) => {
    const response = await fetch(`${base}/api/request`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
      body: JSON.stringify({ method, payload })
    });
    const result = await response.json();
    if (!result.ok) throw new Error(result.error);
    return { data: result.data, cookie: response.headers.get('set-cookie')?.split(';')[0] };
  };
  try {
    const owner = database.bootstrapAdmin({ name: 'Cloud Test Owner', email: 'owner@cloud.test', password: 'owner-test-password-123' });
    const executablePath = process.argv[2];
    application = await _electron.launch({ ...(executablePath ? { executablePath } : { args: ['.'], cwd: path.join(__dirname, '..') }), env: { ...process.env, CIVICPULSE_TEST_MODE: '1', CIVICPULSE_TEST_REMOTE_URL: base } });
    const window = await application.firstWindow();
    await window.getByText('Welcome back').waitFor();
    assert.equal(await window.evaluate(() => typeof window.civic), 'undefined');
    await window.getByLabel('Email address').fill('owner@cloud.test');
    await window.getByLabel('Password').fill('owner-test-password-123');
    await window.getByRole('button', { name: 'Sign in' }).click();
    await window.locator('.sidebar nav button').filter({ hasText: 'Administration' }).waitFor();

    const citizen = await call('register', { name: 'Cloud Test Citizen', email: 'citizen@cloud.test', area: 'Dhanmondi', password: 'citizen-test-password-123' });
    await call('create', { title: 'Crossing curb needs repair', description: 'The pedestrian crossing curb is broken near the road.', categoryId: 1, area: 'Dhanmondi', latitude: 23.7468, longitude: 90.3754, severity: 'High' }, citizen.cookie);
    await window.getByRole('button', { name: 'Refresh' }).click();
    await window.getByRole('status').filter({ hasText: 'Updated' }).waitFor();
    await window.locator('.nav-count').getByText('1').waitFor({ timeout: 25000 });
    await window.locator('.sidebar nav button').filter({ hasText: 'Complaints' }).click();
    await window.getByText('Crossing curb needs repair').waitFor();
    await window.getByText('Target closure', { exact: false }).first().waitFor();

    await window.locator('.sidebar nav button').filter({ hasText: 'Administration' }).click();
    await window.locator('.management-form select').first().selectOption('department');
    await window.locator('.management-form input').fill('Public Safety Response');
    await window.locator('.management-form button').click();
    await window.getByText('Department created. Add a category assigned to it so citizens can choose that service.').waitFor();
    await window.locator('.settings-list strong').getByText('Public Safety Response').waitFor();
    await window.locator('.target-form select').selectOption('1');
    await window.locator('.target-form input').fill('24');
    await window.locator('.target-form button').click();
    await window.getByText('Closure target saved. It applies to new reports only.').waitFor();
    const browserOwner = await call('login', { email: 'owner@cloud.test', password: 'owner-test-password-123' });
    const snapshot = await call('snapshot', {}, browserOwner.cookie);
    assert.equal(snapshot.data.user.id, owner.id);
    assert.ok(snapshot.data.departments.some(department => department.name === 'Public Safety Response'));
    await window.locator('.top-avatar').click();
    await window.locator('.content .section-heading h2').getByText('Account security').waitFor();
    await window.locator('.profile-mini').click();
    await window.getByRole('dialog', { name: 'Sign out of CivicPulse?' }).waitFor();
    await window.getByRole('button', { name: 'Stay signed in' }).click();
    await window.locator('.sidebar nav button').filter({ hasText: 'Administration' }).waitFor();
    const neighbor = await call('register', { name: 'Another Resident', email: 'neighbor@cloud.test', area: 'Dhanmondi', password: 'neighbor-test-password-123' });
    await call('create', { title: 'Different resident report', description: 'This is a separate test report for another resident.', categoryId: 1, area: 'Dhanmondi', latitude: 23.7468, longitude: 90.3754, severity: 'Medium' }, neighbor.cookie);
    await window.locator('.profile-mini').click();
    await window.getByRole('dialog', { name: 'Sign out of CivicPulse?' }).getByRole('button', { name: 'Sign out' }).click();
    await window.getByLabel('Email address').fill('citizen@cloud.test');
    await window.getByLabel('Password').fill('citizen-test-password-123');
    await window.getByRole('button', { name: 'Sign in' }).click();
    await window.getByLabel('Search an area').fill('Dhanmondi');
    await window.locator('.area-total strong').getByText('2').waitFor();
    await window.locator('.sidebar nav button').filter({ hasText: 'Complaints' }).click();
    await window.getByText('Crossing curb needs repair').waitFor();
    assert.equal(await window.locator('.complaint-row').count(), 1);
    await window.locator('.top-avatar').click();
    await window.locator('.profile-security').last().getByLabel('Current password').fill('citizen-test-password-123');
    await window.getByRole('button', { name: 'Generate new recovery code' }).click();
    const recoveryCode = await window.locator('.recovery-code').textContent();
    assert.equal(recoveryCode.length, 43);
    await window.locator('.profile-mini').click();
    await window.getByRole('dialog', { name: 'Sign out of CivicPulse?' }).getByRole('button', { name: 'Sign out' }).click();
    await window.getByRole('button', { name: 'Use recovery code' }).click();
    await window.getByLabel('Recovery code').fill(recoveryCode);
    await window.getByLabel('New password').fill('citizen-recovered-password-123');
    await window.getByRole('button', { name: 'Reset password' }).click();
    await window.getByText('Password changed. Sign in with your new password.').waitFor();
    console.log('Cloud desktop smoke test passed: shared reports, department changes, refresh, and recovery code flow.');
  } finally {
    if (application) await application.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    database.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
