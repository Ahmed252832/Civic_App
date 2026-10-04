import { useEffect, useMemo } from 'react';
import { Circle, CircleMarker, MapContainer, Polygon, Popup, TileLayer, Tooltip, useMap, useMapEvents } from 'react-leaflet';
import type { PublicComplaint, WardBoundary } from './types';
import { useLocale } from './i18n';

export type MapPoint = { latitude: number; longitude: number };
const center: [number, number] = [23.785, 90.405];
const dhakaBounds: [[number, number], [number, number]] = [[23.68, 90.30], [23.92, 90.53]];
export const inDhakaMap = (point: MapPoint) => point.latitude >= 23.68 && point.latitude <= 23.92 && point.longitude >= 90.30 && point.longitude <= 90.53;
const categoryColor = (category: string) => {
  if (/Road|Pothole/i.test(category)) return '#f59e6c';
  if (/Garbage|Waste/i.test(category)) return '#b19aff';
  if (/Drainage|Water|Flood/i.test(category)) return '#66b8ff';
  if (/Streetlight|Electrical/i.test(category)) return '#ffd277';
  return '#7ee0c3';
};

function ClickHandler({ onPick }: { onPick: (point: MapPoint) => void }) {
  useMapEvents({ click(event) {
    const point = { latitude: Number(event.latlng.lat.toFixed(6)), longitude: Number(event.latlng.lng.toFixed(6)) };
    if (inDhakaMap(point)) onPick(point);
  } });
  return null;
}

function FocusPoint({ point, zoom }: { point: MapPoint | null; zoom: number }) {
  const map = useMap();
  useEffect(() => { if (point) map.flyTo([point.latitude, point.longitude], Math.max(map.getZoom(), zoom), { duration: .65 }); }, [map, point?.latitude, point?.longitude, zoom]);
  return null;
}

function FocusRegion({ point }: { point: MapPoint | null }) {
  const map = useMap();
  useEffect(() => { if (point) map.flyTo([point.latitude, point.longitude], 13, { duration: .65 }); }, [map, point]);
  return null;
}

function WardOutlines({ boundaries }: { boundaries: WardBoundary[] }) {
  return <>{boundaries.flatMap(boundary => {
    const polygons = boundary.geometry.type === 'Polygon' ? [boundary.geometry.coordinates as number[][][]] : boundary.geometry.coordinates as number[][][][];
    return polygons.map((polygon, index) => <Polygon key={`${boundary.code}-${index}`} positions={polygon.map(ring => ring.map(point => [point[1], point[0]] as [number,number]))} pathOptions={{ color: '#89e0c7', weight: 2, fillOpacity: .06 }}><Tooltip>{boundary.code}</Tooltip></Polygon>);
  })}</>;
}

export function LocationPicker({ value, onPick, boundaries = [] }: { value: MapPoint | null; onPick: (latitude: number, longitude: number) => void; boundaries?: WardBoundary[] }) {
  const { language } = useLocale();
  return <div className="map-frame picker-map" role="group" aria-label={language === 'bn' ? 'অবস্থান বাছার মানচিত্র' : 'Choose report location on map'}><MapContainer center={value ? [value.latitude, value.longitude] : center} zoom={value ? 17 : 12} minZoom={11} maxBounds={dhakaBounds} maxBoundsViscosity={1} scrollWheelZoom={false}>
    <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" />
    <ClickHandler onPick={point => onPick(point.latitude, point.longitude)} />
    <FocusPoint point={value} zoom={17} />
    <WardOutlines boundaries={boundaries} />
    {value && <CircleMarker center={[value.latitude, value.longitude]} radius={10} pathOptions={{ color: '#0e6d5c', fillColor: '#67e0bf', fillOpacity: 1, weight: 3 }} />}
  </MapContainer><span className="map-hint">{language === 'bn' ? 'ঢাকার ভেতরে স্থান বাছুন; নিচে কিবোর্ড দিয়ে স্থানাঙ্কও লিখতে পারেন।' : 'Pin inside Dhaka or enter coordinates below'}</span></div>;
}

