const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');
const { createWebServer } = require('../server/web.cjs');

(async () => {
  const { server, database } = await createWebServer({ databasePath: ':memory:', setupKey: 'test-only-key' });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    const owner = database.bootstrapAdmin({ name: 'Owner', email: 'mission-owner@example.test', password: 'owner-password-123' });
    const first = database.register({ name: 'First Resident', email: 'mission-first@example.test', area: 'DNCC Ward 15', password: 'citizen-password-123' });
    const second = database.register({ name: 'Second Resident', email: 'mission-second@example.test', area: 'DNCC Ward 15', password: 'citizen-password-123' });
    database.manage(owner, { type: 'user', name: 'Road Worker', email: 'mission-road@example.test', password: 'staff-password-123', role: 'staff', departmentId: 1 });
    const sample = { description: 'The crossing needs a coordinated repair for pedestrians.', categoryId: 1, wardCode: 'DNCC-15', placeName: 'School entrance', latitude: 23.7469, longitude: 90.3754, severity: 'High' };
    const a = database.createComplaint(first, { ...sample, title: 'Broken crossing by the school' });
    const b = database.createComplaint(second, { ...sample, title: 'Road damage beside crossing', latitude: 23.7472, longitude: 90.3757 });
    const c = database.createComplaint(first, { ...sample, title: 'Blocked curb nearby', latitude: 23.7474, longitude: 90.3758 });
    for (const id of [a,b,c]) { database.act(owner, { id, action: 'verify' }); database.act(owner, { id, action: 'assign', departmentId: 1 }); }
    browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
    const page = await browser.newPage({ viewport: { width: 390, height: 840 } });
    const origin = `http://127.0.0.1:${server.address().port}`;
    await page.goto(origin);
    await page.getByLabel('Email address').fill('mission-road@example.test');
    await page.getByLabel('Password').fill('staff-password-123');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.locator('.sidebar nav').getByRole('button', { name: 'Repair Missions' }).click();
    await page.getByRole('heading', { name: 'Repair Missions' }).waitFor();
    await page.getByRole('button', { name: /C-1001 · Broken crossing/ }).click();
    await page.getByRole('checkbox', { name: /C-1002/ }).check();
    await page.getByLabel('Mission title').fill('Repair the school crossing');
    await page.getByLabel('Shared work plan').fill('Inspect both road defects, repair the crossing and adjacent pavement, then check the finished work.');
    await page.getByRole('button', { name: 'Create Repair Mission' }).click();
    await page.locator('.mission-detail h2').getByText('Repair the school crossing').waitFor();
    await page.getByRole('button', { name: 'Start work on all cases' }).click();
    await page.getByLabel('Completion note').fill('Crossing and pavement repaired and checked on site.');
    const png = await page.screenshot();
    await page.getByLabel('Completion photo').setInputFiles({ name: 'finished.png', mimeType: 'image/png', buffer: png });
    try { await page.getByText('Photo ready').waitFor({ timeout: 10000 }); }
    catch (error) {
      console.error('Photo upload diagnostics:', await page.locator('body').innerText());
      throw error;
    }
    await page.getByRole('button', { name: 'Mark all work complete' }).click();
    await page.locator('.mission-detail').getByText('Each resident reviews and rates their own case separately.').waitFor();
    assert.equal(database.complaintDetail(first, { id: a }).complaint.status, 'Awaiting Feedback');
    assert.equal(database.complaintDetail(second, { id: b }).complaint.status, 'Awaiting Feedback');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2), true);
    fs.mkdirSync(path.join(__dirname, '..', 'artifacts'), { recursive: true });
    await page.screenshot({ path: path.join(__dirname, '..', 'artifacts', 'missions-mobile.png'), fullPage: true });
    await page.locator('.sidebar nav').getByRole('button', { name: 'Complaints' }).click();
    await page.locator('.complaint-row').filter({ hasText: 'Blocked curb nearby' }).click();
    await page.getByRole('button', { name: 'Start mission from this case' }).click();
    await page.getByText('C-1003 · Blocked curb nearby').first().waitFor();
    console.log('Repair Missions smoke passed: case entry point, staff grouping, shared completion, separate citizen cases and mobile layout.');
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); database.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
