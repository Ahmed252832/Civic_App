const test = require('node:test');
const assert = require('node:assert/strict');
const { routeWatch, distanceToRoute } = require('./route-watch.cjs');

const origin = { latitude: 23.747, longitude: 90.375 };
const destination = { latitude: 23.747, longitude: 90.405 };
const route = { code: 'Ok', routes: [{ distance: 4300, duration: 620, geometry: { coordinates: [[90.375, 23.747], [90.39, 23.747], [90.405, 23.747]] } }] };

test('Route Watch checks only published alerts near the road geometry', async () => {
  const store = { publicStreetPulse: () => [
    { id: 1, hazard_type: 'Flooding', latitude: 23.748, longitude: 90.39, ward_code: 'DNCC-15', created_at: '2026-10-08 08:00:00', expires_at: '2026-10-10 08:00:00', still_count: 1, clear_count: 0, radius_metres: 250 },
    { id: 2, hazard_type: 'Road damage', latitude: 23.76, longitude: 90.39, ward_code: 'DNCC-15', created_at: '2026-10-08 08:00:00', expires_at: '2026-10-10 08:00:00', still_count: 0, clear_count: 0, radius_metres: 250 }
  ] };
  const fetcher = async (url) => { assert.match(url, /route\/v1\/driving/); return { ok: true, text: async () => JSON.stringify(route) }; };
  const result = await routeWatch(store, { origin, destination }, fetcher);
  assert.equal(result.alerts.length, 1);
  assert.equal(result.alerts[0].id, 1);
  assert.ok(result.alerts[0].distance_from_route_metres > 90 && result.alerts[0].distance_from_route_metres < 150);
  assert.equal(result.path.length, 3);
  assert.equal(result.distanceMeters, 4300);
  assert.ok(distanceToRoute({ latitude: 23.76, longitude: 90.39 }, result.path) > 500);
});

test('Route Watch rejects invalid endpoints and an unavailable road route', async () => {
  const store = { publicStreetPulse: () => [] };
  const unavailable = async () => ({ ok: false });
  await assert.rejects(routeWatch(store, { origin: { latitude: 22, longitude: 90.375 }, destination }, unavailable), /inside Dhaka/);
  await assert.rejects(routeWatch(store, { origin, destination: origin }, unavailable), /100 metres/);
  await assert.rejects(routeWatch(store, { origin, destination }, unavailable), /unavailable/);
});
