import { useEffect, useMemo } from 'react';
import { Circle, CircleMarker, MapContainer, Polygon, Popup, TileLayer, Tooltip, useMap, useMapEvents } from 'react-leaflet';
import { latLngBounds } from 'leaflet';
import type { NearbyPlace, PublicComplaint, WardBoundary } from './types';
import { useLocale } from './i18n';
import { directionsUrl, placeDistance } from './places';

export type MapPoint = { latitude: number; longitude: number };
const center: [number, number] = [23.785, 90.405];
const dhakaBounds: [[number, number], [number, number]] = [[23.65, 90.30], [23.94, 90.54]];
export const inDhakaMap = (point: MapPoint) => point.latitude >= 23.65 && point.latitude <= 23.94 && point.longitude >= 90.30 && point.longitude <= 90.54;
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

function FocusBoundaries({ boundaries, selectedWardCode }: { boundaries: WardBoundary[]; selectedWardCode: string }) {
  const map = useMap();
  useEffect(() => {
    if (!boundaries.length) { map.setMaxBounds(dhakaBounds); return; }
    const all = latLngBounds(boundaries.flatMap(boundary => {
      const polygons = boundary.geometry.type === 'Polygon' ? [boundary.geometry.coordinates as number[][][]] : boundary.geometry.coordinates as number[][][][];
      return polygons.flatMap(polygon => polygon.flatMap(ring => ring.map(([longitude, latitude]) => [latitude, longitude] as [number, number])));
    }));
    if (!all.isValid()) return;
    map.setMaxBounds(all.pad(.12));
    const selected = boundaries.find(boundary => boundary.code === selectedWardCode);
    if (!selected) { map.fitBounds(all, { padding: [16, 16], animate: false }); return; }
    const geometry = selected.geometry;
    const polygons = geometry.type === 'Polygon' ? [geometry.coordinates as number[][][]] : geometry.coordinates as number[][][][];
    const ward = latLngBounds(polygons.flatMap(polygon => polygon.flatMap(ring => ring.map(([longitude, latitude]) => [latitude, longitude] as [number, number]))));
    if (ward.isValid()) map.fitBounds(ward, { padding: [38, 38], maxZoom: 16, animate: false });
  }, [map, boundaries, selectedWardCode]);
  return null;
}

