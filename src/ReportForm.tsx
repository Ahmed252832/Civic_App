import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { ArrowRight, MapPin, ShieldCheck, Upload } from 'lucide-react';
import { request } from './api';
import { clearDraft, readDraft, saveDraft, type ReportDraft } from './draft';
import { readImage } from './image';
import { useLocale } from './i18n';
import { inDhakaMap, LocationPicker, type MapPoint } from './MapViews';
import { TurnstileChallenge } from './Turnstile';
import type { Snapshot, WardBoundary, WardSuggestion } from './types';
import { wardLabel, wardOptions } from './wards';

type Props = {
  data: Snapshot; onCreated: (id: number) => void; showError: (message: string) => void;
  turnstileSiteKey: string | null; initialLocation: (MapPoint & { placeName: string }) | null; lowData: boolean;
};

export default function ReportForm({ data, onCreated, showError, turnstileSiteKey, initialLocation, lowData }: Props) {
  const { language, t } = useLocale();
  const saved = useMemo(() => readDraft(data.user.id), [data.user.id]);
  const userWard = wardOptions.find(item => wardLabel(item.code) === data.user.area)?.code || '';
  const startPoint = initialLocation || (saved?.latitude != null && saved?.longitude != null
    ? { latitude: saved.latitude, longitude: saved.longitude } : null);
  const [title, setTitle] = useState(saved?.title || '');
  const [description, setDescription] = useState(saved?.description || '');
  const [categoryId, setCategoryId] = useState(saved?.categoryId || 0);
  const [severity, setSeverity] = useState(saved?.severity || 'Medium');
  const [wardCode, setWardCode] = useState(saved?.wardCode || userWard);
  const [wardTouched, setWardTouched] = useState(Boolean(saved?.wardCode));
  const [suggestion, setSuggestion] = useState<WardSuggestion | null>(null);
  const [boundaries, setBoundaries] = useState<WardBoundary[]>([]);
  const [showMap, setShowMap] = useState(!lowData);
  const [placeName, setPlaceName] = useState(initialLocation?.placeName || saved?.placeName || '');
  const [point, setPoint] = useState<MapPoint | null>(startPoint);
  const [latitudeText, setLatitudeText] = useState(startPoint?.latitude.toFixed(6) || '');
  const [longitudeText, setLongitudeText] = useState(startPoint?.longitude.toFixed(6) || '');
  const [image, setImage] = useState<string | null>(saved?.image || null);
  const [nearby, setNearby] = useState<Array<{ id: number; code: string; title: string; status: string; distance: number }>>([]);
  const [busy, setBusy] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const [draftStored, setDraftStored] = useState(Boolean(saved));
  const [draftFailed, setDraftFailed] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState('');
  const [challengeVersion, setChallengeVersion] = useState(0);
  const [locationNotice, setLocationNotice] = useState('');

  useEffect(() => { if (lowData) setShowMap(false); }, [lowData]);
  useEffect(() => {
    if (!point) { setSuggestion(null); return; }
    let active = true;
    const timer = window.setTimeout(() => { void request<WardSuggestion>('wardSuggestion', point).then(result => {
      if (!active) return;
      setSuggestion(result);
      if (result.code && result.confidence === 'inside' && !wardTouched) setWardCode(result.code);
    }).catch(() => { if (active) setSuggestion(null); }); }, 300);
    return () => { active = false; window.clearTimeout(timer); };
  }, [point?.latitude, point?.longitude, wardTouched]);
  useEffect(() => {
    if (!showMap || !wardCode) { setBoundaries([]); return; }
    let active = true;
    void request<WardBoundary[]>('wardBoundaryMap', { corporation: wardCode.slice(0, 4) }).then(rows => { if (active) setBoundaries(rows); }).catch(() => { if (active) setBoundaries([]); });
    return () => { active = false; };
  }, [showMap, wardCode.slice(0, 4)]);

  useEffect(() => {
    if (startPoint || !navigator.geolocation) return;
    let active = true;
    navigator.geolocation.getCurrentPosition(({ coords }) => {
      if (!active) return;
      const next = { latitude: coords.latitude, longitude: coords.longitude };
      if (!inDhakaMap(next)) return;
      setPoint(next); setLatitudeText(next.latitude.toFixed(6)); setLongitudeText(next.longitude.toFixed(6));
      setLocationNotice(language === 'bn' ? 'আপনার বর্তমান অবস্থান পিন করা হয়েছে। অভিযোগের স্থান ও ওয়ার্ড যাচাই করুন।' : 'Your current location was pinned. Check the issue location and ward before submitting.');
    }, () => {}, { enableHighAccuracy: true, timeout: 12000, maximumAge: 120000 });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update); window.addEventListener('offline', update);
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update); };
  }, []);
  useEffect(() => {
    const hasContent = Boolean(title || description || categoryId || placeName || point || image);
    if (!hasContent) { clearDraft(data.user.id); setDraftStored(false); setDraftFailed(false); return; }
    const timer = window.setTimeout(() => {
      const draft: ReportDraft = { title, description, categoryId, severity, wardCode, placeName,
        latitude: point?.latitude ?? null, longitude: point?.longitude ?? null, image, savedAt: Date.now() };
      const stored = saveDraft(data.user.id, draft);
      setDraftStored(stored); setDraftFailed(!stored);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [data.user.id, title, description, categoryId, severity, wardCode, placeName, point, image]);
  useEffect(() => {
    if (point && categoryId) void request<typeof nearby>('nearby', { ...point, categoryId }).then(setNearby).catch(() => setNearby([]));
    else setNearby([]);
  }, [point, categoryId]);

  const setCoordinates = (latitude: string, longitude: string) => {
    setLatitudeText(latitude); setLongitudeText(longitude);
    const next = { latitude: Number(latitude), longitude: Number(longitude) };
    setPoint(latitude.trim() && longitude.trim() && Number.isFinite(next.latitude) && Number.isFinite(next.longitude) && inDhakaMap(next) ? next : null);
  };
  const saveNow = () => {
    const draft: ReportDraft = { title, description, categoryId, severity, wardCode, placeName,
      latitude: point?.latitude ?? null, longitude: point?.longitude ?? null, image, savedAt: Date.now() };
    const stored = saveDraft(data.user.id, draft);
    setDraftStored(stored); setDraftFailed(!stored);
  };
  const discard = () => {
    clearDraft(data.user.id); setTitle(''); setDescription(''); setCategoryId(0); setSeverity('Medium');
    setWardCode(userWard); setWardTouched(false); setPlaceName(''); setPoint(null); setLatitudeText(''); setLongitudeText(''); setImage(null); setDraftStored(false); setDraftFailed(false);
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!online) return showError(t('Offline — your draft is saved. Submit when connected.'));
    if (!point) return showError(language === 'bn' ? 'ঢাকার ভেতরে একটি অবস্থান বাছুন।' : 'Choose a point inside Dhaka.');
    if (!wardCode) return showError(t('Choose ward'));
    setBusy(true);
    try {
      const id = await request<number>('create', { title, description, categoryId, severity,
        wardCode, area: wardLabel(wardCode), placeName, ...point, image, turnstileToken });
      clearDraft(data.user.id);
      onCreated(id);
    } catch (error) { showError(String(error instanceof Error ? error.message : error)); }
    finally { setBusy(false); setTurnstileToken(''); setChallengeVersion(version => version + 1); }
  };

  return <>
    <div className="section-heading"><div><span className="eyebrow">{language === 'bn' ? 'আপনার এলাকা উন্নত করুন' : 'HELP YOUR NEIGHBORHOOD'}</span><h2>{t('Report an issue')}</h2></div></div>
    <div className="report-layout"><form className="card report-form" onSubmit={submit}>
      <div className="draft-bar" role="status" aria-live="polite"><span>{draftFailed ? (language === 'bn' ? 'এই ডিভাইসে খসড়া সংরক্ষণ করা যায়নি। অন্য ব্রাউজার বা ডিভাইসের জায়গা ব্যবহার করুন।' : 'Could not save on this device. Free storage or use another browser.') : !online && draftStored ? t('Offline — your draft is saved. Submit when connected.') : !online ? (language === 'bn' ? 'ইন্টারনেট নেই। খসড়া এখনো সংরক্ষিত হয়নি; এই পাতা খোলা রাখুন।' : 'Offline. Draft not saved yet; keep this page open.') : draftStored ? t('Draft saved on this device') : (language === 'bn' ? 'লিখতে শুরু করলে খসড়া সংরক্ষিত হবে' : 'Your draft saves as you type')}</span><div><button type="button" className="secondary" onClick={saveNow}>{t('Save draft')}</button><button type="button" className="secondary danger" onClick={discard}>{t('Delete draft')}</button></div></div>
      {image && <p className="method-note">{language === 'bn' ? 'ডিভাইসের জায়গা কম থাকলে ছবিটি আবার বাছতে হতে পারে; লেখা ও পিন সংরক্ষিত থাকবে।' : 'If device storage is full, you may need to choose the photo again; your text and pin will remain saved.'}</p>}
      <div className="form-intro"><span className="step">01</span><div><h3>{t('Tell us what happened')}</h3><p>{language === 'bn' ? 'সঠিক তথ্য দায়িত্বপ্রাপ্ত দলকে দ্রুত ব্যবস্থা নিতে সাহায্য করে।' : 'A clear report helps the right team respond quickly.'}</p></div></div>
      <div className="form-grid">
        <label className="wide">{t('Issue title')}<input value={title} onChange={event => setTitle(event.target.value)} minLength={6} maxLength={120} required /></label>
        <label className="wide">{t('Description')}<textarea value={description} onChange={event => setDescription(event.target.value)} minLength={12} rows={4} required /></label>
        <label>{t('Category')}<select value={categoryId} onChange={event => setCategoryId(Number(event.target.value))} required><option value={0}>{t('Choose category')}</option>{data.categories.filter(item => item.active).map(item => <option key={item.id} value={item.id}>{t(item.name)}</option>)}</select></label>
        <label>{t('Severity')}<select value={severity} onChange={event => setSeverity(event.target.value)}>{['Low','Medium','High','Critical'].map(value => <option value={value} key={value}>{t(value)}</option>)}</select></label>
        <label className="wide">{t('Your ward')}<select value={wardCode} onChange={event => { setWardCode(event.target.value); setWardTouched(true); }} required><option value="">{t('Choose ward')}</option>{['DNCC','DSCC'].map(corporation => <optgroup key={corporation} label={corporation === 'DNCC' ? t('Dhaka North') : t('Dhaka South')}>{wardOptions.filter(item => item.corporation === corporation).map(item => <option key={item.code} value={item.code}>{wardLabel(item.code, language)}</option>)}</optgroup>)}</select></label>
      </div>
      <p className="method-note">{suggestion?.code ? <>{language === 'bn' ? 'মানচিত্রের সীমানা অনুযায়ী সম্ভাব্য ওয়ার্ড' : 'Suggested from the imported ward map'}: <strong>{wardLabel(suggestion.code, language)}</strong>. {suggestion.confidence === 'boundary' ? (language === 'bn' ? 'সীমানার কাছে; সিটি কর্পোরেশনের তথ্য মিলিয়ে নিশ্চিত করুন।' : 'Near a ward boundary; confirm using city corporation guidance.') : (language === 'bn' ? 'জমা দেওয়ার আগে নিশ্চিত করুন।' : 'Confirm before submitting.')}{wardCode !== suggestion.code && <button type="button" className="text-button" onClick={() => { setWardCode(suggestion.code!); setWardTouched(true); }}>{language === 'bn' ? 'এই ওয়ার্ড বাছুন' : 'Use this ward'}</button>}</> : (language === 'bn' ? 'যাচাইকৃত সীমানা না থাকলে অ্যাকাউন্টের ওয়ার্ড আগে বাছা থাকে। অভিযোগের সঠিক ওয়ার্ড নিশ্চিত করুন।' : 'Until approved boundary data is available, your account ward is preselected. Confirm the issue’s correct ward.')}</p>
      <div className="ward-guide-links"><a href="/ward-guides/dncc-areas.txt" target="_blank" rel="noreferrer">{language === 'bn' ? 'ঢাকা উত্তরের ওয়ার্ড ও এলাকা দেখুন' : 'North ward and area guide'}</a><a href="/ward-guides/dncc-administrative-map-2018.pdf" target="_blank" rel="noreferrer">{language === 'bn' ? 'উত্তরের ২০১৮ সালের ওয়ার্ড মানচিত্র' : 'North ward map (2018)'}</a><a href="https://www.citypopulation.de/en/bangladesh/dhakanorthcity/admin/" target="_blank" rel="noreferrer">{language === 'bn' ? 'উত্তরের ২০২২ সালের ওয়ার্ড তালিকা ↗' : 'North 2022 ward directory ↗'}</a><a href="/ward-guides/dscc-areas.pdf" target="_blank" rel="noreferrer">{language === 'bn' ? 'ঢাকা দক্ষিণের ওয়ার্ড ও এলাকা দেখুন' : 'South ward and area guide'}</a><a href="https://www.citypopulation.de/en/bangladesh/dhakasouthcity/admin/" target="_blank" rel="noreferrer">{language === 'bn' ? 'দক্ষিণের ২০২২ সালের ওয়ার্ড তালিকা ↗' : 'South 2022 ward directory ↗'}</a></div>
      <p className="method-note">{language === 'bn' ? 'এই তালিকাগুলো পুরোনো হতে পারে। সীমান্তবর্তী জায়গায় সিটি কর্পোরেশনের বর্তমান তথ্য মিলিয়ে নিন।' : 'These source lists may be dated. Check current city corporation guidance for boundary locations.'}</p>
      {locationNotice && <p className="method-note" role="status">{locationNotice}</p>}
      {categoryId > 0 && <p className="target-preview">{language === 'bn' ? 'এই ধরনের অভিযোগের লক্ষ্য সময়' : 'Closure target for this category'}: {data.categories.find(item => item.id === categoryId)?.resolution_hours || 168} {language === 'bn' ? 'ঘণ্টা' : 'hours'}.</p>}
      <div className="form-intro middle"><span className="step">02</span><div><h3>{t('Pin the exact location')}</h3><p>{t('Choose on map or enter coordinates using a keyboard.')}</p></div></div>
      {showMap ? <LocationPicker value={point} onPick={(latitude, longitude) => setCoordinates(latitude.toFixed(6), longitude.toFixed(6))} boundaries={boundaries} /> : <div className="card map-off"><MapPin size={22} /><p>{language === 'bn' ? 'ডাটা সাশ্রয়ের জন্য মানচিত্র বন্ধ আছে। GPS বা নিচের স্থানাঙ্ক ব্যবহার করুন।' : 'The map is paused to save data. Use GPS or the coordinate fields below.'}</p><button type="button" className="secondary" onClick={() => setShowMap(true)}>{language === 'bn' ? 'মানচিত্র চালু করুন' : 'Load map'}</button></div>}
      <div className="form-grid"><label className="wide">{t('Exact place name or nearby landmark')}<input value={placeName} onChange={event => setPlaceName(event.target.value)} minLength={3} maxLength={150} required /></label></div>
      <div className="form-grid coordinate-inputs"><label>{t('Latitude')}<input type="number" inputMode="decimal" step="any" min="23.68" max="23.92" value={latitudeText} onChange={event => setCoordinates(event.target.value, longitudeText)} /></label><label>{t('Longitude')}<input type="number" inputMode="decimal" step="any" min="90.30" max="90.53" value={longitudeText} onChange={event => setCoordinates(latitudeText, event.target.value)} /></label></div>
      <p className="coordinate" role="status">{point ? `${point.latitude.toFixed(6)}, ${point.longitude.toFixed(6)}` : (language === 'bn' ? 'ঢাকার সেবা এলাকার ভেতরে একটি স্থান বাছুন।' : 'Choose a point inside the Dhaka service area.')}</p>
      {nearby.length > 0 && <div className="duplicate-warning"><strong>{language === 'bn' ? 'কাছাকাছি অনুরূপ অভিযোগ' : 'Similar reports nearby'}</strong>{nearby.map(item => <div key={item.id}>{item.code} · {item.title} · {item.distance} m · {t(item.status)}</div>)}</div>}
      <div className="form-intro middle"><span className="step">03</span><div><h3>{t('Add evidence')}</h3><p>{language === 'bn' ? 'একটি ছবি সমস্যা শনাক্ত করতে সাহায্য করে।' : 'One photo helps the team identify the issue.'}</p></div></div>
      <label className="upload-box"><Upload size={22} /><strong>{image ? t('Photo attached') : t('Choose a photo')}</strong><small>PNG, JPEG or WebP · 8 MB</small><input type="file" accept="image/png,image/jpeg,image/webp" onChange={async event => { try { setImage(event.target.files?.[0] ? await readImage(event.target.files[0]) : null); } catch (error) { showError(String(error)); } }} /></label>
      {image && <img className="preview-image" src={image} alt={language === 'bn' ? 'অভিযোগের ছবির প্রাকদর্শন' : 'Complaint evidence preview'} />}
      {turnstileSiteKey && <TurnstileChallenge key={challengeVersion} siteKey={turnstileSiteKey} onToken={setTurnstileToken} />}
      <button className="primary submit-report" disabled={busy || !online || (!!turnstileSiteKey && !turnstileToken)}>{busy ? t('Submitting…') : t('Submit complaint')} <ArrowRight size={18} /></button>
    </form><aside className="report-aside"><div className="card aside-card"><div className="aside-icon"><ShieldCheck size={23} /></div><h3>{language === 'bn' ? 'এরপর কী হবে?' : 'What happens next?'}</h3><div className="mini-timeline"><span>1</span><p>{language === 'bn' ? 'প্রশাসক অভিযোগটি যাচাই করবেন।' : 'An administrator verifies your report.'}</p><span>2</span><p>{language === 'bn' ? 'সংশ্লিষ্ট বিভাগ দায়িত্ব পাবে।' : 'The responsible department receives it.'}</p><span>3</span><p>{language === 'bn' ? 'অগ্রগতি দেখুন এবং সম্পন্ন কাজ যাচাই করুন।' : 'Follow updates and review completed work.'}</p></div></div><div className="aside-tip"><MapPin size={19} /><p>{language === 'bn' ? 'আপনার অভিযোগ অন্য নাগরিক দেখতে পাবেন না। শিরোনাম ও ছবিতে ব্যক্তিগত তথ্য দেবেন না।' : 'Other citizens cannot see your report. Avoid personal details in the title and photos.'}</p></div></aside></div>
  </>;
}
