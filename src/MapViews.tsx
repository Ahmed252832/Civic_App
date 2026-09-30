import { useEffect, useMemo } from 'react';
import { Circle, CircleMarker, MapContainer, Popup, TileLayer, Tooltip, useMap, useMapEvents } from 'react-leaflet';
import type { PublicComplaint } from './types';

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

export function LocationPicker({ value, onPick }: { value: MapPoint | null; onPick: (latitude: number, longitude: number) => void }) {
  return <div className="map-frame picker-map"><MapContainer center={value ? [value.latitude, value.longitude] : center} zoom={value ? 17 : 12} minZoom={11} maxBounds={dhakaBounds} maxBoundsViscosity={1} scrollWheelZoom={false}>
    <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" />
    <ClickHandler onPick={point => onPick(point.latitude, point.longitude)} />
    <FocusPoint point={value} zoom={17} />
    {value && <CircleMarker center={[value.latitude, value.longitude]} radius={10} pathOptions={{ color: '#0e6d5c', fillColor: '#67e0bf', fillOpacity: 1, weight: 3 }} />}
  </MapContainer><span className="map-hint">Pin a location inside Dhaka city</span></div>;
}

function IssueMarker({ complaint, onOpen }: { complaint: PublicComplaint; onOpen: (id: number) => void }) {
  const map = useMap();
  const exact = complaint.location_exact === true;
  return <CircleMarker center={[complaint.latitude, complaint.longitude]} radius={9} bubblingMouseEvents={false}
    pathOptions={{ color: '#0d1827', weight: 2, fillColor: categoryColor(complaint.category), fillOpacity: 1 }}
    eventHandlers={{ click: () => map.flyTo([complaint.latitude, complaint.longitude], exact ? 17 : 15, { duration: .7 }) }}>
    <Tooltip>{complaint.code} · {complaint.category}</Tooltip>
    <Popup><div className="issue-popup"><strong>{complaint.title}</strong><span>{complaint.place_name || (exact ? 'Place name not recorded' : 'Approximate location')}</span><small>{complaint.area} · {complaint.status}</small><small>{complaint.latitude.toFixed(exact ? 6 : 3)}, {complaint.longitude.toFixed(exact ? 6 : 3)}</small><button type="button" onClick={() => onOpen(complaint.id)}>Open issue</button></div></Popup>
  </CircleMarker>;
}

export function IssueMap({ complaints, mode, onOpen, draftPin, onPick }: { complaints: PublicComplaint[]; mode: 'markers' | 'heat'; onOpen: (id: number) => void; draftPin?: MapPoint | null; onPick?: (point: MapPoint) => void }) {
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
  return <div className="map-frame overview-map"><MapContainer center={center} zoom={12} minZoom={11} maxBounds={dhakaBounds} maxBoundsViscosity={1} scrollWheelZoom={true}>
    <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" />
    {onPick && <ClickHandler onPick={onPick} />}
    <FocusPoint point={draftPin || null} zoom={17} />
    {draftPin && <CircleMarker center={[draftPin.latitude, draftPin.longitude]} radius={11} bubblingMouseEvents={false} pathOptions={{ color: '#ffffff', weight: 3, fillColor: '#20bfa3', fillOpacity: 1 }}><Tooltip permanent direction="top">New report pin</Tooltip></CircleMarker>}
    {mode === 'markers' ? complaints.map(c => <IssueMarker key={c.id} complaint={c} onOpen={onOpen} />) : clusters.map((cluster, index) => <Circle key={index} center={[cluster.latitude, cluster.longitude]}
      radius={Math.min(500, 180 + cluster.count * 75)} pathOptions={{ color: cluster.count >= 3 ? '#ff796e' : cluster.count === 2 ? '#ffa85f' : '#ffce75', weight: 1, fillOpacity: Math.min(.65, .22 + cluster.count * .12) }}>
      <Tooltip>{cluster.count} {cluster.count === 1 ? 'complaint' : 'complaints'} nearby</Tooltip>
    </Circle>)}
  </MapContainer><span className="map-hint">{onPick ? 'Click the map to place or move your report pin' : mode === 'markers' ? 'Click a report pin to zoom to its location' : `${clusters.length} geographic clusters`}</span></div>;
}
