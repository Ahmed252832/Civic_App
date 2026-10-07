import { ArrowRight, Flame, LocateFixed, MapPin, Navigation, Phone, RefreshCw, Route, ShieldCheck } from 'lucide-react';
import type { MapPoint } from './MapViews';
import { directionsUrl, placeDistance } from './places';
import type { NearbyPlace, PlaceCategory } from './types';
import { useLocale } from './i18n';

const groups: Array<{ category: PlaceCategory; en: string; bn: string }> = [
  { category: 'police', en: 'Police stations', bn: 'থানা ও পুলিশ স্টেশন' },
  { category: 'fire', en: 'Fire stations', bn: 'ফায়ার স্টেশন' },
  { category: 'hospital', en: 'Hospitals', bn: 'হাসপাতাল' }
];

export default function HelpNowPanel({ origin, onLocate, locating, places, loading, partial, error, selectedId, onSelect, onWatchRoute, onRetry }: {
  origin: MapPoint | null; onLocate: () => void; locating: boolean; places: NearbyPlace[]; loading: boolean; partial: boolean; error: string;
  selectedId: string | null; onSelect: (id: string) => void; onWatchRoute: (origin: MapPoint, destination: NearbyPlace) => void; onRetry: () => void;
}) {
  const { language } = useLocale(), bn = language === 'bn';
  const selected = places.find(place => place.id === selectedId) || places[0] || null;
  const dial = selected?.phone?.replace(/[^+0-9]/g, '');
  return <aside className="card help-now-panel"><span className="eyebrow">HELP NOW</span><h2>{bn ? 'জরুরি সহায়তা খুঁজুন' : 'Find help nearby'}</h2><p className="muted">{bn ? 'নিজের অবস্থান ব্যবহার করুন বা মানচিত্রে ক্লিক করুন। তারপর কাছের সেবা ও পথ দেখুন।' : 'Use your location or click the map to find nearby services and directions.'}</p>
    <div className="help-hotlines"><a href="tel:999"><ShieldCheck size={17} />{bn ? 'জরুরি সেবা ৯৯৯' : 'Emergency 999'}</a><a href="tel:102"><Flame size={17} />{bn ? 'ফায়ার সার্ভিস ১০২' : 'Fire service 102'}</a></div>
    <button type="button" className="secondary help-location" onClick={onLocate} disabled={locating}><LocateFixed size={16} />{locating ? (bn ? 'অবস্থান খোঁজা হচ্ছে…' : 'Finding location…') : (bn ? 'আমার অবস্থান ব্যবহার করুন' : 'Use my location')}</button>
    {origin && <button type="button" className="secondary help-location" onClick={onRetry} disabled={loading}><RefreshCw size={16} />{bn ? 'কাছের সেবা আবার খুঁজুন' : 'Search nearby help again'}</button>}
    {origin && <p className="help-origin"><MapPin size={15} />{bn ? 'শুরুর স্থান' : 'Starting point'}: {origin.latitude.toFixed(5)}, {origin.longitude.toFixed(5)}</p>}
    {loading && <p role="status">{bn ? 'কাছের সেবা খোঁজা হচ্ছে…' : 'Finding nearby help…'}</p>}
    {error && <p className="places-error" role="alert">{error}</p>}
    {partial && <p className="places-caution">{bn ? 'কিছু সেবার তথ্য পাওয়া যায়নি। অন্য সেবাও কাছাকাছি থাকতে পারে।' : 'Some service results are unavailable; other nearby places may exist.'}</p>}
    {origin && !loading && !error && !places.length && <p className="muted">{bn ? 'এখানে কাছের কোনো সেবা পাওয়া যায়নি। অন্য স্থান বাছুন।' : 'No nearby services were found here. Try another point.'}</p>}
    {groups.map(group => <section className="help-group" key={group.category}><h3>{bn ? group.bn : group.en}</h3>{places.filter(place => place.category === group.category).map(place => <button type="button" key={place.id} className={selected?.id === place.id ? 'help-place active' : 'help-place'} aria-pressed={selected?.id === place.id} onClick={() => onSelect(place.id)}><span><strong>{place.name}</strong><small>{place.address || (bn ? 'ঠিকানা তালিকাভুক্ত নেই' : 'Address not listed')}</small></span><em>{placeDistance(place.distanceMeters, language)}</em></button>)}{origin && !loading && !places.some(place => place.category === group.category) && <p className="muted">{bn ? 'এই ধরনের সেবা পাওয়া যায়নি।' : 'No result for this service.'}</p>}</section>)}
    {selected && origin && <article className="help-selected" aria-live="polite"><span className="eyebrow">{bn ? 'নির্বাচিত সেবা' : 'SELECTED SERVICE'}</span><h3>{selected.name}</h3><p>{selected.address || (bn ? 'ঠিকানা তালিকাভুক্ত নেই' : 'Address not listed')}</p>{selected.phone && dial ? <a href={`tel:${dial}`}><Phone size={16} />{bn ? 'তালিকাভুক্ত ফোন' : 'Listed phone'}: {selected.phone}</a> : <small>{bn ? 'এই স্থানের ফোন নম্বর তালিকাভুক্ত নেই।' : 'No place-specific phone is listed.'}</small>}<a className="primary help-route" href={directionsUrl(origin, selected, 'driving')} target="_blank" rel="noreferrer"><Navigation size={16} />{bn ? 'গুগল ম্যাপে পথ দেখুন' : 'Open directions'} <ArrowRight size={15} /></a><button type="button" className="secondary help-watch-route" onClick={() => onWatchRoute(origin, selected)}><Route size={16} />{bn ? 'এই পথের সতর্কতা দেখুন' : 'Check alerts on this route'}</button></article>}
    <p className="places-source">{bn ? 'স্থানের তথ্য OpenStreetMap থেকে আসে এবং অসম্পূর্ণ হতে পারে। জরুরি অবস্থায় নম্বরে সরাসরি কল করুন।' : 'Place details come from OpenStreetMap and may be incomplete. In an emergency, call directly.'}</p>
  </aside>;
}
