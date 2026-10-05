import { useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, Polygon, TileLayer, Tooltip, useMap } from 'react-leaflet';
import { latLngBounds } from 'leaflet';
import { ArrowLeft, CalendarDays, Pause, Play } from 'lucide-react';
import { request } from './api';
import { useLocale } from './i18n';
import { wardLabel } from './wards';
import type { ReplayFrame, ReplayWard, WardBoundary } from './types';

const currentDhakaMonth = () => new Date(Date.now() + 6 * 3600000).toISOString().slice(0, 7);
const monthsThrough = (last: string) => {
  const [year, month] = last.split('-').map(Number);
  return Array.from({ length: 18 }, (_, index) => {
    const date = new Date(Date.UTC(year, month - 18 + index, 1));
    return date.toISOString().slice(0, 7);
  });
};
const ringsOf = (boundary: WardBoundary) => {
  const polygons = boundary.geometry.type === 'Polygon' ? [boundary.geometry.coordinates as number[][][]] : boundary.geometry.coordinates as number[][][][];
  return polygons.map(polygon => polygon.map(ring => ring.map(([longitude, latitude]) => [latitude, longitude] as [number, number])));
};
const wardColor = (ward: ReplayWard | undefined, maxOpen: number) => {
  if (!ward) return '#536d74';
  if (ward.open === 0) return '#4ec5a1';
  if (ward.open / Math.max(maxOpen, 1) > .6) return '#e97868';
  if (ward.open / Math.max(maxOpen, 1) > .28) return '#e5aa5c';
  return '#98d38d';
};

function FitReplay({ boundaries, selected }: { boundaries: WardBoundary[]; selected: string }) {
  const map = useMap();
  useEffect(() => {
    const targets = selected ? boundaries.filter(boundary => boundary.code === selected) : boundaries;
    const points = targets.flatMap(boundary => ringsOf(boundary).flatMap(polygon => polygon.flatMap(ring => ring)));
    if (points.length) {
      const bounds = latLngBounds(points);
      if (bounds.isValid()) map.fitBounds(bounds, { padding: [24, 24], maxZoom: selected ? 15 : 12, animate: false });
    }
  }, [map, boundaries, selected]);
  return null;
}

function ReplayMap({ boundaries, frame, selected, onSelect }: { boundaries: WardBoundary[]; frame: ReplayFrame | null; selected: string; onSelect: (code: string) => void }) {
  const { language } = useLocale();
  const byCode = useMemo(() => new Map(frame?.wards.map(ward => [ward.code, ward]) || []), [frame]);
  const maxOpen = Math.max(1, ...(frame?.wards.map(ward => ward.open) || []));
  return <div className="replay-map" role="group" aria-label={language === 'bn' ? 'ওয়ার্ডভিত্তিক সময়ের মানচিত্র' : 'Ward history map'}>
    <MapContainer center={[23.785, 90.405]} zoom={11} minZoom={10} scrollWheelZoom={false}>
      <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" />
      <FitReplay boundaries={boundaries} selected={selected} />
      {boundaries.flatMap(boundary => ringsOf(boundary).map((polygon, index) => {
        const ward = byCode.get(boundary.code);
        const active = selected === boundary.code;
        return <Polygon key={`${boundary.code}-${index}`} positions={polygon} pathOptions={{ color: active ? '#fff1b7' : '#e8f4ed', weight: active ? 3 : 1, fillColor: wardColor(ward, maxOpen), fillOpacity: ward ? .68 : .32 }} eventHandlers={{ click: () => onSelect(boundary.code) }}>
          <Tooltip>{wardLabel(boundary.code, language)} · {ward ? `${ward.open} ${language === 'bn' ? 'চলমান' : 'open'}` : (language === 'bn' ? 'প্রকাশের জন্য পর্যাপ্ত তথ্য নেই' : 'Not enough data to show')}</Tooltip>
        </Polygon>;
      }))}
    </MapContainer>
  </div>;
}

