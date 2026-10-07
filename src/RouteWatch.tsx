import { useEffect, useState, type FormEvent } from 'react';
import { Circle, CircleMarker, MapContainer, Polyline, Popup, TileLayer, Tooltip, useMap, useMapEvents } from 'react-leaflet';
import { latLngBounds } from 'leaflet';
import { ArrowRight, LocateFixed, MapPin, Navigation, Route, ShieldAlert } from 'lucide-react';
import { request } from './api';
import { inDhakaMap, type MapPoint } from './MapViews';
import { pointDirectionsUrl } from './places';
import type { RouteWatchAlert, RouteWatchResult } from './types';
import { useLocale } from './i18n';

const dhakaBounds: [[number, number], [number, number]] = [[23.65, 90.30], [23.94, 90.54]];
const hazardNames: Record<string, [string, string]> = {
  Flooding: ['Flooding', 'জলাবদ্ধতা'], 'Broken streetlight': ['Broken streetlight', 'বিকল সড়কবাতি'],
  'Blocked walkway': ['Blocked walkway', 'বন্ধ ফুটপাত'], 'Road damage': ['Road damage', 'রাস্তার ক্ষতি'],
  'Waste obstruction': ['Waste obstruction', 'বর্জ্যে পথ বন্ধ'], 'Other public hazard': ['Other public hazard', 'অন্যান্য জনদুর্ভোগ']
};
const pointFrom = (latitude: string, longitude: string): MapPoint | null => {
  if (!latitude.trim() || !longitude.trim()) return null;
  const point = { latitude: Number(latitude), longitude: Number(longitude) };
  return Number.isFinite(point.latitude) && Number.isFinite(point.longitude) && inDhakaMap(point) ? point : null;
};
function RouteMapClick({ onPick }: { onPick: (point: MapPoint) => void }) {
  useMapEvents({ click(event) { const point = { latitude: Number(event.latlng.lat.toFixed(6)), longitude: Number(event.latlng.lng.toFixed(6)) }; if (inDhakaMap(point)) onPick(point); } });
  return null;
}
function RouteFocus({ start, end, result, selected }: { start: MapPoint | null; end: MapPoint | null; result: RouteWatchResult | null; selected: RouteWatchAlert | null }) {
  const map = useMap();
  useEffect(() => {
    if (result?.path.length) {
      const bounds = latLngBounds(result.path.map(point => [point.latitude, point.longitude] as [number, number]));
      if (bounds.isValid()) map.fitBounds(bounds, { padding: [35, 35], maxZoom: 15 });
    } else if (start && end) map.fitBounds([[start.latitude, start.longitude], [end.latitude, end.longitude]], { padding: [45, 45], maxZoom: 15 });
    else if (start) map.flyTo([start.latitude, start.longitude], 14, { duration: .5 });
  }, [map, start?.latitude, start?.longitude, end?.latitude, end?.longitude, result]);
  useEffect(() => { if (selected) map.flyTo([selected.latitude, selected.longitude], Math.max(map.getZoom(), 15), { duration: .5 }); }, [map, selected?.id]);
  return null;
}

