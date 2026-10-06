const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const { createWebServer } = require('../server/web.cjs');

(async () => {
  const { server, database } = await createWebServer({ databasePath: ':memory:', setupKey: 'test-only-key' });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    const owner = database.bootstrapAdmin({ name: 'Test Owner', email: 'owner@example.test', password: 'owner-password-123' });
    const citizen = database.register({ name: 'Private Citizen', email: 'citizen@example.test', area: 'DNCC Ward 15', password: 'citizen-password-123' });
    const id = database.createComplaint(citizen, { title: 'Private report of broken pavement', description: 'The original private description must not be shown.', categoryId: 1, wardCode: 'DNCC-15', placeName: 'Private exact place', latitude: 23.7469, longitude: 90.3754, severity: 'High' });
    database.act(owner, { id, action: 'verify' });
    database.streetAlertAction(owner, { id, action: 'publish', hazardType: 'Road damage' });
    browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
    const page = await browser.newPage({ viewport: { width: 390, height: 840 } });
    const origin = `http://127.0.0.1:${server.address().port}`;
    await page.goto(`${origin}/#streetpulse`);
    await page.getByRole('heading', { name: 'StreetPulse' }).waitFor();
    await page.getByText('Road damage').first().waitFor();
    assert.equal(await page.getByText('Private report of broken pavement').count(), 0);
    assert.equal(await page.getByText('Private exact place').count(), 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2), true);
    await page.getByRole('button', { name: 'Dhaka South' }).click();
    await page.getByText('No published alerts in this view right now.').waitFor();
    await page.getByRole('button', { name: 'Dhaka North' }).click();
    await page.getByRole('button', { name: 'বাংলা' }).click();
    await page.getByText('রাস্তার ক্ষতি').first().waitFor();
    await page.getByRole('button', { name: 'সাইন ইনে ফিরুন' }).click();
    await page.getByLabel('ইমেইল ঠিকানা').waitFor();
    console.log('StreetPulse smoke passed: public link, mobile layout, city switch, Bangla, private details and return to sign in.');
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
    database.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