function WardOutlines({ boundaries, selectedWardCode = '', onSelectWard }: { boundaries: WardBoundary[]; selectedWardCode?: string; onSelectWard?: (code: string) => void }) {
  return <>{boundaries.flatMap(boundary => {
    const polygons = boundary.geometry.type === 'Polygon' ? [boundary.geometry.coordinates as number[][][]] : boundary.geometry.coordinates as number[][][][];
    const selected = boundary.code === selectedWardCode;
    return polygons.map((polygon, index) => <Polygon key={`${boundary.code}-${index}`} positions={polygon.map(ring => ring.map(point => [point[1], point[0]] as [number,number]))} bubblingMouseEvents={!onSelectWard} pathOptions={{ color: selected ? '#f5c46d' : '#4eae96', weight: selected ? 3 : 1, opacity: selected ? 1 : .72, fillColor: selected ? '#f5c46d' : '#89e0c7', fillOpacity: selected ? .28 : .025 }} eventHandlers={onSelectWard ? { click: () => onSelectWard(boundary.code) } : undefined}><Tooltip permanent={selected} direction={selected ? 'center' : 'auto'}>{boundary.code.replace('-', ' Ward ')}</Tooltip></Polygon>);
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

function PlaceMarker({ place, origin, selected, onSelect, routeMode }: { place: NearbyPlace; origin: MapPoint; selected: boolean; onSelect: (id: string) => void; routeMode: 'walking' | 'driving' }) {
  const map = useMap();
  const { language } = useLocale();
  const bn = language === 'bn';
  const dial = place.phone?.replace(/[^+0-9]/g, '');
  return <CircleMarker center={[place.latitude, place.longitude]} radius={selected ? 12 : 9} bubblingMouseEvents={false}
    pathOptions={{ color: selected ? '#fff2bb' : '#10243a', weight: selected ? 3 : 2, fillColor: place.category === 'police' ? '#75baff' : place.category === 'fire' ? '#ff9b77' : place.category === 'mosque' ? '#8ae0af' : place.category === 'temple' ? '#c9a2ff' : '#ffd477', fillOpacity: 1 }}
    eventHandlers={{ click: () => { onSelect(place.id); map.flyTo([place.latitude, place.longitude], Math.max(map.getZoom(), 16), { duration: .6 }); } }}>
    <Tooltip>{place.name}</Tooltip>
    <Popup><div className="place-popup"><strong>{place.name}</strong><span>{place.address || (bn ? 'ঠিকানা দেওয়া নেই' : 'Address not listed')}</span><small>{placeDistance(place.distanceMeters, language)} {bn ? 'সরলরেখায়' : 'straight-line distance'}</small>
      {place.phone && dial && <a href={`tel:${dial}`}>{bn ? 'তালিকাভুক্ত ফোন' : 'Listed phone'}: {place.phone}</a>}
      {place.category === 'police' && <a href="tel:999">{bn ? 'জরুরি সেবা ৯৯৯' : 'Emergency hotline 999'}</a>}
      {place.category === 'fire' && <a href="tel:102">{bn ? 'ফায়ার সার্ভিস ১০২' : 'Fire service 102'}</a>}
      <a href={directionsUrl(origin, place, routeMode)} target="_blank" rel="noreferrer">{bn ? 'পথনির্দেশ খুলুন ↗' : 'Open route ↗'}</a>
    </div></Popup>
  </CircleMarker>;
}

export function IssueMap({ complaints, mode, onOpen, draftPin, onPick, boundaries = [], selectedWardCode = '', onSelectWard, places = [], placeOrigin = null, selectedPlace = null, onSelectPlace, routeMode = 'walking' }: { complaints: PublicComplaint[]; mode: 'markers' | 'heat' | 'places'; onOpen: (id: number) => void; draftPin?: MapPoint | null; onPick?: (point: MapPoint) => void; boundaries?: WardBoundary[]; selectedWardCode?: string; onSelectWard?: (code: string) => void; places?: NearbyPlace[]; placeOrigin?: MapPoint | null; selectedPlace?: NearbyPlace | null; onSelectPlace?: (id: string) => void; routeMode?: 'walking' | 'driving' }) {
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
  return <div className="map-frame overview-map" role="group" aria-label={mode === 'places' ? (language === 'bn' ? 'কাছের জরুরি ও প্রয়োজনীয় স্থান' : 'Nearby essential places map') : language === 'bn' ? 'অভিযোগের মানচিত্র' : 'Issue map'}><MapContainer center={center} zoom={12} minZoom={11} maxBounds={dhakaBounds} maxBoundsViscosity={1} scrollWheelZoom={true}>
    <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" />
    {onPick && <ClickHandler onPick={onPick} />}
    <FocusBoundaries boundaries={boundaries} selectedWardCode={selectedWardCode} />
    <WardOutlines boundaries={boundaries} selectedWardCode={selectedWardCode} onSelectWard={onSelectWard} />
    <FocusPoint point={mode === 'places' ? selectedPlace || placeOrigin : draftPin || null} zoom={mode === 'places' ? 15 : 17} />
    {mode === 'places' && placeOrigin && <CircleMarker center={[placeOrigin.latitude, placeOrigin.longitude]} radius={11} bubblingMouseEvents={false} pathOptions={{ color: '#ffffff', weight: 3, fillColor: '#20bfa3', fillOpacity: 1 }}><Tooltip permanent direction="top">{language === 'bn' ? 'আপনার শুরুর স্থান' : 'Your starting point'}</Tooltip></CircleMarker>}
    {mode !== 'places' && draftPin && <CircleMarker center={[draftPin.latitude, draftPin.longitude]} radius={11} bubblingMouseEvents={false} pathOptions={{ color: '#ffffff', weight: 3, fillColor: '#20bfa3', fillOpacity: 1 }}><Tooltip permanent direction="top">{language === 'bn' ? 'নতুন অভিযোগের স্থান' : 'New report pin'}</Tooltip></CircleMarker>}
    {mode === 'places' ? (placeOrigin && onSelectPlace ? places.map(place => <PlaceMarker key={place.id} place={place} origin={placeOrigin} selected={place.id === selectedPlace?.id} onSelect={onSelectPlace} routeMode={routeMode} />) : null) : mode === 'markers' ? complaints.map(c => <IssueMarker key={c.id} complaint={c} onOpen={onOpen} />) : clusters.map((cluster, index) => <Circle key={index} center={[cluster.latitude, cluster.longitude]}
      radius={Math.min(500, 180 + cluster.count * 75)} pathOptions={{ color: cluster.count >= 3 ? '#ff796e' : cluster.count === 2 ? '#ffa85f' : '#ffce75', weight: 1, fillOpacity: Math.min(.65, .22 + cluster.count * .12) }}>
      <Tooltip>{language === 'bn' ? `কাছাকাছি ${cluster.count}টি অভিযোগ` : `${cluster.count} ${cluster.count === 1 ? 'complaint' : 'complaints'} nearby`}</Tooltip>
    </Circle>)}
  </MapContainer><span className="map-hint">{mode === 'places' ? (language === 'bn' ? 'মানচিত্রে ক্লিক করে শুরুর স্থান বদলান; রঙিন চিহ্নে ক্লিক করে বিবরণ দেখুন' : 'Click the map to move your starting point, or click a place marker for details') : onPick ? (language === 'bn' ? 'মানচিত্রে ক্লিক করুন অথবা উপরে স্থানাঙ্ক লিখুন' : 'Click the map or enter coordinates above') : mode === 'markers' ? (language === 'bn' ? 'অভিযোগের চিহ্নে ক্লিক করলে স্থানটি বড় হবে' : 'Click a report pin to zoom to its location') : `${clusters.length} ${language === 'bn' ? 'ভৌগোলিক গুচ্ছ' : 'geographic clusters'}`}</span></div>;
}
