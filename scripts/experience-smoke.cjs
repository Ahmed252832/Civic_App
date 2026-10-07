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
    const citizen = database.register({ name: 'Test Citizen', email: 'citizen@example.test', area: 'DNCC Ward 15', password: 'citizen-password-123' });
    database.manage(owner, { type: 'user', name: 'Road Worker', email: 'staff@example.test', password: 'staff-password-123', role: 'staff', departmentId: 1 });
    const staff = database.login('staff@example.test', 'staff-password-123');
    const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lxoAAAAASUVORK5CYII=';
    const sample = { title: 'Broken footpath near school', description: 'The crossing needs repair so pedestrians can pass safely.', categoryId: 1, area: 'DNCC Ward 15', wardCode: 'DNCC-15', placeName: 'School entrance', latitude: 23.7469, longitude: 90.3754, severity: 'High', image };
    const finishedId = database.createComplaint(citizen, sample);
    const activeId = database.createComplaint(citizen, { ...sample, title: 'Damaged curb near market', latitude: 23.7474 });
    for (const id of [finishedId, activeId]) {
      database.act(owner, { id, action: 'verify' });
      database.act(owner, { id, action: 'assign', departmentId: 1 });
      database.act(staff, { id, action: 'start' });
    }
    database.act(staff, { id: finishedId, action: 'resolve', note: 'Footpath repaired and inspected.', image });
    browser = await chromium.launch({ executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true });
    const origin = `http://127.0.0.1:${server.address().port}`;
    const citizenPage = await browser.newPage({ viewport: { width: 1100, height: 850 } });
    await citizenPage.goto(origin);
    await citizenPage.getByLabel('Email address').fill('citizen@example.test');
    await citizenPage.getByLabel('Password').fill('citizen-password-123');
    await citizenPage.getByRole('button', { name: 'Sign in' }).click();
    await citizenPage.getByRole('region', { name: 'Quick start guide' }).getByText('Report a problem').waitFor();
    await citizenPage.getByRole('region', { name: 'Quick start guide' }).getByRole('button', { name: 'Open this section' }).click();
    await citizenPage.getByLabel('Issue title').waitFor();
    await citizenPage.getByRole('button', { name: 'Help', exact: true }).click();
    await citizenPage.getByRole('region', { name: 'Quick start guide' }).waitFor();
    await citizenPage.getByRole('button', { name: 'Close guide' }).click();
    await citizenPage.locator('.sidebar nav').getByRole('button', { name: 'Complaints' }).click();
    await citizenPage.getByRole('button', { name: /Broken footpath near school/ }).click();
    await citizenPage.getByRole('heading', { name: 'Check the completed work, then confirm and rate it.' }).waitFor();
    const comparison = citizenPage.getByRole('region', { name: 'Before and after repair' });
    await comparison.getByText('Before and after').waitFor();
    assert.equal(await comparison.locator('img').count(), 2);
    await citizenPage.screenshot({ path: path.join(__dirname, '..', 'artifacts', 'case-comparison.png') });
    await comparison.getByRole('button', { name: 'Overlay view' }).click();
    await comparison.getByLabel('Show more of the original photo').fill('75');
    assert.ok((await comparison.locator('img.comparison-before').getAttribute('style')).includes('25%'));
    await citizenPage.getByRole('button', { name: 'Close details' }).click();

    const staffPage = await browser.newPage({ viewport: { width: 1100, height: 850 } });
    await staffPage.goto(origin);
    await staffPage.getByLabel('Email address').fill('staff@example.test');
    await staffPage.getByLabel('Password').fill('staff-password-123');
    await staffPage.getByRole('button', { name: 'Sign in' }).click();
    await staffPage.getByRole('region', { name: 'Quick start guide' }).getByText('Find your cases').waitFor();
    await staffPage.getByRole('region', { name: 'Quick start guide' }).getByRole('button', { name: 'Open this section' }).click();
    await staffPage.getByRole('heading', { name: 'Staff work queue' }).waitFor();
    await staffPage.locator('.sidebar nav').getByRole('button', { name: 'Complaints' }).click();
    await staffPage.getByRole('button', { name: /Damaged curb near market/ }).click();
    await staffPage.getByRole('button', { name: 'Inspection', exact: true }).click();
    assert.equal(await staffPage.getByLabel('Work note').inputValue(), 'Site inspection is scheduled. We will post an update after the visit.');
    await staffPage.getByRole('button', { name: 'Add progress note' }).click();
    await staffPage.getByText('Site inspection is scheduled.', { exact: false }).waitFor();
    assert.ok(database.complaintDetail(staff, { id: activeId }).updates.some(item => item.note.includes('Site inspection is scheduled.')));
    console.log('Experience smoke passed: role guides, next steps, image comparison, staff template and timeline update.');
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
    database.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