export default function RouteWatch({ initialOrigin = null, initialDestination = null }: { initialOrigin?: MapPoint | null; initialDestination?: MapPoint | null }) {
  const { language } = useLocale(), bn = language === 'bn';
  const [fromLat, setFromLat] = useState(initialOrigin ? String(initialOrigin.latitude) : ''), [fromLon, setFromLon] = useState(initialOrigin ? String(initialOrigin.longitude) : '');
  const [toLat, setToLat] = useState(initialDestination ? String(initialDestination.latitude) : ''), [toLon, setToLon] = useState(initialDestination ? String(initialDestination.longitude) : '');
  const [pick, setPick] = useState<'start' | 'end'>('start');
  const [result, setResult] = useState<RouteWatchResult | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false), [locating, setLocating] = useState(false), [error, setError] = useState('');
  const start = pointFrom(fromLat, fromLon), end = pointFrom(toLat, toLon);
  const selected = result?.alerts.find(alert => alert.id === selectedId) || null;
  const setPoint = (point: MapPoint) => {
    if (pick === 'start') { setFromLat(String(point.latitude)); setFromLon(String(point.longitude)); setPick('end'); }
    else { setToLat(String(point.latitude)); setToLon(String(point.longitude)); }
    setResult(null); setError('');
  };
  const useLocation = () => {
    if (!navigator.geolocation) return setError(bn ? 'এই ডিভাইসে অবস্থান পাওয়া যাচ্ছে না। স্থানাঙ্ক লিখুন বা মানচিত্রে ক্লিক করুন।' : 'Location is unavailable. Enter coordinates or click the map.');
    setLocating(true);
    navigator.geolocation.getCurrentPosition(({ coords }) => {
      setLocating(false);
      const point = { latitude: Number(coords.latitude.toFixed(6)), longitude: Number(coords.longitude.toFixed(6)) };
      if (!inDhakaMap(point)) return setError(bn ? 'অবস্থান ঢাকার সেবা এলাকার বাইরে।' : 'Your location is outside the Dhaka service area.');
      setFromLat(String(point.latitude)); setFromLon(String(point.longitude)); setPick('end'); setResult(null); setError('');
    }, () => { setLocating(false); setError(bn ? 'অবস্থান পাওয়া যায়নি। অনুমতি দেখুন বা স্থানাঙ্ক লিখুন।' : 'Could not get your location. Check permission or enter coordinates.'); }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 });
  };
  const check = async (event: FormEvent) => {
    event.preventDefault();
    if (!start || !end) return setError(bn ? 'ঢাকার ভেতরে শুরুর ও গন্তব্যের সঠিক স্থানাঙ্ক দিন।' : 'Choose valid start and destination points inside Dhaka.');
    setLoading(true); setError(''); setResult(null); setSelectedId(null);
    try { setResult(await request<RouteWatchResult>('routeWatch', { origin: start, destination: end })); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setLoading(false); }
  };
  const change = (setter: (value: string) => void, value: string) => { setter(value); setResult(null); setError(''); };
  return <div className="route-watch-layout">
    <div className="map-frame route-watch-map" role="group" aria-label={bn ? 'পথের সতর্কতার মানচিত্র' : 'Route Watch map'}>
      <MapContainer center={[23.785, 90.405]} zoom={12} minZoom={11} maxBounds={dhakaBounds} maxBoundsViscosity={1} scrollWheelZoom={true}>
        <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" />
        <RouteMapClick onPick={setPoint} /><RouteFocus start={start} end={end} result={result} selected={selected} />
        {result && <Polyline positions={result.path.map(point => [point.latitude, point.longitude])} pathOptions={{ color: '#68dfbb', weight: 6, opacity: .9 }} />}
        {start && <CircleMarker center={[start.latitude, start.longitude]} radius={10} bubblingMouseEvents={false} pathOptions={{ color: '#fff', fillColor: '#3ed0a9', fillOpacity: 1, weight: 3 }}><Tooltip permanent direction="top">{bn ? 'শুরু' : 'Start'}</Tooltip></CircleMarker>}
        {end && <CircleMarker center={[end.latitude, end.longitude]} radius={10} bubblingMouseEvents={false} pathOptions={{ color: '#fff', fillColor: '#78b9ff', fillOpacity: 1, weight: 3 }}><Tooltip permanent direction="top">{bn ? 'গন্তব্য' : 'Destination'}</Tooltip></CircleMarker>}
        {result?.alerts.map(alert => <Circle key={alert.id} center={[alert.latitude, alert.longitude]} radius={250} bubblingMouseEvents={false} pathOptions={{ color: '#f7aa71', fillColor: '#ef8e67', fillOpacity: .24, weight: selectedId === alert.id ? 3 : 2 }} eventHandlers={{ click: () => setSelectedId(alert.id) }}><Popup><strong>{hazardNames[alert.hazard_type]?.[bn ? 1 : 0] || alert.hazard_type}</strong><br />{bn ? 'আনুমানিক সতর্কতার এলাকা' : 'Approximate alert area'}<br />{alert.ward_code}</Popup></Circle>)}
      </MapContainer><span className="map-hint">{bn ? `মানচিত্রে ক্লিক করে ${pick === 'start' ? 'শুরুর স্থান' : 'গন্তব্য'} বাছুন` : `Click the map to choose ${pick === 'start' ? 'the start' : 'the destination'}`}</span>
    </div>
    <aside className="card route-watch-panel"><span className="eyebrow">{bn ? 'পথের সতর্কতা' : 'ROUTE WATCH'}</span><h2>{bn ? 'পথের কাছের সতর্কতা' : 'Alerts near your route'}</h2><p className="muted">{bn ? 'গাড়ির পথ বাছুন। কর্মীদের প্রকাশিত সতর্কতা পথের প্রায় ৫০০ মিটারের মধ্যে থাকলে দেখাবে।' : 'Plan a driving route. See staff-published alerts within about 500 m of the road route.'}</p>
      <div className="route-pick-row"><button type="button" className={pick === 'start' ? 'active' : ''} aria-pressed={pick === 'start'} onClick={() => setPick('start')}><MapPin size={15} />{bn ? 'শুরু বাছুন' : 'Pick start'}</button><button type="button" className={pick === 'end' ? 'active' : ''} aria-pressed={pick === 'end'} onClick={() => setPick('end')}><Navigation size={15} />{bn ? 'গন্তব্য বাছুন' : 'Pick destination'}</button></div>
      <button type="button" className="secondary route-location" onClick={useLocation} disabled={locating}><LocateFixed size={16} />{locating ? (bn ? 'অবস্থান খোঁজা হচ্ছে…' : 'Finding location…') : (bn ? 'আমার অবস্থান থেকে শুরু' : 'Start from my location')}</button>
      <form onSubmit={event => void check(event)}><fieldset><legend>{bn ? 'শুরুর স্থান' : 'Start coordinates'}</legend><label>{bn ? 'অক্ষাংশ' : 'Latitude'}<input aria-label={bn ? 'শুরুর অক্ষাংশ' : 'Start latitude'} type="number" step="any" value={fromLat} onChange={event => change(setFromLat, event.target.value)} /></label><label>{bn ? 'দ্রাঘিমাংশ' : 'Longitude'}<input aria-label={bn ? 'শুরুর দ্রাঘিমাংশ' : 'Start longitude'} type="number" step="any" value={fromLon} onChange={event => change(setFromLon, event.target.value)} /></label></fieldset><fieldset><legend>{bn ? 'গন্তব্য' : 'Destination coordinates'}</legend><label>{bn ? 'অক্ষাংশ' : 'Latitude'}<input aria-label={bn ? 'গন্তব্যের অক্ষাংশ' : 'Destination latitude'} type="number" step="any" value={toLat} onChange={event => change(setToLat, event.target.value)} /></label><label>{bn ? 'দ্রাঘিমাংশ' : 'Longitude'}<input aria-label={bn ? 'গন্তব্যের দ্রাঘিমাংশ' : 'Destination longitude'} type="number" step="any" value={toLon} onChange={event => change(setToLon, event.target.value)} /></label></fieldset><button type="submit" className="primary" disabled={loading || !start || !end}><Route size={17} />{loading ? (bn ? 'পথ দেখা হচ্ছে…' : 'Checking route…') : (bn ? 'পথ পরীক্ষা করুন' : 'Check route')}</button></form>
      {error && <p className="places-error" role="alert">{error}</p>}
      {start && end && <a className="secondary route-google" href={pointDirectionsUrl(start, end, 'driving')} target="_blank" rel="noreferrer"><Navigation size={16} />{bn ? 'গুগল ম্যাপে পথ খুলুন' : 'Open directions in Google Maps'} <ArrowRight size={15} /></a>}
      {result && <div className="route-watch-results" aria-live="polite"><div className="route-watch-metrics"><strong>{(result.distanceMeters / 1000).toFixed(1)} {bn ? 'কিমি' : 'km'}</strong><span>{Math.round(result.durationSeconds / 60)} {bn ? 'মিনিট (আনুমানিক)' : 'min estimated'}</span></div><h3>{result.alerts.length ? (bn ? `${result.alerts.length}টি সতর্কতা পথের কাছে` : `${result.alerts.length} alerts near this route`) : (bn ? 'এই পথে প্রকাশিত সতর্কতা পাওয়া যায়নি' : 'No published alerts found near this route')}</h3>{result.alerts.map(alert => <button type="button" key={alert.id} className={selectedId === alert.id ? 'route-alert active' : 'route-alert'} onClick={() => setSelectedId(alert.id)}><ShieldAlert size={18} /><span><strong>{hazardNames[alert.hazard_type]?.[bn ? 1 : 0] || alert.hazard_type}</strong><small>{alert.ward_code} · {Math.round(alert.distance_from_route_metres)} {bn ? 'মিটার দূরে (আনুমানিক)' : 'm from route (approx.)'}</small><small>{bn ? 'প্রকাশিত' : 'Published'} {new Date(alert.created_at.replace(' ', 'T') + 'Z').toLocaleString(bn ? 'bn-BD' : 'en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</small></span></button>)}</div>}
      <p className="places-source">{bn ? 'শুধু কর্মীদের প্রকাশিত চলমান StreetPulse সতর্কতা দেখানো হয়। চিহ্নগুলো আনুমানিক; সতর্কতা না থাকা মানে পথ নিরাপদ এমন নয়। OSRM/OpenStreetMap পথ দেখায়; সরাসরি ট্রাফিক তথ্য নেই। পথ গণনার জন্য শুরুর ও গন্তব্যের স্থানাঙ্ক OSRM-এ পাঠানো হয়; CivicPulse-এর অভিযোগের ডাটাবেসে রাখা হয় না।' : 'Only active staff-published StreetPulse alerts are checked. Alert positions are approximate; no alert does not mean a route is safe. OSRM/OpenStreetMap provides the driving route without live traffic. Start and destination coordinates are sent to OSRM to calculate it and are not stored in the CivicPulse complaint database.'}</p>
    </aside>
  </div>;
}
