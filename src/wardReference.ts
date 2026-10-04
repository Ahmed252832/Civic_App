import type { WardBoundary, WardSuggestion } from './types';
import type { MapPoint } from './MapViews';

const files = new Map<string, Promise<WardBoundary[]>>();

export function loadReferenceBoundaries(corporation: 'DNCC' | 'DSCC'): Promise<WardBoundary[]> {
  if (!files.has(corporation)) {
    const url = new URL(`ward-boundaries/${corporation.toLowerCase()}.json`, document.baseURI).href;
    files.set(corporation, fetch(url).then(response => {
      if (!response.ok) throw new Error('Ward outlines are unavailable.');
      return response.json() as Promise<WardBoundary[]>;
    }).catch(error => { files.delete(corporation); throw error; }));
  }
  return files.get(corporation)!;
}

const inRing = (ring: number[][], longitude: number, latitude: number) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > latitude) !== (yj > latitude) && longitude < (xj - xi) * (latitude - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};

const polygons = (boundary: WardBoundary): number[][][][] => boundary.geometry.type === 'Polygon'
  ? [boundary.geometry.coordinates as number[][][]] : boundary.geometry.coordinates as number[][][][];

const contains = (boundary: WardBoundary, point: MapPoint) => polygons(boundary).some(polygon =>
  inRing(polygon[0], point.longitude, point.latitude) && !polygon.slice(1).some(hole => inRing(hole, point.longitude, point.latitude)));

const distanceToEdge = (boundary: WardBoundary, point: MapPoint) => {
  const xScale = 111_320 * Math.cos(point.latitude * Math.PI / 180), yScale = 110_540;
  let nearest = Infinity;
  for (const polygon of polygons(boundary)) for (const ring of polygon) for (let i = 1; i < ring.length; i++) {
    const a = [(ring[i - 1][0] - point.longitude) * xScale, (ring[i - 1][1] - point.latitude) * yScale];
    const b = [(ring[i][0] - point.longitude) * xScale, (ring[i][1] - point.latitude) * yScale];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const t = Math.max(0, Math.min(1, -(a[0] * dx + a[1] * dy) / (dx * dx + dy * dy || 1)));
    nearest = Math.min(nearest, Math.hypot(a[0] + t * dx, a[1] + t * dy));
  }
  return Math.round(nearest);
};

export async function suggestReferenceWard(point: MapPoint): Promise<WardSuggestion> {
  const [north, south] = await Promise.all([loadReferenceBoundaries('DNCC'), loadReferenceBoundaries('DSCC')]);
  const matches = [...north, ...south].filter(boundary => contains(boundary, point));
  if (matches.length !== 1) return { code: null, confidence: matches.length ? 'ambiguous' : 'unmapped', source: null };
  const distance = distanceToEdge(matches[0], point);
  return { code: matches[0].code, confidence: distance < 50 ? 'boundary' : 'inside', distanceToBoundaryMetres: distance, source: 'CivicPulse reference ward outlines' };
}
