const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright-core');
const { createWebServer } = require('../server/web.cjs');

(async () => {
  const { server, database } = await createWebServer({ databasePath: ':memory:', setupKey: 'test-only-key' });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    const owner = database.bootstrapAdmin({ name: 'Test Owner', email: 'owner@example.test', password: 'owner-password-123' });
    const citizen = database.register({ name: 'Test Citizen', email: 'citizen@example.test', area: 'Dhanmondi', password: 'citizen-password-123' });
    const issueId = database.createComplaint(citizen, { title: 'Broken crossing near the lake', description: 'The footpath crossing needs urgent repair.', categoryId: 1, area: 'Dhanmondi', placeName: 'Dhanmondi Lake east gate', latitude: 23.7469, longitude: 90.3754, severity: 'High' });
    database.act(owner, { id: issueId, action: 'verify' });
    database.act(owner, { id: issueId, action: 'assign', departmentId: 1 });
    browser = await chromium.launch({ executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true });
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    page.on('pageerror', error => { throw error; });
    const origin = `http://127.0.0.1:${server.address().port}`;
    await page.context().grantPermissions(['geolocation'], { origin });
    await page.context().setGeolocation({ latitude: 23.74691, longitude: 90.37541, accuracy: 18 });
    await page.goto(`${origin}/`);
    await page.getByLabel('Email address').fill('citizen@example.test');
    await page.getByLabel('Password').fill('citizen-password-123');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.locator('.sidebar nav').getByRole('button', { name: 'Issue map' }).click();
    await page.getByRole('button', { name: 'Use my location' }).click();
    await page.getByText('New report pin selected').waitFor();
    await page.getByLabel('Exact place name or nearby landmark').fill('Lake bridge east crossing');
    await page.locator('.overview-map .leaflet-tile-loaded').first().waitFor({ timeout: 10000 });
    await page.screenshot({ path: path.join(__dirname, '..', 'artifacts', 'mobile-map.png'), fullPage: true });
    await page.getByRole('button', { name: 'Continue to report' }).click();
    assert.equal(await page.getByLabel('Exact place name or nearby landmark').inputValue(), 'Lake bridge east crossing');
    assert.equal(await page.getByLabel('Latitude').inputValue(), '23.746910');
    await page.locator('.sidebar nav').getByRole('button', { name: 'Issue map' }).click();
    await page.locator('.overview-map .leaflet-interactive').first().click();
    await page.locator('.issue-popup').getByText('Dhanmondi Lake east gate').waitFor();
    await page.waitForFunction(() => Array.from(document.querySelectorAll('.overview-map .leaflet-tile')).some(tile => tile.getAttribute('src')?.includes('/17/')));
    await page.locator('.issue-popup').getByRole('button', { name: 'Open issue' }).click();
    await page.getByText('Issue details').waitFor();
    await page.getByRole('button', { name: 'Close details' }).click();
    await page.locator('.sidebar nav').getByRole('button', { name: 'Report an issue' }).click();
    await page.getByLabel('Latitude').fill('23.74690');
    await page.getByLabel('Longitude').fill('90.37540');
    await page.getByRole('status').filter({ hasText: 'Selected 23.746900, 90.375400' }).waitFor();
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      const dimensions = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth }));
      assert.ok(dimensions.document <= dimensions.viewport, `Horizontal overflow at ${width}px: ${JSON.stringify(dimensions)}`);
      assert.ok(await page.locator('.sidebar nav').getByRole('button', { name: 'Notifications' }).isVisible());
    }
    console.log('Mobile smoke passed: location pin, map zoom, report transfer, 390px and 320px layouts.');
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
    database.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
