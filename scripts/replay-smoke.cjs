const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright-core');
const { createWebServer } = require('../server/web.cjs');

(async () => {
  const { server, database } = await createWebServer({ databasePath: ':memory:', setupKey: 'test-only-key' });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    database.bootstrapAdmin({ name: 'Test Owner', email: 'owner@example.test', password: 'owner-password-123' });
    const citizen = database.register({ name: 'Test Citizen', email: 'citizen@example.test', area: 'DNCC Ward 15', password: 'citizen-password-123' });
    for (let index = 0; index < 5; index++) database.createComplaint(citizen, { title: `Broken crossing near school ${index}`, description: 'The crossing needs repair so pedestrians can pass safely.', categoryId: 1, wardCode: 'DNCC-15', placeName: 'School entrance', latitude: 23.7469, longitude: 90.3754, severity: 'High' });
    browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
    const page = await browser.newPage({ viewport: { width: 390, height: 840 } });
    const origin = `http://127.0.0.1:${server.address().port}`;
    await page.goto(origin);
    await page.getByRole('button', { name: /Explore CivicPulse Replay/ }).click();
    await page.getByRole('heading', { name: 'CivicPulse Replay' }).waitFor();
    await page.getByRole('button', { name: /DNCC Ward 15/ }).waitFor();
    await page.getByRole('button', { name: /DNCC Ward 15/ }).click();
    await page.getByText('Reported to date').waitFor();
    await page.getByLabel('Choose a ward').selectOption('DNCC-15');
    await page.getByLabel('Choose a month').focus();
    await page.getByLabel('Choose a month').press('ArrowLeft');
    await page.getByText('Not enough public data for this month yet.').waitFor();
    await page.getByLabel('Choose a month').press('ArrowRight');
    await page.getByText('Reported to date').waitFor();
    assert.equal(await page.getByText('Broken crossing near school 0').count(), 0);
    await page.screenshot({ path: path.join(__dirname, '..', 'artifacts', 'replay-mobile.png'), fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2), true);
    await page.getByRole('button', { name: 'Dhaka South' }).click();
    await page.getByText('Not enough public data for this month yet.').waitFor();
    await page.getByRole('button', { name: 'বাংলা' }).click();
    await page.getByText('ওয়ার্ডের অগ্রগতি').waitFor();
    await page.getByRole('button', { name: 'ফিরে যান' }).click();
    await page.getByLabel('ইমেইল ঠিকানা').waitFor();
    const direct = await browser.newPage();
    await direct.goto(`${origin}/#replay`);
    await direct.getByRole('heading', { name: 'CivicPulse Replay' }).waitFor();
    assert.equal(await direct.getByLabel('Email address').count(), 0);
    await direct.getByRole('button', { name: 'Back to sign in' }).click();
    await direct.getByLabel('Email address').fill('citizen@example.test');
    await direct.getByLabel('Password').fill('citizen-password-123');
    await direct.getByRole('button', { name: 'Sign in' }).click();
    await direct.locator('.sidebar nav').getByRole('button', { name: 'CivicPulse Replay' }).click();
    await direct.getByRole('heading', { name: 'CivicPulse Replay' }).waitFor();
    console.log('Replay smoke passed: public access, aggregate ward drilldown, privacy, city switch, mobile layout and return to sign in.');
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
    database.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
