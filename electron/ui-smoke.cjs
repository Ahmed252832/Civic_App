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
      const account = await window.civic.request('register', { name: 'Test Resident', email: 'resident@example.test', area: 'DNCC Ward 15', password: 'resident-password-123' });
      if (!account.ok) throw new Error(account.error);
      for (let n = 1; n <= 30; n++) {
        const result = await window.civic.request('create', { title: `Broken crossing number ${n}`, description: 'Pedestrians are stepping into traffic because the crossing is damaged.', categoryId: 1, area: 'DNCC Ward 15', wardCode: 'DNCC-15', placeName: 'Dhanmondi Lake east gate', latitude: 23.7468, longitude: 90.3754, severity: 'Medium' });
        if (!result.ok) throw new Error(result.error);
      }
      const owner = await window.civic.request('login', { email: 'owner@example.test', password: 'new-owner-password-123' });
      if (!owner.ok) throw new Error(owner.error);
    });
    await window.reload();
    await window.locator('.hero h1').waitFor();
    await window.locator('.stat-grid .stat-card-link').first().click();
    await window.getByRole('heading', { name: 'Complaints' }).waitFor();
    await window.locator('.complaint-row').first().waitFor();
    assert.equal(await window.locator('.complaint-row').count(), 25);
    await window.getByRole('button', { name: /Load more/ }).click();
    assert.equal(await window.locator('.complaint-row').count(), 30);
    await window.locator('.complaint-row').last().click();
    await window.getByText('Issue details').waitFor();
    await window.locator('.detail-drawer h3').getByText('Broken crossing number 1', { exact: true }).waitFor();
    await window.getByRole('button', { name: 'Close details' }).click();
    await window.locator('.sidebar nav button').filter({ hasText: 'Issue map' }).click();
    await window.getByRole('button', { name: 'View Dhaka North' }).click();
    await window.getByRole('button', { name: 'View Dhaka South' }).click();
    assert.equal(await window.getByRole('link', { name: 'North ward areas' }).getAttribute('href'), '/ward-guides/dncc-areas.txt');
    assert.equal(await window.getByRole('link', { name: 'South ward areas' }).getAttribute('href'), '/ward-guides/dscc-areas.pdf');
    await window.locator('.sidebar nav button').filter({ hasText: 'Finished work' }).click();
    await window.getByRole('heading', { name: 'Department scorecard' }).waitFor();
    await window.locator('.performance-card-action').first().click();
    assert.notEqual(await window.getByLabel('Filter department').inputValue(), 'all');
    await window.getByRole('button', { name: 'বাংলা' }).click();
    await window.getByRole('heading', { name: 'বিভাগভিত্তিক ফলাফল' }).waitFor();
    await window.screenshot({ path: path.join(artifacts, 'performance-bn.png') });
    assert.equal(await window.getByText('Rates use finished, citizen-confirmed cases.', { exact: false }).count(), 0);
    await window.locator('.sidebar nav button').filter({ hasText: 'প্রশাসন' }).click();
    await window.getByRole('heading', { name: 'ধরন ও বিভাগ' }).waitFor();
    await window.screenshot({ path: path.join(artifacts, 'administration-bn.png') });
    await window.locator('.sidebar nav button').filter({ hasText: 'অ্যাকাউন্ট নিরাপত্তা' }).click();
    await window.getByRole('heading', { name: 'অ্যাকাউন্ট ফেরত পাওয়ার কোড' }).waitFor();
    await window.screenshot({ path: path.join(artifacts, 'security-bn.png') });
    await window.getByRole('button', { name: 'EN' }).click();
    await window.locator('.top-avatar').click();
    await window.locator('.content .section-heading h2').getByText('Account security').waitFor();
    await window.locator('.sidebar nav button').filter({ hasText: 'Administration' }).click();
    const resetCard = window.locator('.card').filter({ has: window.getByRole('heading', { name: 'Delete complaints and history' }) });
    await resetCard.getByRole('button', { name: 'Preview complaint count' }).click();
    await resetCard.getByText('30 complaints would be deleted').waitFor();
    await resetCard.getByLabel('Your current password').fill('new-owner-password-123');
    await resetCard.getByLabel('Type DELETE COMPLAINTS to confirm').fill('DELETE COMPLAINTS');
    await resetCard.getByRole('button', { name: 'Delete complaints and history' }).click();
    await resetCard.getByText('30 complaints and related history removed.').waitFor();
    const afterPurge = await window.evaluate(() => window.civic.request('snapshot'));
    assert.equal(afterPurge.data.summary.counts.total, 0);
    assert.equal(afterPurge.data.users.length, 1);
    const residentAfterPurge = await window.evaluate(() => window.civic.request('login', { email: 'resident@example.test', password: 'resident-password-123' }));
    assert.equal(residentAfterPurge.data.role, 'citizen');
    const ownerAfterPurge = await window.evaluate(() => window.civic.request('login', { email: 'owner@example.test', password: 'new-owner-password-123' }));
    assert.equal(ownerAfterPurge.data.role, 'superadmin');
    await window.reload();
    await window.locator('.top-avatar').click();
    await window.locator('.profile-mini').click();
    await window.getByRole('dialog', { name: 'Sign out of CivicPulse?' }).waitFor();
    await window.getByRole('button', { name: 'Stay signed in' }).click();
    await window.locator('.profile-mini').click();
    await window.getByRole('dialog', { name: 'Sign out of CivicPulse?' }).getByRole('button', { name: 'Sign out' }).click();
    await window.getByText('Welcome back').waitFor();
    await window.screenshot({ path: path.join(artifacts, 'login.png') });
    assert.deepEqual(pageErrors, []);
    console.log(`Desktop UI smoke test passed. Screenshots: ${artifacts}`);
  } finally { await application.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