export default function CivicReplay({ onBack }: { onBack?: () => void }) {
  const { language } = useLocale();
  const [corporation, setCorporation] = useState<'DNCC' | 'DSCC'>('DNCC');
  const months = useMemo(() => monthsThrough(currentDhakaMonth()), []);
  const [monthIndex, setMonthIndex] = useState(months.length - 1);
  const [selected, setSelected] = useState('');
  const [playing, setPlaying] = useState(false);
  const [frame, setFrame] = useState<ReplayFrame | null>(null);
  const [boundaries, setBoundaries] = useState<WardBoundary[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const cache = useRef(new Map<string, ReplayFrame>());
  const month = months[monthIndex];
  const dateLabel = (value: string) => new Intl.DateTimeFormat(language === 'bn' ? 'bn-BD' : 'en-GB', { month: 'long', year: 'numeric', timeZone: 'Asia/Dhaka' }).format(new Date(`${value}-15T12:00:00+06:00`));
  useEffect(() => {
    let active = true;
    setBoundaries([]);
    void fetch(new URL(`ward-boundaries/${corporation.toLowerCase()}.json`, document.baseURI)).then(async response => {
      if (!response.ok) throw new Error('Ward outlines could not be loaded.');
      const rows = await response.json() as WardBoundary[];
      if (active) setBoundaries(rows);
    }).catch(failure => { if (active) setError(String(failure)); });
    return () => { active = false; };
  }, [corporation]);
  useEffect(() => {
    let active = true;
    const key = `${corporation}:${month}`;
    const cached = cache.current.get(key);
    if (cached) { setFrame(cached); setLoading(false); setError(''); return; }
    setFrame(null); setLoading(true); setError('');
    const timer = window.setTimeout(() => {
      void request<ReplayFrame>('publicReplay', { corporation, month }).then(result => {
        cache.current.set(key, result);
        if (active) setFrame(result);
      }).catch(failure => { if (active) { setError(String(failure instanceof Error ? failure.message : failure)); setPlaying(false); } })
        .finally(() => { if (active) setLoading(false); });
    }, 120);
    return () => { active = false; window.clearTimeout(timer); };
  }, [corporation, month]);
  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => setMonthIndex(previous => {
      if (previous >= months.length - 1) { setPlaying(false); return previous; }
      return previous + 1;
    }), 1500);
    return () => window.clearInterval(timer);
  }, [playing, months.length]);
  useEffect(() => {
    const pauseHidden = () => { if (document.hidden) setPlaying(false); };
    document.addEventListener('visibilitychange', pauseHidden);
    return () => document.removeEventListener('visibilitychange', pauseHidden);
  }, []);
  const changeCorporation = (value: 'DNCC' | 'DSCC') => { setPlaying(false); setCorporation(value); setSelected(''); };
  const wards = frame?.wards || [];
  const selectedWard = wards.find(ward => ward.code === selected);
  const totals = wards.reduce((sum, ward) => ({ reported: sum.reported + ward.reported, newReports: sum.newReports + ward.newReports, open: sum.open + ward.open, confirmed: sum.confirmed + ward.confirmed }), { reported: 0, newReports: 0, open: 0, confirmed: 0 });
  const busiest = [...wards].sort((a, b) => b.open - a.open || b.newReports - a.newReports).slice(0, 6);
  return <section className="replay-page" aria-label={language === 'bn' ? 'সিভিকপালস রিপ্লে' : 'CivicPulse Replay'}>
    <div className="replay-hero"><div>{onBack && <button type="button" className="replay-back" onClick={onBack}><ArrowLeft size={16} /> {language === 'bn' ? 'ফিরে যান' : 'Back to sign in'}</button>}<span className="eyebrow">{language === 'bn' ? 'ঢাকার পরিবর্তনের মানচিত্র' : 'DHAKA OVER TIME'}</span><h1>CivicPulse Replay</h1><p>{language === 'bn' ? 'মাস বদলে দেখুন কোন ওয়ার্ডে সমস্যা এসেছে, কতগুলো চলমান, আর কতগুলো নাগরিক নিশ্চিত করেছেন।' : 'Move through the months to see where reports appeared, what remains open, and what citizens confirmed as resolved.'}</p></div><div className="replay-hero-icon"><CalendarDays size={30} /></div></div>
    <div className="card replay-controls"><div className="replay-cities"><button type="button" className={corporation === 'DNCC' ? 'active' : ''} aria-pressed={corporation === 'DNCC'} onClick={() => changeCorporation('DNCC')}>{language === 'bn' ? 'ঢাকা উত্তর' : 'Dhaka North'}</button><button type="button" className={corporation === 'DSCC' ? 'active' : ''} aria-pressed={corporation === 'DSCC'} onClick={() => changeCorporation('DSCC')}>{language === 'bn' ? 'ঢাকা দক্ষিণ' : 'Dhaka South'}</button></div><div className="replay-time"><button type="button" className="secondary" onClick={() => { if (monthIndex === months.length - 1) setMonthIndex(0); setPlaying(value => !value); }} aria-label={playing ? (language === 'bn' ? 'থামান' : 'Pause replay') : (language === 'bn' ? 'চালান' : 'Play replay')}>{playing ? <Pause size={16} /> : <Play size={16} />}{playing ? (language === 'bn' ? 'থামান' : 'Pause') : (language === 'bn' ? 'চালান' : 'Play')}</button><label htmlFor="replay-month">{language === 'bn' ? 'মাস বাছুন' : 'Choose a month'} <strong>{dateLabel(month)}</strong></label><input id="replay-month" type="range" min="0" max={months.length - 1} value={monthIndex} onChange={event => { setPlaying(false); setMonthIndex(Number(event.target.value)); }} aria-valuetext={dateLabel(month)} /><div className="replay-range"><span>{dateLabel(months[0])}</span><span>{dateLabel(months.at(-1)!)}</span></div></div></div>
    {error && <p className="replay-error" role="alert">{error}</p>}
    <p className="replay-status" role="status" aria-live="polite">{loading ? (language === 'bn' ? 'মাসের তথ্য আনা হচ্ছে…' : 'Loading month…') : `${dateLabel(month)} · ${corporation === 'DNCC' ? (language === 'bn' ? 'ঢাকা উত্তর' : 'Dhaka North') : (language === 'bn' ? 'ঢাকা দক্ষিণ' : 'Dhaka South')}`}</p>
    <div className="replay-stats"><article><span>{language === 'bn' ? 'এই মাসে নতুন' : 'New this month'}</span><strong>{totals.newReports}</strong></article><article><span>{language === 'bn' ? 'এখনো চলমান' : 'Still open'}</span><strong>{totals.open}</strong></article><article><span>{language === 'bn' ? 'নাগরিক নিশ্চিত করেছেন' : 'Citizen confirmed'}</span><strong>{totals.confirmed}</strong></article><article><span>{language === 'bn' ? 'দেখানো ওয়ার্ড' : 'Wards shown'}</span><strong>{wards.length}</strong></article></div>
    <div className="replay-layout"><div className="card replay-map-card"><div className="replay-map-title"><h2>{language === 'bn' ? 'ওয়ার্ডের অগ্রগতি' : 'Ward progress'}</h2><div className="replay-legend"><span><i className="quiet" />{language === 'bn' ? 'তথ্য কম' : 'Limited data'}</span><span><i className="clear" />{language === 'bn' ? 'চলমান নেই' : 'No open cases'}</span><span><i className="busy" />{language === 'bn' ? 'বেশি চলমান' : 'More open'}</span></div></div>{boundaries.length ? <ReplayMap key={corporation} boundaries={boundaries} frame={frame} selected={selected} onSelect={setSelected} /> : <div className="replay-map-loading">{language === 'bn' ? 'মানচিত্র লোড হচ্ছে…' : 'Loading ward map…'}</div>}</div>
      <aside className="card replay-detail"><label className="replay-ward-select">{language === 'bn' ? 'ওয়ার্ড বাছুন' : 'Choose a ward'}<select value={selected} onChange={event => setSelected(event.target.value)}><option value="">{language === 'bn' ? 'মানচিত্রে সব ওয়ার্ড' : 'All wards on map'}</option>{boundaries.map(boundary => <option key={boundary.code} value={boundary.code}>{wardLabel(boundary.code, language)}</option>)}</select></label><span className="eyebrow">{selected ? wardLabel(selected, language) : (language === 'bn' ? 'ওয়ার্ড বাছুন' : 'SELECT A WARD')}</span><h2>{selected ? (selectedWard ? (language === 'bn' ? 'ওয়ার্ডের চিত্র' : 'Ward snapshot') : (language === 'bn' ? 'পর্যাপ্ত তথ্য নেই' : 'Limited public data')) : (language === 'bn' ? 'মানচিত্রে বা উপরে একটি ওয়ার্ড বাছুন' : 'Select a ward on the map or above')}</h2>{selectedWard ? <div className="replay-ward-numbers"><div><strong>{selectedWard.reported}</strong><span>{language === 'bn' ? 'মোট অভিযোগ' : 'Reported to date'}</span></div><div><strong>{selectedWard.newReports}</strong><span>{language === 'bn' ? 'এই মাসে নতুন' : 'New this month'}</span></div><div><strong>{selectedWard.open}</strong><span>{language === 'bn' ? 'চলমান' : 'Still open'}</span></div><div><strong>{selectedWard.confirmed}</strong><span>{language === 'bn' ? 'নাগরিক নিশ্চিত' : 'Citizen confirmed'}</span></div><div><strong>{selectedWard.overdue ?? '—'}</strong><span>{selectedWard.overdue === null ? (language === 'bn' ? 'অতীতের সময়সীমা নেই' : 'Historical deadline unavailable') : (language === 'bn' ? 'এখন সময়সীমা পেরিয়েছে' : 'Overdue now')}</span></div><div><strong>{selectedWard.averageRating === null ? '—' : `${selectedWard.averageRating} ★`}</strong><span>{language === 'bn' ? 'নাগরিক রেটিং (কমপক্ষে ৫টি)' : 'Citizen rating (5+ reviews)'}</span></div></div> : <p>{language === 'bn' ? 'গোপনীয়তার জন্য পাঁচটির কম অভিযোগ থাকা ওয়ার্ডের সংখ্যা দেখানো হয় না।' : 'To protect privacy, wards with fewer than five reports do not display counts.'}</p>}<div className="replay-list"><h3>{language === 'bn' ? 'এই মাসে বেশি চলমান' : 'Most open cases this month'}</h3>{busiest.length ? busiest.map(ward => <button type="button" key={ward.code} className={selected === ward.code ? 'active' : ''} onClick={() => setSelected(ward.code)}><span>{wardLabel(ward.code, language)}</span><strong>{ward.open}</strong></button>) : <p>{language === 'bn' ? 'এই মাসে দেখানোর মতো যথেষ্ট তথ্য নেই।' : 'Not enough public data for this month yet.'}</p>}</div></aside></div>
    <p className="replay-method">{language === 'bn' ? 'এই মানচিত্রে শুধু ওয়ার্ডভিত্তিক সংখ্যা আছে। পাঁচটির কম অভিযোগ থাকা ওয়ার্ড বাদ দেওয়া হয়। দেখানো মোট সংখ্যা শুধু প্রকাশযোগ্য ওয়ার্ডের; এটি সারা শহরের মোট নয়। অতীতের অবস্থা নথিভুক্ত পরিবর্তনের ভিত্তিতে হিসাব করা হয়। মানচিত্রের সীমানা রেফারেন্স, সরকারি ভূমি জরিপ নয়।' : 'This map shows ward totals only. Wards with fewer than five reports are hidden; the displayed totals cover visible wards, not the whole city. Past status is reconstructed from recorded case updates. Ward outlines are reference guides, not an official land survey.'}</p>
  </section>;
}
