import { useEffect, useState } from 'react';
import { Activity, ArrowRight, Database, MapPin, ShieldCheck } from 'lucide-react';
import { request } from './api';
import { testRestoreEncryptedBackup } from './backup';
import { useLocale } from './i18n';
import type { OperationsHealth } from './types';

type Coverage = { corporation: string; count: number; imported_at: string; source: string };

export default function OwnerHealth({ emailEnabled, backupEnabled, onWork, onManage, showError }: { emailEnabled: boolean; backupEnabled: boolean; onWork: () => void; onManage: () => void; showError: (message: string) => void }) {
  const { language } = useLocale();
  const [health, setHealth] = useState<OperationsHealth | null>(null);
  const [coverage, setCoverage] = useState<Coverage[]>([]);
  const [corporation, setCorporation] = useState('DNCC');
  const [source, setSource] = useState('');
  const [geojsonFile, setGeojsonFile] = useState<File | null>(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [replace, setReplace] = useState(true);
  const [archiveFile, setArchiveFile] = useState<File | null>(null);
  const [passphrase, setPassphrase] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const load = async () => {
    const [nextHealth, nextCoverage] = await Promise.all([request<OperationsHealth>('operationsHealth'), request<Coverage[]>('wardBoundaryStatus')]);
    setHealth(nextHealth); setCoverage(nextCoverage);
  };
  useEffect(() => { void load().catch(error => showError(String(error))); }, []);
  const importBoundaries = async () => {
    if (!geojsonFile) return;
    setBusy(true); setStatus('');
    try {
      if (geojsonFile.size > 3_000_000) throw new Error('Simplify the GeoJSON to under 3 MB before uploading.');
      const geojson = JSON.parse(await geojsonFile.text());
      const result = await request<{ imported: number; total: number }>('importWardBoundaries', { corporation, source, geojson, password, confirm, replace });
      setPassword(''); setConfirm('');
      setStatus(language === 'bn' ? `${result.imported}টি ওয়ার্ড আমদানি হয়েছে; এখন ${result.total}টি সীমানা আছে।` : `Imported ${result.imported} wards; ${result.total} boundaries now available.`);
      await load();
    } catch (error) { showError(String(error instanceof Error ? error.message : error)); }
    finally { setBusy(false); }
  };
  const testRestore = async () => {
    if (!archiveFile) return;
    setBusy(true); setStatus('');
    try {
      const result = await testRestoreEncryptedBackup(archiveFile, passphrase);
      await request('recordRecoveryCheck', result);
      setPassphrase('');
      setStatus(language === 'bn' ? `ব্যাকআপ পুনরুদ্ধার পরীক্ষা সফল: ${result.accounts}টি অ্যাকাউন্ট, ${result.complaints}টি অভিযোগ। কোনো লাইভ তথ্য বদলায়নি।` : `Restore drill passed: ${result.accounts} accounts and ${result.complaints} complaints. Live data was unchanged.`);
      await load();
    } catch (error) { showError(String(error instanceof Error ? error.message : error)); }
    finally { setBusy(false); }
  };
  const formatDate = (value: string | null | undefined) => value ? new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`).toLocaleString(language === 'bn' ? 'bn-BD' : 'en-GB') : '—';
  return <><div className="section-heading"><div><span className="eyebrow">{language === 'bn' ? 'প্রধান প্রশাসক' : 'OWNER CONTROL'}</span><h2>{language === 'bn' ? 'সেবার স্বাস্থ্য ও পুনরুদ্ধার' : 'Service health & recovery'}</h2></div><button type="button" className="secondary" onClick={() => void load().catch(error => showError(String(error)))}>{language === 'bn' ? 'নতুন তথ্য' : 'Refresh health'}</button></div>
    <div className="stat-grid three"><button type="button" className="stat-card stat-card-link" onClick={onWork}><span className="stat-icon"><Activity size={19} /></span><strong className="stat-value">{health?.counts.unaccepted ?? '—'}</strong><span className="stat-label">{language === 'bn' ? 'কর্মী দায়িত্ব নেননি' : 'Unaccepted work'}</span></button><button type="button" className="stat-card stat-card-link" onClick={onWork}><span className="stat-icon"><ShieldCheck size={19} /></span><strong className="stat-value">{health?.counts.blocked ?? '—'}</strong><span className="stat-label">{language === 'bn' ? 'আটকে থাকা কাজ' : 'Blocked cases'}</span></button><button type="button" className="stat-card stat-card-link" onClick={onWork}><span className="stat-icon"><Activity size={19} /></span><strong className="stat-value">{health?.counts.overdue ?? '—'}</strong><span className="stat-label">{language === 'bn' ? 'সময়সীমা পেরিয়েছে' : 'Overdue cases'}</span></button></div>
    <div className="two-col"><section className="card health-card"><h3>{language === 'bn' ? 'কার্যক্রম' : 'Operations'}</h3><p>{language === 'bn' ? 'বিভাগ নির্ধারিত নয়' : 'No department assigned'}: <strong>{health?.counts.unassigned_department ?? '—'}</strong></p><p>{language === 'bn' ? 'গত ৭ দিনে সতর্কবার্তা পাঠাতে ব্যর্থ' : 'Alert delivery failures, 7 days'}: <strong>{health?.alertFailures ?? '—'}</strong></p><p>{language === 'bn' ? 'হোস্ট করা ডাটাবেসের আকার' : 'Hosted database size'}: <strong>{typeof health?.databaseBytes === 'number' ? `${(health.databaseBytes / 1024 / 1024).toFixed(1)} MB` : '—'}</strong></p><p>{language === 'bn' ? 'সংরক্ষিত ছবির আনুমানিক পরিমাণ' : 'Estimated stored image data'}: <strong>{health ? `${(health.mediaBytesEstimate / 1024 / 1024).toFixed(1)} MB` : '—'}</strong></p><p className="muted">{language === 'bn' ? 'ছবির হিসাবটি আনুমানিক; এতে সূচি ও অন্য তথ্য নেই।' : 'The image estimate excludes indexes and other text.'}</p><button type="button" className="secondary" onClick={onWork}>{language === 'bn' ? 'কাজের তালিকা খুলুন' : 'Open work queue'} <ArrowRight size={15} /></button></section>
      <section className="card health-card"><h3>{language === 'bn' ? 'অ্যাকাউন্ট ও ব্যাকআপ' : 'Accounts & backup'}</h3><p>{language === 'bn' ? 'ইমেইল যাচাই/পাসওয়ার্ড পুনরুদ্ধার' : 'Email verification & password reset'}: <strong>{emailEnabled ? (language === 'bn' ? 'সক্রিয়' : 'Enabled') : (language === 'bn' ? 'সেন্ডার নেই' : 'No sender configured')}</strong></p><p>{language === 'bn' ? 'স্বয়ংক্রিয় বাহিরের ব্যাকআপ' : 'Automatic offsite backup'}: <strong>{backupEnabled ? (language === 'bn' ? 'সক্রিয়' : 'Configured') : (language === 'bn' ? 'সক্রিয় নয়' : 'Not configured')}</strong></p><p>{language === 'bn' ? 'শেষ সফল বাহিরের ব্যাকআপ' : 'Last successful offsite backup'}: <strong>{formatDate(health?.lastOffsiteBackup?.created_at)}</strong></p><p>{language === 'bn' ? 'শেষ পুনরুদ্ধার পরীক্ষা' : 'Last restore drill'}: <strong>{formatDate(health?.lastRecoveryCheck?.created_at)}</strong></p><button type="button" className="secondary" onClick={onManage}>{language === 'bn' ? 'ব্যাকআপ তৈরি করুন' : 'Create a backup'} <ArrowRight size={15} /></button></section></div>
    <section className="card health-card"><h3><MapPin size={18} /> {language === 'bn' ? 'সরকারি ওয়ার্ড সীমানা' : 'Approved ward boundaries'}</h3><p className="muted">{language === 'bn' ? 'GeoJSON-এ প্রতিটি Feature-এর properties.ward_code যেমন DNCC-01 থাকতে হবে; স্থানাঙ্ক WGS84 longitude, latitude ক্রমে দিন। PDF বা এলাকার নামের তালিকা এখানে কাজ করে না।' : 'Upload WGS84 GeoJSON with properties.ward_code such as DNCC-01. Coordinates must be longitude, latitude. PDFs and area lists cannot supply GPS boundaries.'}</p><div className="coverage-grid">{['DNCC','DSCC'].map(code => <div key={code}><strong>{code}</strong><span>{coverage.find(row => row.corporation === code)?.count || 0} {language === 'bn' ? 'টি সীমানা' : 'boundaries'}</span><small>{coverage.find(row => row.corporation === code)?.source || (language === 'bn' ? 'উৎস নেই' : 'No source imported')}</small></div>)}</div>
      <div className="health-form"><label>{language === 'bn' ? 'সিটি কর্পোরেশন' : 'City corporation'}<select value={corporation} onChange={event => setCorporation(event.target.value)}><option value="DNCC">Dhaka North / ঢাকা উত্তর</option><option value="DSCC">Dhaka South / ঢাকা দক্ষিণ</option></select></label><label>{language === 'bn' ? 'অনুমোদিত উৎস ও তারিখ' : 'Approving source and date'}<input value={source} onChange={event => setSource(event.target.value)} maxLength={300} placeholder="e.g. DNCC GIS office, 2026-09-01" /></label><label>GeoJSON<input type="file" accept=".geojson,.json,application/geo+json,application/json" onChange={event => setGeojsonFile(event.target.files?.[0] || null)} /></label><label className="check-line"><input type="checkbox" checked={replace} onChange={event => setReplace(event.target.checked)} /> {language === 'bn' ? 'এই কর্পোরেশনের আগের সীমানা বদলান' : 'Replace previous boundaries for this corporation'}</label><label>{language === 'bn' ? 'আপনার পাসওয়ার্ড' : 'Your password'}<input type="password" value={password} onChange={event => setPassword(event.target.value)} /></label><label>{language === 'bn' ? 'অনুমোদন নিশ্চিত করতে APPROVED WARD MAP লিখুন' : 'Type APPROVED WARD MAP to confirm approval'}<input value={confirm} onChange={event => setConfirm(event.target.value)} /></label><button type="button" className="primary" disabled={busy || !geojsonFile || source.length < 12 || !password || confirm !== 'APPROVED WARD MAP'} onClick={() => void importBoundaries()}>{language === 'bn' ? 'ওয়ার্ড সীমানা আমদানি' : 'Import ward boundaries'}</button></div></section>
    <section className="card health-card"><h3><Database size={18} /> {language === 'bn' ? 'ব্যাকআপ পুনরুদ্ধার পরীক্ষা' : 'Backup restore drill'}</h3><p className="muted">{language === 'bn' ? 'এনক্রিপ্ট করা .cpbk ফাইলটি এই ডিভাইসের মেমরিতে অস্থায়ী SQLite ডাটাবেসে তথ্য বসিয়ে অখণ্ডতা ও সম্পর্ক যাচাই করে। লাইভ তথ্য বদলায় না। সম্পূর্ণ স্কিমা পরীক্ষা করতে README-এর restore script চালান।' : 'Decrypt a .cpbk file into a temporary SQLite database on this device, then check data integrity and relationships. Live records stay unchanged. Use the restore script in the README for a full schema restore.'}</p><div className="health-form"><label>.cpbk<input type="file" accept=".cpbk" onChange={event => setArchiveFile(event.target.files?.[0] || null)} /></label><label>{language === 'bn' ? 'ব্যাকআপ পাসফ্রেজ' : 'Backup passphrase'}<input type="password" value={passphrase} onChange={event => setPassphrase(event.target.value)} /></label><button type="button" className="primary" disabled={busy || !archiveFile || !passphrase} onClick={() => void testRestore()}>{language === 'bn' ? 'পুনরুদ্ধার পরীক্ষা চালান' : 'Run restore drill'}</button></div></section>
    {status && <p role="status" className="success-text">{status}</p>}
  </>;
}
