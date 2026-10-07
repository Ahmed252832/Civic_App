const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');
const { createWebServer } = require('../server/web.cjs');

const sample = (category, id, name, longitude) => ({
  id: `node/${id}`, category, name, latitude: 23.7469, longitude,
  address: 'Dhanmondi, Dhaka', phone: category === 'police' ? '+880 2 1234567' : null,
  openingHours: category === 'police' ? '24/7' : null, website: null,
  osmUrl: `https://www.openstreetmap.org/node/${id}`, distanceMeters: 180
});

(async () => {
  const { server, database } = await createWebServer({ databasePath: ':memory:', setupKey: 'test-only-key', nearbyPlaces: async ({ category }) => ({
    category, radiusMeters: 6000, partial: false, source: 'test', places: category === 'police'
      ? [sample('police', 1, 'Dhanmondi Model Thana', 90.377), sample('police', 2, 'Second police station', 90.378)]
      : [sample(category, 3, category === 'fire' ? 'Dhanmondi Fire Station' : category === 'hospital' ? 'Dhanmondi Hospital' : category === 'pharmacy' ? 'Dhanmondi Pharmacy' : 'Nearby place', 90.377)]
  }), routeWatch: async (_store, payload) => ({ origin: payload.origin, destination: payload.destination, path: [payload.origin, { latitude: 23.7469, longitude: 90.385 }, payload.destination], distanceMeters: 4200, durationSeconds: 600,
    alerts: [{ id: 44, hazard_type: 'Flooding', ward_code: 'DNCC-15', latitude: 23.7469, longitude: 90.385, created_at: '2026-10-08 08:00:00', expires_at: '2026-10-10 08:00:00', still_count: 1, clear_count: 0, radius_metres: 250, distance_from_route_metres: 100 }], corridorMeters: 500, source: 'test', checkedAt: new Date().toISOString() }) });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    const owner = database.bootstrapAdmin({ name: 'Owner', email: 'places-owner@example.test', password: 'owner-password-123' });
    database.register({ name: 'Resident', email: 'places-citizen@example.test', area: 'DNCC Ward 15', password: 'citizen-password-123' });
    database.manage(owner, { type: 'user', name: 'Area Admin', email: 'places-admin@example.test', password: 'admin-password-123', role: 'admin' });
    database.manage(owner, { type: 'user', name: 'Fire Worker', email: 'places-staff@example.test', password: 'staff-password-123', role: 'staff', departmentId: 1 });
    browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
    const page = await browser.newPage({ viewport: { width: 390, height: 840 } });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.getByRole('button', { name: 'New citizen? Create an account' }).click();
    for (const label of ['North area guide', 'South area guide', 'North 2018 map']) assert.equal(await page.getByRole('link', { name: label }).count(), 0);
    await page.getByLabel('Choose city corporation').selectOption('DNCC');
    assert.equal(await page.getByRole('link', { name: /North ward directory/ }).count(), 1);
    assert.equal(await page.getByRole('link', { name: /South ward directory/ }).count(), 0);
    await page.getByRole('button', { name: 'Back to sign in' }).click();
    await page.getByLabel('Email address').fill('places-citizen@example.test');
    await page.getByLabel('Password').fill('citizen-password-123');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.locator('.sidebar nav').getByRole('button', { name: 'Issue map' }).click();
    await page.getByRole('button', { name: 'Nearby places' }).click();
    await page.getByLabel('Latitude').fill('23.7469');
    await page.getByLabel('Longitude').fill('90.3754');
    await page.getByRole('button', { name: 'Search from this point' }).click();
    await page.locator('.places-list').getByRole('button', { name: /Dhanmondi Model Thana/ }).waitFor();
    assert.equal(await page.locator('.places-list button').count(), 2);
    assert.match(await page.locator('.place-detail').innerText(), /Dhanmondi Model Thana/);
    assert.match(await page.locator('.place-detail').innerText(), /Listed phone: \+880 2 1234567/);
    assert.equal(await page.locator('.place-route').getAttribute('href').then(url => new URL(url).searchParams.get('travelmode')), 'walking');
    await page.getByLabel('Travel mode').selectOption('driving');
    assert.equal(await page.locator('.place-route').getAttribute('href').then(url => new URL(url).searchParams.get('travelmode')), 'driving');
    await page.getByLabel('Place category').selectOption('fire');
    await page.locator('.places-list').getByRole('button', { name: /Dhanmondi Fire Station/ }).waitFor();
    assert.equal(await page.getByRole('link', { name: /Fire service 102/ }).getAttribute('href'), 'tel:102');
    for (const category of ['school', 'college', 'university']) {
      await page.getByLabel('Place category').selectOption(category);
      await page.locator('.places-list').getByRole('button', { name: 'Nearby place' }).waitFor();
    }
    await page.getByRole('button', { name: 'Pharmacy finder' }).click();
    await page.locator('.places-list').getByRole('button', { name: /Dhanmondi Pharmacy/ }).waitFor();
    await page.locator('.place-watch-route').click();
    assert.equal(await page.getByLabel('Start latitude').inputValue(), '23.7469');
    assert.equal(await page.getByLabel('Destination longitude').inputValue(), '90.377');
    await page.getByRole('button', { name: 'Help Now' }).click();
    await page.locator('.help-group').getByRole('button', { name: /Dhanmondi Model Thana/ }).waitFor();
    await page.locator('.help-group').getByRole('button', { name: /Dhanmondi Fire Station/ }).waitFor();
    await page.locator('.help-group').getByRole('button', { name: /Dhanmondi Hospital/ }).waitFor();
    assert.equal(await page.locator('.help-hotlines a[href="tel:999"]').count(), 1);
    await page.locator('.help-watch-route').click();
    assert.equal(await page.getByLabel('Destination longitude').inputValue(), '90.377');
    await page.getByRole('button', { name: 'Route Watch' }).click();
    await page.getByLabel('Start latitude').fill('23.7469');
    await page.getByLabel('Start longitude').fill('90.3754');
    await page.getByLabel('Destination latitude').fill('23.7469');
    await page.getByLabel('Destination longitude').fill('90.4054');
    await page.getByRole('button', { name: 'Check route' }).click();
    await page.getByRole('heading', { name: '1 alerts near this route' }).waitFor();
    assert.match(await page.locator('.route-alert').innerText(), /Flooding/);
    assert.equal(await page.locator('.route-watch-map .leaflet-overlay-pane path').count() > 0, true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2), true);
    fs.mkdirSync(path.join(__dirname, '..', 'artifacts'), { recursive: true });
    await page.screenshot({ path: path.join(__dirname, '..', 'artifacts', 'route-watch-mobile.png'), fullPage: true });
    for (const [email, password] of [['places-owner@example.test', 'owner-password-123'], ['places-admin@example.test', 'admin-password-123'], ['places-staff@example.test', 'staff-password-123']]) {
      const rolePage = await browser.newPage({ viewport: { width: 390, height: 840 } });
      await rolePage.goto(`http://127.0.0.1:${server.address().port}`);
      await rolePage.getByLabel('Email address').fill(email);
      await rolePage.getByLabel('Password').fill(password);
      await rolePage.getByRole('button', { name: 'Sign in' }).click();
      await rolePage.locator('.sidebar nav').getByRole('button', { name: 'Issue map' }).click();
      await rolePage.getByRole('button', { name: 'Nearby places' }).click();
      await rolePage.getByLabel('Latitude').fill('23.7469');
      await rolePage.getByLabel('Longitude').fill('90.3754');
      await rolePage.getByRole('button', { name: 'Search from this point' }).click();
      await rolePage.locator('.places-list').getByRole('button', { name: /Dhanmondi Model Thana/ }).waitFor();
      assert.equal(await rolePage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2), true);
      await rolePage.close();
    }
    console.log('Local tools smoke passed: sign-up, all four roles, ten categories, pharmacy, Help Now, Route Watch, hotlines, routes, and mobile width.');
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); database.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
