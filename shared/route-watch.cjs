const DHAKA = { south: 23.65, north: 23.94, west: 90.30, east: 90.54 };
const radians = value => value * Math.PI / 180;
const validPoint = point => point && Number.isFinite(Number(point.latitude)) && Number.isFinite(Number(point.longitude)) && Number(point.latitude) >= DHAKA.south && Number(point.latitude) <= DHAKA.north && Number(point.longitude) >= DHAKA.west && Number(point.longitude) <= DHAKA.east;
const metresApart = (a, b) => {
  const dy = radians(b.latitude - a.latitude), dx = radians(b.longitude - a.longitude);
  const value = Math.sin(dy / 2) ** 2 + Math.cos(radians(a.latitude)) * Math.cos(radians(b.latitude)) * Math.sin(dx / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
};
const distanceToRoute = (point, path) => {
  const latitudeScale = 111195, longitudeScale = latitudeScale * Math.cos(radians(point.latitude));
  let nearest = Infinity;
  for (let index = 1; index < path.length; index++) {
    const a = path[index - 1], b = path[index];
    const ax = (a.longitude - point.longitude) * longitudeScale, ay = (a.latitude - point.latitude) * latitudeScale;
    const bx = (b.longitude - point.longitude) * longitudeScale, by = (b.latitude - point.latitude) * latitudeScale;
    const dx = bx - ax, dy = by - ay, lengthSquared = dx * dx + dy * dy;
    const fraction = lengthSquared ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / lengthSquared)) : 0;
    nearest = Math.min(nearest, Math.hypot(ax + fraction * dx, ay + fraction * dy));
  }
  return nearest;
};

async function routeWatch(store, payload, fetcher = fetch) {
  const origin = payload?.origin, destination = payload?.destination;
  if (!validPoint(origin) || !validPoint(destination)) throw new Error('Choose start and destination points inside Dhaka.');
  const from = { latitude: Number(origin.latitude), longitude: Number(origin.longitude) };
  const to = { latitude: Number(destination.latitude), longitude: Number(destination.longitude) };
  const directDistance = metresApart(from, to);
  if (directDistance < 100 || directDistance > 20000) throw new Error('Choose a destination between 100 metres and 20 kilometres away.');
  const coordinates = `${from.longitude},${from.latitude};${to.longitude},${to.latitude}`;
  const url = `https://router.project-osrm.org/route/v1/driving/${coordinates}?overview=full&geometries=geojson&steps=false`;
  const response = await fetcher(url, { headers: { 'User-Agent': 'CivicPulse/0.17 (https://github.com/Ahmed252832/Civic_App)' }, signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw new Error('Road route is temporarily unavailable. Try again later.');
  const body = await response.text();
  if (body.length > 1_000_000) throw new Error('Road route response was too large.');
  const result = JSON.parse(body);
  const route = result?.routes?.[0], raw = route?.geometry?.coordinates;
  if (result.code !== 'Ok' || !Array.isArray(raw) || raw.length < 2 || raw.length > 5000 || !Number.isFinite(route.distance) || !Number.isFinite(route.duration)) throw new Error('Road route could not be calculated. Try another destination.');
  const path = raw.map(point => ({ latitude: Number(point[1]), longitude: Number(point[0]) }));
  if (path.some(point => !Number.isFinite(point.latitude) || !Number.isFinite(point.longitude))) throw new Error('Road route data was invalid.');
  const alerts = store.publicStreetPulse();
  const nearby = alerts.map(alert => ({ ...alert, distance_from_route_metres: Math.round(distanceToRoute(alert, path)) }))
    .filter(alert => alert.distance_from_route_metres <= 500)
    .sort((a, b) => a.distance_from_route_metres - b.distance_from_route_metres)
    .slice(0, 30);
  return { origin: from, destination: to, path, distanceMeters: Math.round(route.distance), durationSeconds: Math.round(route.duration), alerts: nearby, corridorMeters: 500, source: 'OSRM / OpenStreetMap', checkedAt: new Date().toISOString() };
}

module.exports = { routeWatch, distanceToRoute };