function IssueMarker({ complaint, onOpen }: { complaint: PublicComplaint; onOpen: (id: number) => void }) {
  const map = useMap();
  const { language, t } = useLocale();
  const exact = complaint.location_exact === true;
  return <CircleMarker center={[complaint.latitude, complaint.longitude]} radius={9} bubblingMouseEvents={false}
    pathOptions={{ color: '#0d1827', weight: 2, fillColor: categoryColor(complaint.category), fillOpacity: 1 }}
    eventHandlers={{ click: () => map.flyTo([complaint.latitude, complaint.longitude], exact ? 17 : 15, { duration: .7 }) }}>
    <Tooltip>{complaint.code} · {t(complaint.category)}</Tooltip>
    <Popup><div className="issue-popup"><strong>{complaint.title}</strong><span>{complaint.place_name || (exact ? t('Place name not recorded') : t('Approximate location'))}</span><small>{complaint.area} · {t(complaint.status)}</small><small>{complaint.latitude.toFixed(exact ? 6 : 3)}, {complaint.longitude.toFixed(exact ? 6 : 3)}</small><button type="button" onClick={() => onOpen(complaint.id)}>{language === 'bn' ? 'অভিযোগ খুলুন' : 'Open issue'}</button></div></Popup>
  </CircleMarker>;
}

export function IssueMap({ complaints, mode, onOpen, draftPin, onPick, regionFocus, boundaries = [] }: { complaints: PublicComplaint[]; mode: 'markers' | 'heat'; onOpen: (id: number) => void; draftPin?: MapPoint | null; onPick?: (point: MapPoint) => void; regionFocus?: MapPoint | null; boundaries?: WardBoundary[] }) {
  const { language } = useLocale();
  const clusters = useMemo(() => {
    const cells = new Map<string, { latitude: number; longitude: number; count: number }>();
    for (const c of complaints) {
      const key = `${Math.round(c.latitude * 170)}:${Math.round(c.longitude * 170)}`;
      const item = cells.get(key) || { latitude: 0, longitude: 0, count: 0 };
      item.latitude += c.latitude; item.longitude += c.longitude; item.count++;
      cells.set(key, item);
    }
    return Array.from(cells.values()).map(c => ({ ...c, latitude: c.latitude / c.count, longitude: c.longitude / c.count }));
  }, [complaints]);
  return <div className="map-frame overview-map" role="group" aria-label={language === 'bn' ? 'অভিযোগের মানচিত্র' : 'Issue map'}><MapContainer center={center} zoom={12} minZoom={11} maxBounds={dhakaBounds} maxBoundsViscosity={1} scrollWheelZoom={true}>
    <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" />
    {onPick && <ClickHandler onPick={onPick} />}
    <FocusRegion point={regionFocus || null} />
    <WardOutlines boundaries={boundaries} />
    <FocusPoint point={draftPin || null} zoom={17} />
    {draftPin && <CircleMarker center={[draftPin.latitude, draftPin.longitude]} radius={11} bubblingMouseEvents={false} pathOptions={{ color: '#ffffff', weight: 3, fillColor: '#20bfa3', fillOpacity: 1 }}><Tooltip permanent direction="top">{language === 'bn' ? 'নতুন অভিযোগের স্থান' : 'New report pin'}</Tooltip></CircleMarker>}
    {mode === 'markers' ? complaints.map(c => <IssueMarker key={c.id} complaint={c} onOpen={onOpen} />) : clusters.map((cluster, index) => <Circle key={index} center={[cluster.latitude, cluster.longitude]}
      radius={Math.min(500, 180 + cluster.count * 75)} pathOptions={{ color: cluster.count >= 3 ? '#ff796e' : cluster.count === 2 ? '#ffa85f' : '#ffce75', weight: 1, fillOpacity: Math.min(.65, .22 + cluster.count * .12) }}>
      <Tooltip>{language === 'bn' ? `কাছাকাছি ${cluster.count}টি অভিযোগ` : `${cluster.count} ${cluster.count === 1 ? 'complaint' : 'complaints'} nearby`}</Tooltip>
    </Circle>)}
  </MapContainer><span className="map-hint">{onPick ? (language === 'bn' ? 'মানচিত্রে ক্লিক করুন অথবা উপরে স্থানাঙ্ক লিখুন' : 'Click the map or enter coordinates above') : mode === 'markers' ? (language === 'bn' ? 'অভিযোগের চিহ্নে ক্লিক করলে স্থানটি বড় হবে' : 'Click a report pin to zoom to its location') : `${clusters.length} ${language === 'bn' ? 'ভৌগোলিক গুচ্ছ' : 'geographic clusters'}`}</span></div>;
}
