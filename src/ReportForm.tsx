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
import { loadReferenceBoundaries, suggestReferenceWard } from './wardReference';

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
  const [wardConfirmed, setWardConfirmed] = useState(false);
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
  const [step, setStep] = useState<0 | 1 | 2 | 3>(0);
  const [formError, setFormError] = useState<{ field: string; message: string } | null>(null);

  useEffect(() => { if (lowData) setShowMap(false); }, [lowData]);
  useEffect(() => {
    if (!point) { setSuggestion(null); return; }
    let active = true;
    const timer = window.setTimeout(() => { void request<WardSuggestion>('wardSuggestion', point).then(result => {
      if (result.confidence === 'unmapped') return suggestReferenceWard(point).catch(() => result);
      return result;
    }).catch(() => suggestReferenceWard(point)).then(result => {
      if (!active) return;
      setSuggestion(result);
      if (result.code && result.confidence === 'inside' && !wardTouched) setWardCode(result.code);
    }).catch(() => { if (active) setSuggestion(null); }); }, 300);
    return () => { active = false; window.clearTimeout(timer); };
  }, [point?.latitude, point?.longitude, wardTouched]);
  useEffect(() => {
    if (!showMap || !wardCode) { setBoundaries([]); return; }
    let active = true;
    const corporation = wardCode.slice(0, 4) as 'DNCC' | 'DSCC';
    void loadReferenceBoundaries(corporation).then(async base => {
      if (!active) return;
      setBoundaries(base);
      try {
        const imported = await request<WardBoundary[]>('wardBoundaryMap', { corporation });
        if (active && imported.length) {
          const overrides = new Map(imported.map(item => [item.code, item]));
          setBoundaries(base.map(item => overrides.get(item.code) || item));
        }
      } catch { /* Reference outlines remain visible. */ }
    }).catch(() => { if (active) setBoundaries([]); });
    return () => { active = false; };
  }, [showMap, wardCode.slice(0, 4)]);

  useEffect(() => {
    if (startPoint || !navigator.geolocation) return;
    let active = true;
    navigator.geolocation.getCurrentPosition(({ coords }) => {
      if (!active) return;
      const next = { latitude: coords.latitude, longitude: coords.longitude };
      if (!inDhakaMap(next)) return;
      setPoint(next); setWardConfirmed(false); setLatitudeText(next.latitude.toFixed(6)); setLongitudeText(next.longitude.toFixed(6));
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
    setWardConfirmed(false);
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
    setWardCode(userWard); setWardTouched(false); setWardConfirmed(false); setPlaceName(''); setPoint(null); setLatitudeText(''); setLongitudeText(''); setImage(null); setDraftStored(false); setDraftFailed(false); setStep(0); setFormError(null);
  };
  const validateStep = (stage: 0 | 1 | 2 | 3) => {
    if (stage === 0) {
      if (title.trim().length < 6) return { field: 'title', message: language === 'bn' ? 'শিরোনাম কমপক্ষে ৬ অক্ষরের লিখুন।' : 'Enter a title of at least 6 characters.' };
      if (description.trim().length < 12) return { field: 'description', message: language === 'bn' ? 'বিবরণ কমপক্ষে ১২ অক্ষরের লিখুন।' : 'Describe the issue in at least 12 characters.' };
      if (!data.categories.some(item => item.id === categoryId && item.active)) return { field: 'category', message: language === 'bn' ? 'সমস্যার ধরন বাছুন।' : 'Choose an issue category.' };
    }
    if (stage === 1) {
      if (!point) return { field: 'latitude', message: language === 'bn' ? 'ঢাকার সেবা এলাকার ভেতরে একটি স্থান বাছুন।' : 'Choose a point inside the Dhaka service area.' };
      if (placeName.trim().length < 3) return { field: 'place', message: language === 'bn' ? 'স্থান বা পরিচিত চিহ্ন কমপক্ষে ৩ অক্ষরে লিখুন।' : 'Enter a place or landmark of at least 3 characters.' };
      if (!wardOptions.some(item => item.code === wardCode)) return { field: 'ward', message: language === 'bn' ? 'সঠিক ওয়ার্ড বাছুন।' : 'Choose the correct ward.' };
      if (!wardConfirmed) return { field: 'ward-confirm', message: language === 'bn' ? 'অভিযোগের স্থান ও ওয়ার্ড মিলিয়ে নিশ্চিত করুন।' : 'Check the issue location and confirm its ward.' };
    }
    return null;
  };
  const revealError = (issue: { field: string; message: string }, stage: 0 | 1) => {
    setStep(stage); setFormError(issue);
    requestAnimationFrame(() => document.getElementById('report-' + issue.field)?.focus());
  };
  const nextStep = () => {
    const issue = validateStep(step);
    if (issue && step < 2) return revealError(issue, step as 0 | 1);
    setFormError(null); setStep(value => (value + 1) as 0 | 1 | 2 | 3);
  };
  const errorFor = (field: string) => formError?.field === field ? <span className="field-error" role="alert">{formError.message}</span> : null;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (step !== 3) return nextStep();
    for (const stage of [0, 1] as const) {
      const issue = validateStep(stage);
      if (issue) return revealError(issue, stage);
    }
    if (!online) return showError(t('Offline — your draft is saved. Submit when connected.'));
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
    <div className="report-layout"><form className="card report-form" noValidate onSubmit={submit}>
      <nav className="report-steps" aria-label={language === 'bn' ? 'অভিযোগের ধাপ' : 'Report steps'}>{[['Issue','সমস্যা'],['Location','অবস্থান'],['Photo','ছবি'],['Review','যাচাই']].map(([en,bn],index) => <button key={en} type="button" disabled={index > step} aria-current={index === step ? 'step' : undefined} className={index === step ? 'active' : ''} onClick={() => { setStep(index as 0 | 1 | 2 | 3); setFormError(null); if (index < 3) setTurnstileToken(''); }}><span>{index + 1}</span>{language === 'bn' ? bn : en}</button>)}</nav>
      <div className="draft-bar" role="status" aria-live="polite"><span>{draftFailed ? (language === 'bn' ? 'এই ডিভাইসে খসড়া সংরক্ষণ করা যায়নি। অন্য ব্রাউজার বা ডিভাইসের জায়গা ব্যবহার করুন।' : 'Could not save on this device. Free storage or use another browser.') : !online && draftStored ? t('Offline — your draft is saved. Submit when connected.') : !online ? (language === 'bn' ? 'ইন্টারনেট নেই। খসড়া এখনো সংরক্ষিত হয়নি; এই পাতা খোলা রাখুন।' : 'Offline. Draft not saved yet; keep this page open.') : draftStored ? t('Draft saved on this device') : (language === 'bn' ? 'লিখতে শুরু করলে খসড়া সংরক্ষিত হবে' : 'Your draft saves as you type')}</span><div><button type="button" className="secondary" onClick={saveNow}>{t('Save draft')}</button><button type="button" className="secondary danger" onClick={discard}>{t('Delete draft')}</button></div></div>
      {image && <p className="method-note">{language === 'bn' ? 'ডিভাইসের জায়গা কম থাকলে ছবিটি আবার বাছতে হতে পারে; লেখা ও পিন সংরক্ষিত থাকবে।' : 'If device storage is full, you may need to choose the photo again; your text and pin will remain saved.'}</p>}
      {step === 0 && <>
      <div className="form-intro"><span className="step">01</span><div><h3>{t('Tell us what happened')}</h3><p>{language === 'bn' ? 'সঠিক তথ্য দায়িত্বপ্রাপ্ত দলকে দ্রুত ব্যবস্থা নিতে সাহায্য করে।' : 'A clear report helps the right team respond quickly.'}</p></div></div>
      <div className="form-grid">
        <label className="wide">{t('Issue title')}<input id="report-title" aria-invalid={formError?.field === 'title'} value={title} onChange={event => setTitle(event.target.value)} minLength={6} maxLength={120} required />{errorFor('title')}</label>
        <label className="wide">{t('Description')}<textarea id="report-description" aria-invalid={formError?.field === 'description'} value={description} onChange={event => setDescription(event.target.value)} minLength={12} rows={4} required />{errorFor('description')}</label>
        <label>{t('Category')}<select id="report-category" aria-invalid={formError?.field === 'category'} value={categoryId} onChange={event => setCategoryId(Number(event.target.value))} required><option value={0}>{t('Choose category')}</option>{data.categories.filter(item => item.active).map(item => <option key={item.id} value={item.id}>{t(item.name)}</option>)}</select>{errorFor('category')}</label>
        <label>{t('Severity')}<select value={severity} onChange={event => setSeverity(event.target.value)}>{['Low','Medium','High','Critical'].map(value => <option value={value} key={value}>{t(value)}</option>)}</select></label>
      </div>
      {categoryId > 0 && <p className="target-preview">{language === 'bn' ? 'এই ধরনের অভিযোগের লক্ষ্য সময়' : 'Closure target for this category'}: {data.categories.find(item => item.id === categoryId)?.resolution_hours || 168} {language === 'bn' ? 'ঘণ্টা' : 'hours'}.</p>}
      </>}
      {step === 1 && <>
      <div className="form-intro"><span className="step">02</span><div><h3>{t('Pin the exact location')}</h3><p>{t('Choose on map or enter coordinates using a keyboard.')}</p></div></div>
      <div className="form-grid"><label className="wide">{t('Your ward')}<select id="report-ward" aria-invalid={formError?.field === 'ward'} value={wardCode} onChange={event => { setWardCode(event.target.value); setWardTouched(true); setWardConfirmed(false); }} required><option value="">{t('Choose ward')}</option>{['DNCC','DSCC'].map(corporation => <optgroup key={corporation} label={corporation === 'DNCC' ? t('Dhaka North') : t('Dhaka South')}>{wardOptions.filter(item => item.corporation === corporation).map(item => <option key={item.code} value={item.code}>{wardLabel(item.code, language)}</option>)}</optgroup>)}</select>{errorFor('ward')}</label>
        <label className="wide ward-confirm"><input id="report-ward-confirm" type="checkbox" aria-invalid={formError?.field === 'ward-confirm'} checked={wardConfirmed} onChange={event => setWardConfirmed(event.target.checked)} />{language === 'bn' ? 'আমি অভিযোগের স্থান ও এই ওয়ার্ড মিলিয়ে দেখেছি।' : 'I checked the issue location and confirm this ward.'}{errorFor('ward-confirm')}</label></div>
      <p className="method-note" role="status">{suggestion?.code ? <>{suggestion.source === 'CivicPulse reference ward outlines' ? (language === 'bn' ? 'রেফারেন্স মানচিত্র অনুযায়ী সম্ভাব্য ওয়ার্ড' : 'Suggested from the reference map') : (language === 'bn' ? 'অনুমোদিত মানচিত্র অনুযায়ী সম্ভাব্য ওয়ার্ড' : 'Suggested from the approved ward map')}: <strong>{wardLabel(suggestion.code, language)}</strong>. {suggestion.confidence === 'boundary' ? (language === 'bn' ? 'সীমানার কাছে; সিটি কর্পোরেশনের তথ্য মিলিয়ে নিশ্চিত করুন।' : 'Near a ward boundary; confirm using city corporation guidance.') : (language === 'bn' ? 'জমা দেওয়ার আগে নিশ্চিত করুন।' : 'Confirm before submitting.')}{wardCode !== suggestion.code && <button type="button" className="text-button" onClick={() => { setWardCode(suggestion.code!); setWardTouched(true); setWardConfirmed(false); }}>{language === 'bn' ? 'এই ওয়ার্ড বাছুন' : 'Use this ward'}</button>}</> : (language === 'bn' ? 'মানচিত্রে ওয়ার্ড নির্ধারণ করা যায়নি। সঠিক ওয়ার্ড নিজে বেছে নিশ্চিত করুন।' : 'The map could not identify this ward. Choose and confirm the correct ward manually.')}</p>
      <div className="ward-guide-links"><a href="/ward-guides/dncc-areas.txt" target="_blank" rel="noreferrer">{language === 'bn' ? 'ঢাকা উত্তরের ওয়ার্ড ও এলাকা দেখুন' : 'North ward and area guide'}</a><a href="/ward-guides/dncc-administrative-map-2018.pdf" target="_blank" rel="noreferrer">{language === 'bn' ? 'উত্তরের ২০১৮ সালের ওয়ার্ড মানচিত্র' : 'North ward map (2018)'}</a><a href="https://www.citypopulation.de/en/bangladesh/dhakanorthcity/admin/" target="_blank" rel="noreferrer">{language === 'bn' ? 'উত্তরের ২০২২ সালের ওয়ার্ড তালিকা ↗' : 'North 2022 ward directory ↗'}</a><a href="/ward-guides/dscc-areas.pdf" target="_blank" rel="noreferrer">{language === 'bn' ? 'ঢাকা দক্ষিণের ওয়ার্ড ও এলাকা দেখুন' : 'South ward and area guide'}</a><a href="https://www.citypopulation.de/en/bangladesh/dhakasouthcity/admin/" target="_blank" rel="noreferrer">{language === 'bn' ? 'দক্ষিণের ২০২২ সালের ওয়ার্ড তালিকা ↗' : 'South 2022 ward directory ↗'}</a></div>
      <p className="method-note">{language === 'bn' ? 'এই তালিকাগুলো পুরোনো হতে পারে। সীমান্তবর্তী জায়গায় সিটি কর্পোরেশনের বর্তমান তথ্য মিলিয়ে নিন।' : 'These source lists may be dated. Check current city corporation guidance for boundary locations.'}</p>
      {locationNotice && <p className="method-note" role="status">{locationNotice}</p>}

      {showMap ? <LocationPicker value={point} onPick={(latitude, longitude) => setCoordinates(latitude.toFixed(6), longitude.toFixed(6))} boundaries={boundaries} /> : <div className="card map-off"><MapPin size={22} /><p>{language === 'bn' ? 'ডাটা সাশ্রয়ের জন্য মানচিত্র বন্ধ আছে। GPS বা নিচের স্থানাঙ্ক ব্যবহার করুন।' : 'The map is paused to save data. Use GPS or the coordinate fields below.'}</p><button type="button" className="secondary" onClick={() => setShowMap(true)}>{language === 'bn' ? 'মানচিত্র চালু করুন' : 'Load map'}</button></div>}
      <div className="form-grid"><label className="wide">{t('Exact place name or nearby landmark')}<input id="report-place" aria-invalid={formError?.field === 'place'} value={placeName} onChange={event => setPlaceName(event.target.value)} minLength={3} maxLength={150} required />{errorFor('place')}</label></div>
      <div className="form-grid coordinate-inputs"><label>{t('Latitude')}<input id="report-latitude" aria-invalid={formError?.field === 'latitude'} type="number" inputMode="decimal" step="any" min="23.65" max="23.94" value={latitudeText} onChange={event => setCoordinates(event.target.value, longitudeText)} />{errorFor('latitude')}</label><label>{t('Longitude')}<input type="number" inputMode="decimal" step="any" min="90.30" max="90.54" value={longitudeText} onChange={event => setCoordinates(latitudeText, event.target.value)} /></label></div>
      <p className="coordinate" role="status">{point ? `${point.latitude.toFixed(6)}, ${point.longitude.toFixed(6)}` : (language === 'bn' ? 'ঢাকার সেবা এলাকার ভেতরে একটি স্থান বাছুন।' : 'Choose a point inside the Dhaka service area.')}</p>
      {nearby.length > 0 && <div className="duplicate-warning"><strong>{language === 'bn' ? 'কাছাকাছি অনুরূপ অভিযোগ' : 'Similar reports nearby'}</strong>{nearby.map(item => <div key={item.id}>{item.code} · {item.title} · {item.distance} m · {t(item.status)}</div>)}</div>}
      </>}
      {step === 2 && <>
      <div className="form-intro middle"><span className="step">03</span><div><h3>{t('Add evidence')}</h3><p>{language === 'bn' ? 'একটি ছবি সমস্যা শনাক্ত করতে সাহায্য করে।' : 'One photo helps the team identify the issue.'}</p></div></div>
      <label className="upload-box"><Upload size={22} /><strong>{image ? t('Photo attached') : t('Choose a photo')}</strong><small>PNG, JPEG or WebP · 8 MB</small><input type="file" accept="image/png,image/jpeg,image/webp" onChange={async event => { try { setImage(event.target.files?.[0] ? await readImage(event.target.files[0]) : null); } catch (error) { showError(String(error)); } }} /></label>
      {image && <img className="preview-image" src={image} alt={language === 'bn' ? 'অভিযোগের ছবির প্রাকদর্শন' : 'Complaint evidence preview'} />}
      <p className="muted">{language === 'bn' ? 'ছবি দেওয়া ঐচ্ছিক। ব্যক্তিগত তথ্য দেখা যায় এমন ছবি দেবেন না।' : 'A photo is optional. Avoid images with personal information.'}</p>
      </>}
      {step === 3 && <section className="report-review"><div className="form-intro"><span className="step">04</span><div><h3>{language === 'bn' ? 'জমা দেওয়ার আগে যাচাই করুন' : 'Check your report before sending'}</h3><p>{language === 'bn' ? 'ভুল থাকলে সংশ্লিষ্ট ধাপে ফিরে তথ্য ঠিক করুন।' : 'Go back to the relevant step to correct anything.'}</p></div></div>
        <dl className="review-list"><div><dt>{t('Issue title')}</dt><dd>{title}</dd></div><div><dt>{t('Description')}</dt><dd>{description}</dd></div><div><dt>{t('Category')} · {t('Severity')}</dt><dd>{t(data.categories.find(item => item.id === categoryId)?.name || '')} · {t(severity)}</dd></div><div><dt>{t('Your ward')}</dt><dd>{wardLabel(wardCode, language)}</dd></div><div><dt>{t('Exact place name or nearby landmark')}</dt><dd>{placeName}</dd></div><div><dt>{language === 'bn' ? 'মানচিত্রের পিন' : 'Map pin'}</dt><dd>{point ? point.latitude.toFixed(6) + ', ' + point.longitude.toFixed(6) : '—'}</dd></div><div><dt>{language === 'bn' ? 'ছবি' : 'Photo'}</dt><dd>{image ? (language === 'bn' ? 'যোগ করা হয়েছে' : 'Attached') : (language === 'bn' ? 'ছবি দেওয়া হয়নি' : 'No photo')}</dd></div></dl>
        <div className="review-edit"><button type="button" className="secondary" onClick={() => setStep(0)}>{language === 'bn' ? 'সমস্যার তথ্য ঠিক করুন' : 'Edit issue'}</button><button type="button" className="secondary" onClick={() => setStep(1)}>{language === 'bn' ? 'অবস্থান ঠিক করুন' : 'Edit location'}</button><button type="button" className="secondary" onClick={() => setStep(2)}>{language === 'bn' ? 'ছবি ঠিক করুন' : 'Edit photo'}</button></div>
        <p className="method-note">{language === 'bn' ? 'জমা দিলে শুধু আপনি ও দায়িত্বপ্রাপ্ত দল অভিযোগের বিস্তারিত দেখতে পারবেন।' : 'After submission, only you and the responsible team can see the report details.'}</p>
        {turnstileSiteKey && <TurnstileChallenge key={challengeVersion} siteKey={turnstileSiteKey} onToken={setTurnstileToken} />}
      </section>}
      <div className="report-wizard-actions">{step > 0 && <button type="button" className="secondary" onClick={() => { setStep(value => (value - 1) as 0 | 1 | 2 | 3); setFormError(null); setTurnstileToken(''); }}>{language === 'bn' ? 'আগের ধাপ' : 'Back'}</button>}{step < 3 ? <button type="button" className="primary" onClick={event => { event.preventDefault(); nextStep(); }}>{language === 'bn' ? 'পরের ধাপ' : 'Continue'} <ArrowRight size={17} /></button> : <button type="submit" className="primary submit-report" disabled={busy || !online || (!!turnstileSiteKey && !turnstileToken)}>{busy ? t('Submitting…') : t('Submit complaint')} <ArrowRight size={18} /></button>}</div>
    </form><aside className="report-aside"><div className="card aside-card"><div className="aside-icon"><ShieldCheck size={23} /></div><h3>{language === 'bn' ? 'এরপর কী হবে?' : 'What happens next?'}</h3><div className="mini-timeline"><span>1</span><p>{language === 'bn' ? 'প্রশাসক অভিযোগটি যাচাই করবেন।' : 'An administrator verifies your report.'}</p><span>2</span><p>{language === 'bn' ? 'সংশ্লিষ্ট বিভাগ দায়িত্ব পাবে।' : 'The responsible department receives it.'}</p><span>3</span><p>{language === 'bn' ? 'অগ্রগতি দেখুন এবং সম্পন্ন কাজ যাচাই করুন।' : 'Follow updates and review completed work.'}</p></div></div><div className="aside-tip"><MapPin size={19} /><p>{language === 'bn' ? 'আপনার অভিযোগ অন্য নাগরিক দেখতে পাবেন না। শিরোনাম ও ছবিতে ব্যক্তিগত তথ্য দেবেন না।' : 'Other citizens cannot see your report. Avoid personal details in the title and photos.'}</p></div></aside></div>
  </>;
}
