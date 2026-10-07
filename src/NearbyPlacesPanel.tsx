import { ArrowRight, Clock3, Flame, LocateFixed, MapPin, Navigation, Phone, RefreshCw, Route, ShieldCheck } from 'lucide-react';
import type { MapPoint } from './MapViews';
import { directionsUrl, placeDistance, placeLabel } from './places';
import type { NearbyPlace, NearbyPlacesResult, PlaceCategory } from './types';
import { useLocale } from './i18n';

const categories: PlaceCategory[] = ['police', 'fire', 'hospital', 'pharmacy', 'mosque', 'temple', 'market', 'school', 'college', 'university'];

export default function NearbyPlacesPanel({ category, onCategory, origin, onLocate, locating, result, loading, error, onRetry, selectedId, onSelect, routeMode, onRouteMode, onWatchRoute }: {
  category: PlaceCategory; onCategory: (value: PlaceCategory) => void; origin: MapPoint | null; onLocate: () => void; locating: boolean;
  result: NearbyPlacesResult | null; loading: boolean; error: string; onRetry: () => void;
  selectedId: string | null; onSelect: (id: string) => void; routeMode: 'walking' | 'driving'; onRouteMode: (mode: 'walking' | 'driving') => void; onWatchRoute: (origin: MapPoint, destination: NearbyPlace) => void;
}) {
  const { language } = useLocale();
  const bn = language === 'bn';
  const selected = result?.places.find(place => place.id === selectedId) || result?.places[0] || null;
  const dial = selected?.phone?.replace(/[^+0-9]/g, '');
  return <aside className="card nearby-places-panel" aria-label={bn ? 'কাছের প্রয়োজনীয় স্থান' : 'Nearby essential places'}>
    <div className="places-panel-head"><span className="eyebrow">{bn ? 'আপনার কাছাকাছি' : 'NEAR YOUR LOCATION'}</span><h2>{bn ? 'প্রয়োজনীয় স্থান' : 'Nearby essentials'}</h2><p>{bn ? 'একটি ধরন বাছুন, তারপর মানচিত্রে কোনো চিহ্নে ক্লিক করুন।' : 'Choose a category, then select a marker on the map.'}</p></div>
    <label>{bn ? 'যে স্থান খুঁজবেন' : 'Place category'}<select value={category} onChange={event => onCategory(event.target.value as PlaceCategory)}>{categories.map(value => <option key={value} value={value}>{placeLabel(value, language)}</option>)}</select></label>
    <div className="places-origin"><MapPin size={18} /><div><strong>{origin ? (bn ? 'শুরুর স্থান বাছা হয়েছে' : 'Starting point selected') : (bn ? 'শুরুর স্থান বাছুন' : 'Choose a starting point')}</strong><small>{origin ? `${origin.latitude.toFixed(5)}, ${origin.longitude.toFixed(5)}` : (bn ? 'অবস্থান ব্যবহার করুন বা মানচিত্রে ক্লিক করুন' : 'Use your location or click the map')}</small></div></div>
    <button type="button" className="secondary places-location-button" disabled={locating} onClick={onLocate}><LocateFixed size={16} />{locating ? (bn ? 'অবস্থান খোঁজা হচ্ছে…' : 'Finding location…') : (bn ? 'আমার অবস্থান ব্যবহার করুন' : 'Use my location')}</button>
    {(category === 'police' || category === 'fire' || category === 'hospital') && <div className="places-hotline"><strong>{bn ? 'জরুরি হটলাইন' : 'Emergency hotline'}</strong><p>{bn ? 'জরুরি পরিস্থিতিতে কাছের স্থানে যাওয়ার অপেক্ষা করবেন না।' : 'For an emergency, call directly.'}</p><div>{category === 'fire' && <a href="tel:102"><Flame size={16} /> {bn ? 'ফায়ার সার্ভিস ১০২' : 'Fire service 102'}</a>}<a href="tel:999"><ShieldCheck size={16} /> {bn ? 'জরুরি সেবা ৯৯৯' : 'Emergency 999'}</a></div></div>}
    {origin && <div className="places-results-head"><strong>{loading ? (bn ? 'কাছের স্থান খোঁজা হচ্ছে…' : 'Finding nearby places…') : `${result?.places.length || 0} ${bn ? 'টি স্থান' : 'places nearby'}`}</strong><button type="button" className="icon-button" aria-label={bn ? 'আবার খুঁজুন' : 'Search again'} disabled={loading} onClick={onRetry}><RefreshCw size={17} /></button></div>}
    {error && <p className="places-error" role="alert">{error}</p>}
    {result?.partial && <p className="places-caution">{bn ? 'কিছু মানচিত্রের তথ্য এখন পাওয়া যায়নি; আরও স্থান থাকতে পারে।' : 'Some map results are unavailable right now; more places may exist.'}</p>}
    {origin && !loading && !error && result && !result.places.length && <p className="muted">{bn ? `${result.radiusMeters / 1000} কিমির মধ্যে কোনো স্থান পাওয়া যায়নি। অন্য শুরুর স্থান চেষ্টা করুন।` : `No places found within ${result.radiusMeters / 1000} km. Try another starting point.`}</p>}
    {result?.places.length ? <div className="places-list">{result.places.map(place => <button type="button" key={place.id} className={selected?.id === place.id ? 'place-list-item active' : 'place-list-item'} onClick={() => onSelect(place.id)} aria-pressed={selected?.id === place.id}><span><strong>{place.name}</strong><small>{place.address || (bn ? 'ঠিকানা তালিকাভুক্ত নেই' : 'Address not listed')}</small></span><em>{placeDistance(place.distanceMeters, language)}</em></button>)}</div> : null}
    {selected && origin && <article className="place-detail" aria-live="polite"><span className="eyebrow">{bn ? 'নির্বাচিত স্থান' : 'SELECTED PLACE'}</span><h3>{selected.name}</h3><p><MapPin size={16} /> {selected.address || (bn ? 'ঠিকানা তালিকাভুক্ত নেই' : 'Address not listed')}</p><p className="muted">{placeDistance(selected.distanceMeters, language)} {bn ? 'সরলরেখায়; রাস্তার দূরত্ব আলাদা হতে পারে।' : 'straight-line distance; road distance may differ.'}</p>
      {selected.phone && dial ? <a className="place-detail-link" href={`tel:${dial}`}><Phone size={17} /> {bn ? 'তালিকাভুক্ত ফোন' : 'Listed phone'}: {selected.phone}</a> : <p className="muted"><Phone size={16} /> {bn ? 'এই স্থানের ফোন নম্বর তালিকাভুক্ত নেই।' : 'No place-specific phone number is listed.'}</p>}
      {selected.openingHours && <p><Clock3 size={16} /> {bn ? 'তালিকাভুক্ত সময়' : 'Listed hours'}: {selected.openingHours}</p>}
      <label>{bn ? 'যাতায়াতের ধরন' : 'Travel mode'}<select value={routeMode} onChange={event => onRouteMode(event.target.value as 'walking' | 'driving')}><option value="walking">{bn ? 'হেঁটে' : 'Walking'}</option><option value="driving">{bn ? 'গাড়িতে' : 'Driving'}</option></select></label>
      <a className="primary place-route" href={directionsUrl(origin, selected, routeMode)} target="_blank" rel="noreferrer"><Navigation size={16} /> {bn ? 'গুগল ম্যাপে পথ দেখুন' : 'Open route in Google Maps'} <ArrowRight size={15} /></a>
      <button type="button" className="secondary place-watch-route" onClick={() => onWatchRoute(origin, selected)}><Route size={16} />{bn ? 'এই পথের সতর্কতা দেখুন' : 'Check alerts on this route'}</button>
      {selected.website && <a href={selected.website} target="_blank" rel="noreferrer">{bn ? 'তালিকাভুক্ত ওয়েবসাইট ↗' : 'Listed website ↗'}</a>}
      <a href={selected.osmUrl} target="_blank" rel="noreferrer">{bn ? 'OpenStreetMap-এ স্থানটি দেখুন ↗' : 'View place on OpenStreetMap ↗'}</a>
    </article>}
    <p className="places-source">{bn ? 'স্থানের তথ্য OpenStreetMap থেকে আসে; তথ্য অসম্পূর্ণ বা পুরোনো হতে পারে। পথনির্দেশ Google Maps-এ খোলে।' : 'Place details come from OpenStreetMap and may be incomplete or outdated. Routes open in Google Maps.'}</p>
  </aside>;
}
