const test = require('node:test');
const assert = require('node:assert/strict');
const { createNearbyPlacesService } = require('./nearby-places.cjs');

const feature = (id, key, value, longitude, latitude, name, extra = {}) => ({
  type: 'Feature', geometry: { type: 'Point', coordinates: [longitude, latitude] },
  properties: { osm_type: 'N', osm_id: id, osm_key: key, osm_value: value, name, street: 'Lake Road', extra }
});

test('nearby search validates Dhaka coordinates and categories, filters, sorts, and caches place results', async () => {
  const calls = [];
  const fetcher = async (url) => {
    calls.push(new URL(url));
    return { ok: true, text: async () => JSON.stringify({ features: [
      feature(3, 'amenity', 'police', 90.379, 23.748, 'Second station'),
      feature(1, 'amenity', 'police', 90.375, 23.747, 'Nearest station', { phone: '+880 2 1234567', opening_hours: '24/7' }),
      feature(2, 'amenity', 'fire_station', 90.374, 23.747, 'Wrong category'),
      feature(4, 'amenity', 'police', 91, 23.747, 'Outside Dhaka')
    ] }) };
  };
  const search = createNearbyPlacesService(fetcher);
  await assert.rejects(search({ latitude: 23.5, longitude: 90.375, category: 'police' }), /Dhaka/);
  await assert.rejects(search({ latitude: 23.747, longitude: 90.375, category: 'unknown' }), /category/);
  const first = await search({ latitude: 23.747, longitude: 90.375, category: 'police' });
  assert.deepEqual(first.places.map(place => place.name), ['Nearest station', 'Second station']);
  assert.equal(first.places[0].phone, '+880 2 1234567');
  assert.equal(first.places[0].openingHours, '24/7');
  assert.equal(first.places[0].osmUrl, 'https://www.openstreetmap.org/node/1');
  assert.equal(first.places[0].distanceMeters, 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].searchParams.get('lat'), '23.75');
  await search({ latitude: 23.7471, longitude: 90.3751, category: 'police' });
  assert.equal(calls.length, 1);
});

test('nearby search returns partial results when one of several source queries fails', async () => {
  const search = createNearbyPlacesService(async (url) => {
    if (new URL(url).searchParams.get('include') === 'osm.shop.supermarket') return { ok: false };
    return { ok: true, text: async () => JSON.stringify({ features: [feature(9, 'amenity', 'marketplace', 90.375, 23.747, 'Local market')] }) };
  });
  const result = await search({ latitude: 23.747, longitude: 90.375, category: 'market' });
  assert.equal(result.partial, true);
  assert.equal(result.places[0].name, 'Local market');
});
