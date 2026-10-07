const DHAKA = { south: 23.65, north: 23.94, west: 90.30, east: 90.54 };
const SEARCHES = {
  police: { radius: 6000, queries: [{ include: 'osm.amenity.police' }] },
  fire: { radius: 8000, queries: [{ include: 'osm.amenity.fire_station' }] },
  mosque: { radius: 3500, queries: [{ include: 'osm.building.mosque' }, { include: 'osm.amenity.place_of_worship', q: 'mosque' }, { include: 'osm.amenity.place_of_worship', q: 'masjid' }] },
  temple: { radius: 6000, queries: [{ include: 'osm.amenity.place_of_worship', q: 'temple' }, { include: 'osm.amenity.place_of_worship', q: 'mandir' }, { include: 'osm.amenity.place_of_worship', q: 'মন্দির' }] },
  market: { radius: 3500, queries: [{ include: 'osm.amenity.marketplace' }, { include: 'osm.shop.supermarket' }] },
  hospital: { radius: 6000, queries: [{ include: 'osm.amenity.hospital' }] },
  pharmacy: { radius: 3500, queries: [{ include: 'osm.amenity.pharmacy' }] },
  school: { radius: 3500, queries: [{ include: 'osm.amenity.school' }] },
  college: { radius: 5000, queries: [{ include: 'osm.amenity.college' }] },
  university: { radius: 7000, queries: [{ include: 'osm.amenity.university' }] }
};
const LABELS = { police: 'Police station', fire: 'Fire station', mosque: 'Mosque', temple: 'Temple', market: 'Market', hospital: 'Hospital', pharmacy: 'Pharmacy', school: 'School', college: 'College', university: 'University' };
const haversine = (a, b) => {
  const rad = n => n * Math.PI / 180;
  const dLat = rad(b.latitude - a.latitude), dLon = rad(b.longitude - a.longitude);
  const value = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
};
const clean = (value, limit = 140) => typeof value === 'string' ? value.trim().slice(0, limit) : '';
const phone = value => {
  const first = clean(value, 80).split(/[;,/]/)[0].trim();
  return /^\+?[0-9][0-9 ()-]{2,24}$/.test(first) ? first : null;
};
const website = value => {
  try { const url = new URL(clean(value, 250)); return ['http:', 'https:'].includes(url.protocol) ? url.href : null; }
  catch { return null; }
};
const matchesCategory = (category, properties) => {
  const key = `${properties.osm_key}:${properties.osm_value}`;
  if (category === 'police') return key === 'amenity:police';
  if (category === 'fire') return key === 'amenity:fire_station';
  if (category === 'market') return key === 'amenity:marketplace' || key === 'shop:supermarket';
  if (category === 'hospital') return key === 'amenity:hospital';
  if (category === 'pharmacy') return key === 'amenity:pharmacy';
  if (category === 'school') return key === 'amenity:school';
  if (category === 'college') return key === 'amenity:college';
  if (category === 'university') return key === 'amenity:university';
  if (category === 'mosque') return key === 'building:mosque' || (key === 'amenity:place_of_worship' && /mosque|masjid|মসজিদ|জামে|jame/i.test(properties.name || ''));
  if (category === 'temple') return key === 'amenity:place_of_worship' && /temple|mandir|মন্দির|দেবালয়|দেবালয়|vihara|বিহার/i.test(properties.name || '');
  return false;
};
const normalize = (feature, category) => {
  const p = feature?.properties || {}, point = feature?.geometry?.coordinates;
  if (!matchesCategory(category, p) || !Array.isArray(point)) return null;
  const longitude = Number(point[0]), latitude = Number(point[1]);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || latitude < DHAKA.south || latitude > DHAKA.north || longitude < DHAKA.west || longitude > DHAKA.east) return null;
  const osmType = { N: 'node', W: 'way', R: 'relation' }[p.osm_type];
  const osmId = String(p.osm_id || '');
  if (!osmType || !/^\d{1,19}$/.test(osmId)) return null;
  const address = [p.housenumber, p.street, p.locality, p.district, p.city, p.postcode].map(part => clean(part, 80)).filter(Boolean);
  const extra = p.extra && typeof p.extra === 'object' ? p.extra : {};
  return {
    id: `${osmType}/${osmId}`, category, name: clean(p.name, 120) || `Unnamed ${LABELS[category].toLowerCase()}`,
    latitude, longitude, address: [...new Set(address)].join(', '),
    phone: phone(extra.phone || extra['contact:phone'] || p.phone || p['contact:phone']),
    openingHours: clean(extra.opening_hours || p.opening_hours, 120) || null,
    website: website(extra.website || extra['contact:website'] || p.website),
    osmUrl: `https://www.openstreetmap.org/${osmType}/${osmId}`
  };
};
function createNearbyPlacesService(fetcher = fetch) {
  const cache = new Map();
  const inFlight = new Map();
  const load = async (category, gridLatitude, gridLongitude) => {
    const searches = SEARCHES[category].queries.map(async query => {
      const url = new URL('https://photon.komoot.io/api/');
      url.search = new URLSearchParams({ ...query, lat: String(gridLatitude), lon: String(gridLongitude), zoom: '15', location_bias_scale: '0', bbox: '90.30,23.65,90.54,23.94', limit: '50', lang: 'en' }).toString();
      const response = await fetcher(url.href, { headers: { 'User-Agent': 'CivicPulse/0.17 (https://github.com/Ahmed252832/Civic_App)' }, signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error('Nearby place source is temporarily unavailable.');
      const body = await response.text();
      if (body.length > 1_000_000) throw new Error('Nearby place response was too large.');
      const result = JSON.parse(body);
      if (!Array.isArray(result.features)) throw new Error('Nearby place response was invalid.');
      return result.features.map(feature => normalize(feature, category)).filter(Boolean);
    });
    const settled = await Promise.allSettled(searches);
    const completed = settled.filter(result => result.status === 'fulfilled');
    if (!completed.length) throw new Error('Nearby places could not load. Please try again in a moment.');
    const places = new Map();
    for (const result of completed) for (const place of result.value) places.set(place.id, place);
    return { places: [...places.values()], partial: completed.length < searches.length, cachedAt: Date.now() };
  };
  return async ({ latitude, longitude, category }) => {
    latitude = Number(latitude); longitude = Number(longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || latitude < DHAKA.south || latitude > DHAKA.north || longitude < DHAKA.west || longitude > DHAKA.east) throw new Error('Choose a starting point inside the Dhaka service area.');
    if (!Object.hasOwn(SEARCHES, category)) throw new Error('Choose a valid place category.');
    const gridLatitude = Math.round(latitude * 100) / 100, gridLongitude = Math.round(longitude * 100) / 100;
    const key = `${category}:${gridLatitude}:${gridLongitude}`;
    let entry = cache.get(key), stale = false;
    if (!entry || Date.now() - entry.cachedAt > 12 * 60 * 60 * 1000) {
      if (!inFlight.has(key)) inFlight.set(key, load(category, gridLatitude, gridLongitude).finally(() => inFlight.delete(key)));
      try { entry = await inFlight.get(key); cache.set(key, entry); }
      catch (error) { if (!entry) throw error; stale = true; }
      while (cache.size > 120) cache.delete(cache.keys().next().value);
    }
    const radiusMeters = SEARCHES[category].radius;
    const places = entry.places.map(place => ({ ...place, distanceMeters: Math.round(haversine({ latitude, longitude }, place)) }))
      .filter(place => place.distanceMeters <= radiusMeters).sort((a, b) => a.distanceMeters - b.distanceMeters).slice(0, 20);
    return { category, radiusMeters, places, partial: entry.partial || stale, source: 'OpenStreetMap via Photon' };
  };
}
const nearbyPlaces = createNearbyPlacesService();
module.exports = { nearbyPlaces, createNearbyPlacesService };
