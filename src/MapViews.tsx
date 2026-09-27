import { useMemo } from 'react';
import { Circle, CircleMarker, MapContainer, Popup, TileLayer, Tooltip, useMapEvents } from 'react-leaflet';
import type { PublicComplaint } from './types';

const center: [number, number] = [23.785, 90.405];
const dhakaBounds: [[number, number], [number, number]] = [[23.68, 90.30], [23.92, 90.53]];
const categoryColor = (category: string) => {
  if (/Road|Pothole/i.test(category)) return '#f59e6c';
  if (/Garbage|Waste/i.test(category)) return '#b19aff';
  if (/Drainage|Water|Flood/i.test(category)) return '#66b8ff';
  if (/Streetlight|Electrical/i.test(category)) return '#ffd277';
  return '#7ee0c3';
};

function ClickHandler({ onPick }: { onPick: (latitude: number, longitude: number) => void }) {
  useMapEvents({ click(event) { onPick(Number(event.latlng.lat.toFixed(6)), Number(event.latlng.lng.toFixed(6))); } });
  return null;
}

export function LocationPicker({ value, onPick }: { value: { latitude: number; longitude: number } | null; onPick: (latitude: number, longitude: number) => void }) {
  return <div className="map-frame picker-map"><MapContainer center={value ? [value.latitude, value.longitude] : center} zoom={12} minZoom={11} maxBounds={dhakaBounds} maxBoundsViscosity={1} scrollWheelZoom={false}>
    <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" />
    <ClickHandler onPick={(latitude, longitude) => { if (latitude >= 23.68 && latitude <= 23.92 && longitude >= 90.30 && longitude <= 90.53) onPick(latitude, longitude); }} />
    {value && <CircleMarker center={[value.latitude, value.longitude]} radius={10} pathOptions={{ color: '#0e6d5c', fillColor: '#67e0bf', fillOpacity: 1, weight: 3 }} />}
  </MapContainer><span className="map-hint">Pin a location inside Dhaka city</span></div>;
}

export function IssueMap({ complaints, mode, onOpen }: { complaints: PublicComplaint[]; mode: 'markers' | 'heat'; onOpen: (id: number) => void }) {
  const clusters = useMemo(() => {
    const cells = new Map<string, { latitude: number; longitude: number; count: number; ids: number[] }>();
    for (const c of complaints) {
      const key = `${Math.round(c.latitude * 170)}:${Math.round(c.longitude * 170)}`;
      const item = cells.get(key) || { latitude: 0, longitude: 0, count: 0, ids: [] };
      item.latitude += c.latitude; item.longitude += c.longitude; item.count++; item.ids.push(c.id);
      cells.set(key, item);
    }
    return Array.from(cells.values()).map(c => ({ ...c, latitude: c.latitude / c.count, longitude: c.longitude / c.count }));
  }, [complaints]);
  return <div className="map-frame overview-map"><MapContainer center={center} zoom={12} minZoom={11} maxBounds={dhakaBounds} maxBoundsViscosity={1} scrollWheelZoom={true}>
    <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" />
    {mode === 'markers' ? complaints.map(c => <CircleMarker key={c.id} center={[c.latitude, c.longitude]} radius={9}
      pathOptions={{ color: '#0d1827', weight: 2, fillColor: categoryColor(c.category), fillOpacity: 1 }} eventHandlers={{ click: () => onOpen(c.id) }}>
      <Tooltip>{c.code} · {c.category}</Tooltip><Popup><strong>{c.title}</strong><br />{c.area} · {c.status}<br /><button onClick={() => onOpen(c.id)}>Open issue</button></Popup>
    </CircleMarker>) : clusters.map((cluster, index) => <Circle key={index} center={[cluster.latitude, cluster.longitude]}
      radius={Math.min(500, 180 + cluster.count * 75)} pathOptions={{ color: cluster.count >= 3 ? '#ff796e' : cluster.count === 2 ? '#ffa85f' : '#ffce75', weight: 1, fillOpacity: Math.min(.65, .22 + cluster.count * .12) }}>
      <Tooltip>{cluster.count} {cluster.count === 1 ? 'complaint' : 'complaints'} nearby</Tooltip>
    </Circle>)}
  </MapContainer><span className="map-hint">{mode === 'markers' ? `${complaints.length} visible reports` : `${clusters.length} geographic clusters`}</span></div>;
}
