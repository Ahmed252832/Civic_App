const { _electron } = require('playwright-core');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');

(async () => {
  const project = path.join(__dirname, '..');
  const testData = fs.mkdtempSync(path.join(os.tmpdir(), 'civicpulse-smoke-'));
  const artifacts = path.join(project, 'artifacts');
  fs.mkdirSync(artifacts, { recursive: true });
  const application = await _electron.launch({
    args: ['.'], cwd: project,
    env: { ...process.env, CIVICPULSE_DATA_DIR: testData, CIVICPULSE_SETUP_KEY: 'smoke-setup-key', CIVICPULSE_TEST_MODE: '1' }
  });
  try {
    const window = await application.firstWindow();
    const pageErrors = [];
    window.on('pageerror', error => pageErrors.push(error.message));
    await window.getByText('Set up the Dhaka workspace').waitFor();
    await window.getByLabel('Setup key').fill('smoke-setup-key');
    await window.getByLabel('Your name').fill('Test Owner');
    await window.getByLabel('Your email').fill('owner@example.test');
    await window.getByLabel('Password').fill('owner-password-123');
    await window.getByRole('button', { name: 'Create owner account' }).click();
    await window.locator('.hero h1').waitFor();
    await window.screenshot({ path: path.join(artifacts, 'dashboard.png') });
    await window.locator('.sidebar nav button').filter({ hasText: 'Administration' }).click();
    await window.getByText('Manage staff access').waitFor();
    await window.screenshot({ path: path.join(artifacts, 'administration.png') });
    await window.locator('.sidebar nav button').filter({ hasText: 'Account security' }).click();
    await window.getByLabel('Current password').fill('owner-password-123');
    await window.getByLabel('New password').fill('new-owner-password-123');
    await window.getByRole('button', { name: 'Change password' }).click();
    await window.getByText('Password updated. Other signed-in devices have been signed out.').waitFor();
    await window.evaluate(async () => {
      const account = await window.civic.request('register', { name: 'Test Resident', email: 'resident@example.test', area: 'Dhanmondi', password: 'resident-password-123' });
      if (!account.ok) throw new Error(account.error);
      for (let n = 1; n <= 30; n++) {
        const result = await window.civic.request('create', { title: `Broken crossing number ${n}`, description: 'Pedestrians are stepping into traffic because the crossing is damaged.', categoryId: 1, area: 'Dhanmondi', latitude: 23.7468, longitude: 90.3754, severity: 'Medium' });
        if (!result.ok) throw new Error(result.error);
      }
    });
    await window.reload();
    await window.locator('.sidebar nav button').filter({ hasText: 'Complaints' }).click();
    await window.locator('.complaint-row').first().waitFor();
    assert.equal(await window.locator('.complaint-row').count(), 25);
    await window.getByRole('button', { name: /Load more/ }).click();
    assert.equal(await window.locator('.complaint-row').count(), 30);
    await window.locator('.complaint-row').last().click();
    await window.getByText('Issue details').waitFor();
    await window.locator('.detail-drawer h3').getByText('Broken crossing number 1', { exact: true }).waitFor();
    await window.locator('.detail-drawer .icon-button').click();
    await window.locator('.profile-mini').click();
    await window.getByText('Welcome back').waitFor();
    await window.screenshot({ path: path.join(artifacts, 'login.png') });
    assert.deepEqual(pageErrors, []);
    console.log(`Desktop UI smoke test passed. Screenshots: ${artifacts}`);
  } finally { await application.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
