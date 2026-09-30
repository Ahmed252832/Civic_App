const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const { createWebServer } = require('../server/web.cjs');

(async () => {
  const { server, database } = await createWebServer({ databasePath: ':memory:', setupKey: 'test-only-key' });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    database.bootstrapAdmin({ name: 'Test Owner', email: 'owner@example.test', password: 'owner-password-123' });
    database.register({ name: 'Test Citizen', email: 'citizen@example.test', area: 'Dhanmondi', password: 'citizen-password-123' });
    browser = await chromium.launch({ executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true });
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    page.on('pageerror', error => { throw error; });
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.getByLabel('Email address').fill('citizen@example.test');
    await page.getByLabel('Password').fill('citizen-password-123');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.locator('.sidebar nav').getByRole('button', { name: 'Report an issue' }).click();
    await page.getByLabel('Latitude').fill('23.74690');
    await page.getByLabel('Longitude').fill('90.37540');
    await page.getByRole('status').filter({ hasText: 'Selected 23.74690, 90.37540' }).waitFor();
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      const dimensions = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth }));
      assert.ok(dimensions.document <= dimensions.viewport, `Horizontal overflow at ${width}px: ${JSON.stringify(dimensions)}`);
      assert.ok(await page.locator('.sidebar nav').getByRole('button', { name: 'Notifications' }).isVisible());
    }
    console.log('Mobile smoke passed: 390px and 320px layouts, keyboard coordinates, accessible navigation.');
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
    database.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
