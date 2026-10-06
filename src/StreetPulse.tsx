import { useCallback, useEffect, useMemo, useState } from 'react';
import { Circle, MapContainer, TileLayer, Tooltip, useMap } from 'react-leaflet';
import { ArrowLeft, LocateFixed, RefreshCw } from 'lucide-react';
import { request } from './api';
import { useLocale } from './i18n';
import { wardLabel } from './wards';
import type { Role, StreetAlert } from './types';

const labels: Record<string, [string, string]> = {
  Flooding: ['Flooding', 'জলাবদ্ধতা'], 'Broken streetlight': ['Broken streetlight', 'বিকল সড়কবাতি'],
  'Blocked walkway': ['Blocked walkway', 'বন্ধ ফুটপাত'], 'Road damage': ['Road damage', 'রাস্তার ক্ষতি'],
  'Waste obstruction': ['Waste obstruction', 'বর্জ্য জমে পথ বন্ধ'], 'Other public hazard': ['Other public hazard', 'অন্যান্য জনদুর্ভোগ']
};
const kmBetween = (a: [number, number], b: [number, number]) => {
  const rad = Math.PI / 180;
  const x = Math.sin((b[0] - a[0]) * rad / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin((b[1] - a[1]) * rad / 2) ** 2;
  return 12742 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
};
function Focus({ alert }: { alert: StreetAlert | undefined }) {
  const map = useMap();
  useEffect(() => { if (alert) map.flyTo([alert.latitude, alert.longitude], 15, { duration: .5 }); }, [alert?.id, map]);
  return null;
}
export default function StreetPulse({ role, onBack }: { role?: Role; onBack?: () => void }) {
  const { language } = useLocale();
  const bn = language === 'bn';
  const [corporation, setCorporation] = useState<'DNCC' | 'DSCC'>('DNCC');
  const [alerts, setAlerts] = useState<StreetAlert[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [near, setNear] = useState<[number, number] | null>(null);
  const [nearOnly, setNearOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const load = useCallback(async () => {
    try { const result = await request<StreetAlert[]>('publicStreetPulse', { corporation }); setAlerts(result); setError(''); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setLoading(false); }
  }, [corporation]);
  useEffect(() => { setLoading(true); void load(); const timer = window.setInterval(() => void load(), 60000); return () => window.clearInterval(timer); }, [load]);
  const visible = useMemo(() => nearOnly && near ? alerts.filter(alert => kmBetween(near, [alert.latitude, alert.longitude]) <= 2.25) : alerts, [alerts, near, nearOnly]);
  const chosen = visible.find(alert => alert.id === selected);
  const locate = () => {
    if (!navigator.geolocation) { setError(bn ? 'এই ডিভাইসে অবস্থান পাওয়া যায়নি।' : 'Location is unavailable on this device.'); return; }
    navigator.geolocation.getCurrentPosition(position => {
      setNear([position.coords.latitude, position.coords.longitude]); setNearOnly(true); setError('');
    }, () => setError(bn ? 'অবস্থান পাওয়া যায়নি। ব্রাউজারের অনুমতি দেখুন।' : 'Could not read your location. Check browser permission.'), { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 });
  };
  const vote = async (id: number, choice: 'still' | 'clear') => {
    setBusy(true);
    try { await request('streetAlertVote', { id, choice }); setNotice(bn ? 'আপনার তথ্য যুক্ত হয়েছে।' : 'Thanks. Your update was recorded.'); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  };
  return <section className="street-page" aria-label="StreetPulse">
    <div className="replay-hero"><div>{onBack && <button type="button" className="replay-back" onClick={onBack}><ArrowLeft size={16} /> {bn ? 'সাইন ইনে ফিরুন' : 'Back to sign in'}</button>}<span className="eyebrow">{bn ? 'এলাকার চলমান সতর্কতা' : 'NEIGHBORHOOD AWARENESS'}</span><h1>StreetPulse</h1><p>{bn ? 'পর্যালোচিত নাগরিক অভিযোগ থেকে প্রকাশিত সাম্প্রতিক সমস্যা দেখুন। চিহ্নিত বৃত্ত আনুমানিক এলাকা; সঠিক অবস্থান বা নিরাপদ চলার পথ বোঝায় না।' : 'See recent hazards published from reviewed reports. Each circle is an approximate area, never an exact pin or a safe route.'}</p></div><div className="replay-hero-icon"><LocateFixed size={30} /></div></div>
    <div className="card street-controls"><div className="replay-cities"><button type="button" className={corporation === 'DNCC' ? 'active' : ''} aria-pressed={corporation === 'DNCC'} onClick={() => { setCorporation('DNCC'); setSelected(null); }}>{bn ? 'ঢাকা উত্তর' : 'Dhaka North'}</button><button type="button" className={corporation === 'DSCC' ? 'active' : ''} aria-pressed={corporation === 'DSCC'} onClick={() => { setCorporation('DSCC'); setSelected(null); }}>{bn ? 'ঢাকা দক্ষিণ' : 'Dhaka South'}</button></div><div className="street-controls-right"><button type="button" className="secondary" onClick={locate}><LocateFixed size={16} /> {bn ? 'আমার কাছাকাছি ২ কিমি' : 'Within 2 km of me'}</button>{nearOnly && <button type="button" className="secondary" onClick={() => setNearOnly(false)}>{bn ? 'সব দেখুন' : 'Show all'}</button>}<button type="button" className="secondary" onClick={() => void load()}><RefreshCw size={16} /> {bn ? 'নতুন তথ্য' : 'Refresh'}</button></div></div>
    {error && <p role="alert" className="replay-error">{error}</p>}{notice && <p role="status" className="street-notice">{notice}</p>}
    <p className="replay-status" role="status">{loading ? (bn ? 'সতর্কতা আনা হচ্ছে…' : 'Loading alerts…') : `${visible.length} ${bn ? 'টি চলমান সতর্কতা' : 'current alerts'}`}{nearOnly && (bn ? ' · আপনার কাছাকাছি' : ' · near you')}</p>
    <div className="street-layout"><div className="card street-map-card"><MapContainer center={[23.785, 90.405]} zoom={11} minZoom={10} scrollWheelZoom={false} className="street-map"><TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" /><Focus alert={chosen} />{visible.map(alert => <Circle key={alert.id} center={[alert.latitude, alert.longitude]} radius={alert.radius_metres} pathOptions={{ color: selected === alert.id ? '#fff1a6' : '#f5a966', weight: selected === alert.id ? 3 : 2, fillColor: '#e77958', fillOpacity: .3 }} eventHandlers={{ click: () => setSelected(alert.id) }}><Tooltip>{labels[alert.hazard_type]?.[bn ? 1 : 0] || alert.hazard_type} · {wardLabel(alert.ward_code, language)}</Tooltip></Circle>)}</MapContainer></div><aside className="card street-list"><h2>{bn ? 'প্রকাশিত সমস্যা' : 'Published hazards'}</h2>{visible.length ? visible.map(alert => <article className={selected === alert.id ? 'street-alert selected' : 'street-alert'} key={alert.id}><button type="button" className="street-select" onClick={() => setSelected(alert.id)}><strong>{labels[alert.hazard_type]?.[bn ? 1 : 0] || alert.hazard_type}</strong><span>{wardLabel(alert.ward_code, language)}</span><small>{bn ? 'প্রকাশিত' : 'Published'} {new Date(alert.created_at.replace(' ', 'T') + 'Z').toLocaleString(bn ? 'bn-BD' : 'en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</small></button><div className="street-alert-meta"><span>{bn ? 'এখনও আছে' : 'Still there'} {alert.still_count}</span><span>{bn ? 'সরে গেছে বলে মত' : 'Looks clear'} {alert.clear_count}</span></div>{role === 'citizen' && <div className="street-votes"><button type="button" disabled={busy} onClick={() => void vote(alert.id, 'still')}>{bn ? 'এখনও আছে' : 'Still there'}</button><button type="button" disabled={busy} onClick={() => void vote(alert.id, 'clear')}>{bn ? 'সরে গেছে' : 'Looks clear'}</button></div>}</article>) : <p className="muted">{bn ? 'এখন এই এলাকায় কোনো প্রকাশিত সতর্কতা নেই।' : 'No published alerts in this view right now.'}</p>}</aside></div>
    <p className="replay-method">{bn ? 'কর্মীরা যাচাই করা চলমান অভিযোগ থেকে সতর্কতা প্রকাশ করেন। নাগরিকের পরিচয়, মূল অভিযোগ, ছবি ও সঠিক পিন এখানে নেই। সতর্কতা ৪৮ ঘণ্টা পর শেষ হয়; দুইজন স্বতন্ত্র নাগরিকের সাম্প্রতিক নিশ্চিতকরণে তা কিছুটা বাড়তে পারে। বিপদের জন্য জরুরি সেবার বিকল্প নয়।' : 'Staff publish from reviewed active cases. Reporter details, complaint text, photos and exact pins are never shown here. Alerts expire after 48 hours; two separate recent resident confirmations can extend them briefly. This view is not an emergency service.'}</p>
  </section>;
}
