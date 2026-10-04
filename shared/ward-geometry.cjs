const LIMITS = require('./wards.json');

const validWard = code => {
  const match = /^(DNCC|DSCC)-(\d{2})$/.exec(String(code || ''));
  return Boolean(match && Number(match[2]) >= 1 && Number(match[2]) <= LIMITS[match[1]]);
};

const ringContains = (ring, longitude, latitude) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > latitude) !== (yj > latitude) && longitude < (xj - xi) * (latitude - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};

const polygonContains = (polygon, longitude, latitude) =>
  ringContains(polygon[0], longitude, latitude) && !polygon.slice(1).some(hole => ringContains(hole, longitude, latitude));

const geometryContains = (geometry, longitude, latitude) => {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  return polygons.some(polygon => polygonContains(polygon, longitude, latitude));
};

const boundaryDistanceMeters = (geometry, longitude, latitude) => {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  const xScale = 111_320 * Math.cos(latitude * Math.PI / 180), yScale = 110_540;
  let nearest = Infinity;
  for (const polygon of polygons) for (const ring of polygon) for (let i = 1; i < ring.length; i++) {
    const a = [(ring[i - 1][0] - longitude) * xScale, (ring[i - 1][1] - latitude) * yScale];
    const b = [(ring[i][0] - longitude) * xScale, (ring[i][1] - latitude) * yScale];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const t = Math.max(0, Math.min(1, -(a[0] * dx + a[1] * dy) / (dx * dx + dy * dy || 1)));
    nearest = Math.min(nearest, Math.hypot(a[0] + t * dx, a[1] + t * dy));
  }
  return Math.round(nearest);
};

function parseWardFeatures(collection) {
  if (!collection || collection.type !== 'FeatureCollection' || !Array.isArray(collection.features)) throw new Error('Upload a GeoJSON FeatureCollection.');
  if (collection.features.length < 1 || collection.features.length > 129) throw new Error('Choose 1 to 129 ward features.');
  let vertices = 0;
  const seen = new Set();
  return collection.features.map(feature => {
    const code = String(feature?.properties?.ward_code || feature?.properties?.code || '').trim().toUpperCase();
    if (!validWard(code) || seen.has(code)) throw new Error(`Invalid or duplicate ward code: ${code || '(missing)'}.`);
    seen.add(code);
    const geometry = feature.geometry;
    if (!geometry || !['Polygon','MultiPolygon'].includes(geometry.type)) throw new Error(`Ward ${code} needs Polygon or MultiPolygon geometry.`);
    const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
    if (!Array.isArray(polygons) || !polygons.length) throw new Error(`Ward ${code} has no polygons.`);
    let south = Infinity, north = -Infinity, west = Infinity, east = -Infinity;
    for (const polygon of polygons) {
      if (!Array.isArray(polygon) || !polygon.length) throw new Error(`Ward ${code} has no outer ring.`);
      for (const ring of polygon) {
        if (!Array.isArray(ring) || ring.length < 4) throw new Error(`Ward ${code} has an invalid ring.`);
        const first = ring[0], last = ring.at(-1);
        if (!Array.isArray(first) || !Array.isArray(last) || first[0] !== last[0] || first[1] !== last[1]) throw new Error(`Ward ${code} has an open ring.`);
        vertices += ring.length;
        if (vertices > 100_000) throw new Error('Boundary file is too detailed. Simplify it without changing ward borders.');
        for (const point of ring) {
          if (!Array.isArray(point) || point.length < 2 || !Number.isFinite(point[0]) || !Number.isFinite(point[1]) || point[0] < 90.2 || point[0] > 90.7 || point[1] < 23.5 || point[1] > 24.1) throw new Error(`Ward ${code} has coordinates outside greater Dhaka or not in longitude, latitude order.`);
          west = Math.min(west, point[0]); east = Math.max(east, point[0]); south = Math.min(south, point[1]); north = Math.max(north, point[1]);
        }
      }
    }
    return { code, geometry: { type: geometry.type, coordinates: geometry.coordinates }, south, north, west, east };
  });
}

module.exports = { validWard, parseWardFeatures, geometryContains, boundaryDistanceMeters };
