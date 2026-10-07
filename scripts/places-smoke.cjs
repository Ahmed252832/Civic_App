const assert = require('node:assert/strict');
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
      : [sample(category, 3, category === 'fire' ? 'Dhanmondi Fire Station' : 'Nearby place', 90.377)]
  }) });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    database.bootstrapAdmin({ name: 'Owner', email: 'places-owner@example.test', password: 'owner-password-123' });
    database.register({ name: 'Resident', email: 'places-citizen@example.test', area: 'DNCC Ward 15', password: 'citizen-password-123' });
    browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
    const page = await browser.newPage({ viewport: { width: 390, height: 840 } });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
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
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2), true);
    console.log('Nearby places smoke passed: citizen location, category change, details, hotline, routes, and mobile width.');
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); database.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
