import { useEffect, useState } from 'react';
import { MapPin } from 'lucide-react';
import { request } from './api';
import { useLocale } from './i18n';
import { wardLabel, wardOptions } from './wards';
import type { Snapshot } from './types';

type Issue = { id: number; code: string; title: string; status: string; area: string; ward_code: string | null; category: string; distance: number };

export default function NearbyIssues({ onOpen, refreshKey }: { onOpen: (id: number) => void; refreshKey: Snapshot }) {
  const { language, t } = useLocale();
  const [position, setPosition] = useState<{ latitude: number; longitude: number } | null>(null);
  const [ward, setWard] = useState('');
  const [issues, setIssues] = useState<Issue[]>([]);
  const [status, setStatus] = useState('Waiting for location permission…');
  const locate = () => {
    if (!navigator.geolocation) { setStatus('Location is unavailable on this device.'); return; }
    setStatus('Finding location…');
    navigator.geolocation.getCurrentPosition(({ coords }) => {
      setPosition({ latitude: coords.latitude, longitude: coords.longitude });
      setStatus('');
    }, () => setStatus('Location access was declined. Allow it in your device settings to see nearby issues.'),
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 120000 });
  };
  useEffect(() => { locate(); }, []);
  useEffect(() => {
    if (!position) return;
    let active = true;
    void request<Issue[]>('nearbyIssues', { ...position, wardCode: ward }).then(rows => {
      if (active) { setIssues(rows); setStatus(''); }
    }).catch(error => { if (active) { setIssues([]); setStatus(String(error instanceof Error ? error.message : error)); } });
    return () => { active = false; };
  }, [position, ward, refreshKey]);
  return <section className="card nearby-issues"><div className="nearby-heading"><div><span className="eyebrow">{t('LIVE LOCATION')}</span><h2>{t('Problems within 2 km')}</h2></div><button type="button" className="secondary" onClick={locate}><MapPin size={16} /> {t('Update location')}</button></div>
    <p className="muted">{t('Your position is used for this search and is not saved. Choose a ward to narrow the list.')}</p>
    <label>{t('Ward filter')}<select value={ward} onChange={event => setWard(event.target.value)}><option value="">{t('All nearby wards')}</option>{wardOptions.map(item => <option key={item.code} value={item.code}>{wardLabel(item.code, language)}</option>)}</select></label>
    {status && <p role="status">{t(status)}</p>}
    {position && !status && (issues.length ? <div className="nearby-list">{issues.map(issue => <button type="button" key={issue.id} onClick={() => onOpen(issue.id)}><strong>{issue.title}</strong><small>{issue.code} · {issue.ward_code ? wardLabel(issue.ward_code, language) : issue.area} · {t(issue.category)} · {t(issue.status)}</small><span>{issue.distance} {t('metres away')}</span></button>)}</div> : <p className="muted">{t('No visible issues within 2 km for this ward.')}</p>)}
  </section>;
}
