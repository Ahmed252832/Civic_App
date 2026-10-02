import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  Activity, ArrowRight, BarChart3, Bell, Check, ChevronDown, CircleHelp, ClipboardCheck,
  Download, FileText, Filter, Flag, LayoutDashboard, LogOut, Map as MapIcon, MapPin,
  MessageSquare, Plus, Search, Settings, ShieldCheck, Sparkles, Upload, Users, X
} from 'lucide-react';
import { onNotice, request } from './api';
import { downloadEncryptedBackup, verifyEncryptedBackup } from './backup';
import { disablePush, enablePush, pushAvailable } from './push';
import { TurnstileChallenge } from './Turnstile';
import { IssueMap, LocationPicker, inDhakaMap } from './MapViews';
import type { MapPoint } from './MapViews';
import { currentLanguage, localizeNotification, localizeStatus, useLocale } from './i18n';
import { wardLabel, wardOptions, isWard } from './wards';
import { readImage } from './image';
import Report from './ReportForm';
import NearbyIssues from './NearbyIssues';
import type { AreaSummary, Category, Complaint, ComplaintDetail, Department, Feedback, PageResult, Performance, PrivacyRequest, Snapshot, User } from './types';

type Page = 'dashboard' | 'complaints' | 'report' | 'notifications' | 'map' | 'feedback' | 'analytics' | 'performance' | 'manage' | 'profile';
const date = (value: string) => new Date(value.replace(' ', 'T') + (value.includes('Z') ? '' : 'Z')).toLocaleDateString(currentLanguage() === 'bn' ? 'bn-BD' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const utcTime = (value: string) => new Date(value.replace(' ', 'T') + (value.includes('Z') ? '' : 'Z'));
const dateTime = (value: string) => utcTime(value).toLocaleString(currentLanguage() === 'bn' ? 'bn-BD' : 'en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const closureState = (complaint: Complaint) => {
  const bangla = currentLanguage() === 'bn';
  if (!complaint.resolution_due_at || ['Rejected','Duplicate'].includes(complaint.status)) return null;
  if (['Closed','Citizen Verified','Finished'].includes(complaint.status)) return { label: complaint.closed_at && utcTime(complaint.closed_at) > utcTime(complaint.resolution_due_at) ? (bangla ? 'দেরিতে নিশ্চিত হয়েছে' : 'Confirmed late') : (bangla ? 'সময়ের মধ্যে নিশ্চিত হয়েছে' : 'Confirmed on time'), overdue: false };
  return Date.now() > utcTime(complaint.resolution_due_at).getTime()
    ? { label: `${bangla ? 'সময়সীমা পেরিয়েছে' : 'Closure overdue'} · ${dateTime(complaint.resolution_due_at)}`, overdue: true }
    : { label: `${bangla ? 'সমাধানের সময়সীমা' : 'Target closure'} · ${dateTime(complaint.resolution_due_at)}`, overdue: false };
};
const roleName: Record<string, string> = { citizen: 'Citizen', staff: 'Department staff', admin: 'Administrator', superadmin: 'Super administrator' };
const severityClass = (severity: string) => severity.toLowerCase().replaceAll(' ', '-');

function Badge({ value, type = 'status' }: { value: string; type?: 'status' | 'severity' }) {
  const { language } = useLocale();
  return <span className={`badge ${type}-${severityClass(value)}`}>{localizeStatus(value, language)}</span>;
}
function SectionHeading({ eyebrow, title, right }: { eyebrow: string; title: string; right?: ReactNode }) {
  const { t } = useLocale();
  return <div className="section-heading"><div><span className="eyebrow">{t(eyebrow)}</span><h2>{t(title)}</h2></div>{right}</div>;
}
function Empty({ title, text }: { title: string; text: string }) {
  const { t } = useLocale();
  return <div className="empty"><CircleHelp size={27} /><strong>{t(title)}</strong><p>{t(text)}</p></div>;
}
function StatCard({ icon, label, value, foot, tone = 'mint', onClick }: { icon: ReactNode; label: string; value: string | number; foot?: string; tone?: string; onClick?: () => void }) {
  const { t } = useLocale();
  const content = <><div className="stat-icon">{icon}</div><div className="stat-value">{value}</div><div className="stat-label">{t(label)}</div>{foot && <div className="stat-foot">{t(foot)}</div>}</>;
  return onClick ? <button type="button" className={`stat-card tone-${tone} stat-card-link`} onClick={onClick} aria-label={`${t(label)}: ${value}`}>{content}</button> : <div className={`stat-card tone-${tone}`}>{content}</div>;
}
function LanguageToggle({ signedIn = false }: { signedIn?: boolean }) {
  const { language, setLanguage } = useLocale();
  return <div className="language-toggle" role="group" aria-label="Language / ভাষা">
    {(['en','bn'] as const).map(value => <button key={value} type="button" aria-pressed={language === value} onClick={() => {
      setLanguage(value);
      if (signedIn) void request('setLanguage', { language: value }).catch(() => {});
    }}>{value === 'en' ? 'EN' : 'বাংলা'}</button>)}
  </div>;
}
function ComplaintList({ items, onOpen, compact = false }: { items: Complaint[]; onOpen: (id: number) => void; compact?: boolean }) {
  const { t, language } = useLocale();
  if (!items.length) return <Empty title={t('No issues here yet')} text={t('Reports will appear as soon as they are submitted.')} />;
  return <div className="complaint-list">{items.map(c => <button className="complaint-row" key={c.id} onClick={() => onOpen(c.id)}>
    <span className={`row-icon ${severityClass(c.severity)}`}><MapPin size={18} /></span>
    <span className="row-main"><strong>{c.title}</strong><small>{c.code} <span>·</span> {c.ward_code ? wardLabel(c.ward_code, language) : c.area} <span>·</span> {t(c.category)}</small><small className={closureState(c)?.overdue ? 'deadline-overdue' : 'deadline-muted'}>{closureState(c)?.label}{c.recurrence_flag && <> <span>·</span> {t('Possible recurring issue')}</>}</small></span>
    {!compact && <span className="row-date">{date(c.created_at)}</span>}
    <Badge value={c.status} /><ArrowRight size={16} className="row-arrow" />
  </button>)}</div>;
}
function Login({ onLogin, onRegister, onForgot, onRecoverCode, emailEnabled, turnstileSiteKey, busy, error }: { onLogin: (email: string, password: string, code: string) => Promise<void>; onRegister: (details: { name: string; email: string; area: string; password: string; turnstileToken?: string }) => Promise<void>; onForgot: (email: string) => Promise<boolean>; onRecoverCode: (code: string, password: string) => Promise<boolean>; emailEnabled: boolean; turnstileSiteKey: string | null; busy: boolean; error: string }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authenticatorCode, setAuthenticatorCode] = useState('');
  const [name, setName] = useState('');
  const [area, setArea] = useState('');
  const [corporation, setCorporation] = useState('');
  const { t, language } = useLocale();
  const [registering, setRegistering] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [recoverySent, setRecoverySent] = useState(false);
  const [usingCode, setUsingCode] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState('');
  const [recoveryPassword, setRecoveryPassword] = useState('');
  const [codeRecovered, setCodeRecovered] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState(''); const [challengeVersion, setChallengeVersion] = useState(0);
  if (usingCode) return <div className="setup-screen"><div className="setup-card"><div className="brand"><span className="brand-mark"><MapPin size={20} /></span><span>CivicPulse Dhaka</span></div><span className="eyebrow">{t('ACCOUNT RECOVERY')}</span><h1>{t('Use your recovery code')}</h1><p className="muted">{t('Enter the private code you saved from Account security. It can be used only once.')}</p>{codeRecovered ? <p role="status">{t('Password changed. Sign in with your new password.')}</p> : <form onSubmit={event => { event.preventDefault(); void onRecoverCode(recoveryCode.trim(), recoveryPassword).then(setCodeRecovered); }}><label>{t('Recovery code')}<input value={recoveryCode} onChange={event => setRecoveryCode(event.target.value)} required /></label><label>{t('New password')}<input type="password" value={recoveryPassword} onChange={event => setRecoveryPassword(event.target.value)} minLength={12} maxLength={128} required /></label>{error && <div className="error-box">{error}</div>}<button className="primary full" disabled={busy}>{busy ? 'Please wait…' : 'Reset password'}</button></form>}<button type="button" className="secondary" onClick={() => { setUsingCode(false); setRegistering(false); setRecovering(false); }}>{t('Back to sign in')}</button></div></div>;
  return <div className="login-screen"><div className="login-left"><div className="brand"><span className="brand-mark"><MapPin size={20} /></span><span>CivicPulse</span></div>
    <div className="login-art"><div className="orbit orbit-one" /><div className="orbit orbit-two" /><span className="art-pin pin-a"><MapPin /></span><span className="art-pin pin-b"><MapPin /></span><span className="art-pin pin-c"><MapPin /></span><span className="art-center"><Activity size={48} /></span></div>
    <div className="login-copy"><span className="eyebrow">{language === 'bn' ? 'ঢাকার সমস্যা দেখুন পরিষ্কারভাবে' : 'A clearer view of Dhaka'}</span><h1>{language === 'bn' ? 'প্রতিটি অভিযোগ ঢাকাকে এগিয়ে নেয়।' : 'Every report moves Dhaka forward.'}</h1><p>{language === 'bn' ? 'অভিযোগ জমা দেওয়া থেকে নাগরিকের নিশ্চিত করা সমাধান পর্যন্ত অগ্রগতি দেখুন।' : 'Follow Dhaka city issues from first report to community-verified resolution.'}</p></div>
    <div className="login-proof"><span><Check size={16} /> {t('Public issue map')}</span><span><Check size={16} /> {t('Traceable progress')}</span><span><Check size={16} /> {t('Community feedback')}</span></div>
  </div><div className="login-right"><div className="login-box"><LanguageToggle /><span className="eyebrow">{t('CIVIC ISSUE TRACKER')}</span><h2>{recovering ? t('Recover your account') : registering ? t('Join your community') : t('Welcome back')}</h2><p className="muted">{language === 'bn' ? (recovering ? 'পাসওয়ার্ড বদলানোর লিংক পেতে ইমেইল দিন।' : registering ? 'সমস্যা জানাতে এবং অগ্রগতি দেখতে নাগরিক অ্যাকাউন্ট খুলুন।' : 'সমস্যা জানাতে বা অভিযোগের অগ্রগতি দেখতে প্রবেশ করুন।') : (recovering ? 'Enter your email to request a password reset link.' : registering ? 'Create a citizen account to report issues and track progress.' : 'Sign in to report, manage, or review local issues.')}</p>
    <form onSubmit={e => { e.preventDefault(); if (recovering) void onForgot(email).then(setRecoverySent); else if (registering) void onRegister({ name, email, area: wardLabel(area), password, turnstileToken }).finally(() => { setTurnstileToken(''); setChallengeVersion(v => v + 1); }); else void onLogin(email,password,authenticatorCode); }}>
      {registering && <label>{t('Full name')}<input value={name} onChange={e => setName(e.target.value)} minLength={2} maxLength={80} required /></label>}
      <label>{t('Email address')}<input type="email" value={email} onChange={e => setEmail(e.target.value)} required /></label>
      {registering && <><label>{t('Choose city corporation')}<select value={corporation} onChange={e => { setCorporation(e.target.value); setArea(''); }} required><option value="">{t('Choose city corporation')}</option><option value="DNCC">{t('Dhaka North')}</option><option value="DSCC">{t('Dhaka South')}</option></select></label><label>{t('Your ward')}<select value={area} onChange={e => setArea(e.target.value)} required disabled={!corporation}><option value="">{t('Choose ward')}</option>{wardOptions.filter(item => item.corporation === corporation).map(item => <option key={item.code} value={item.code}>{wardLabel(item.code, language)}</option>)}</select></label><div className="ward-guide-links"><a href="/ward-guides/dncc-areas.txt" target="_blank" rel="noreferrer">{language === 'bn' ? 'ঢাকা উত্তরের এলাকা তালিকা' : 'North area guide'}</a><a href="/ward-guides/dscc-areas.pdf" target="_blank" rel="noreferrer">{language === 'bn' ? 'ঢাকা দক্ষিণের এলাকা তালিকা' : 'South area guide'}</a></div></>}
      {!recovering && <label>{t('Password')}<input type="password" value={password} onChange={e => setPassword(e.target.value)} minLength={registering ? 10 : undefined} required /></label>}
      {!recovering && !registering && (authenticatorCode || /authenticator code/i.test(error)) && <label>{t('Authenticator code')}<input value={authenticatorCode} onChange={e => setAuthenticatorCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required /></label>}
      {registering && <p className="muted">{language === 'bn' ? (emailEnabled ? 'অভিযোগ জমার আগে ইমেইলে পাঠানো যাচাই লিংক ব্যবহার করুন।' : 'ইমেইল যাচাই এখনো চালু হয়নি। নিজের ইমেইল ঠিকানা দিন।') : (emailEnabled ? 'We will email you a verification link. Verify before submitting a complaint.' : 'Email verification is not configured yet. Use an address you control.')}</p>}{registering && turnstileSiteKey && <TurnstileChallenge key={challengeVersion} siteKey={turnstileSiteKey} onToken={setTurnstileToken} />}{recoverySent && <p role="status">{t('If this account exists, a reset link is on its way.')}</p>}{error && <div className="error-box">{error}</div>}<button className="primary full" disabled={busy || (registering && !!turnstileSiteKey && !turnstileToken)}>{busy ? (language === 'bn' ? 'অপেক্ষা করুন…' : 'Please wait…') : recovering ? (language === 'bn' ? 'লিংক পাঠান' : 'Send reset link') : registering ? t('Create citizen account') : t('Sign in')} <ArrowRight size={17} /></button></form>
    <div className="login-links"><button type="button" onClick={() => { if (registering || recovering) { setRegistering(false); setRecovering(false); } else setRegistering(true); setPassword(''); }}>{registering || recovering ? t('Back to sign in') : t('New citizen? Create an account')}</button>{!registering && !recovering && emailEnabled && <button type="button" onClick={() => { setRecovering(true); setRecoverySent(false); }}>{t('Forgot password?')}</button>}{!registering && !recovering && <button type="button" onClick={() => setUsingCode(true)}>{t('Use recovery code')}</button>}</div>
    </div></div></div>;
}

function AccountLink({ purpose, token, onDone }: { purpose: 'verify' | 'reset'; token: string; onDone: () => void }) {
  const { t } = useLocale();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError('');
    try { await request(purpose === 'verify' ? 'verifyEmail' : 'resetPassword', { token, newPassword: password }); setDone(true); }
    catch (err) { setError(String(err instanceof Error ? err.message : err)); }
    finally { setBusy(false); }
  };
  return <div className="setup-screen"><div className="setup-card"><div className="brand"><span className="brand-mark"><MapPin size={20} /></span><span>CivicPulse Dhaka</span></div><span className="eyebrow">{t('ACCOUNT SECURITY')}</span><h1>{purpose === 'verify' ? 'Verify your email' : 'Reset your password'}</h1>{done ? <p role="status">{purpose === 'verify' ? 'Email verified. You can now submit reports.' : 'Password changed. Sign in with your new password.'}</p> : <form onSubmit={event => void submit(event)}>{purpose === 'reset' && <label>{t('New password')}<input type="password" value={password} onChange={event => setPassword(event.target.value)} minLength={12} maxLength={128} required /></label>}{error && <div className="error-box">{error}</div>}<button className="primary full" disabled={busy}>{busy ? 'Please wait…' : purpose === 'verify' ? 'Verify email' : 'Change password'}</button></form>}<button type="button" className="secondary" onClick={onDone}>{t('Continue to CivicPulse')}</button></div></div>;
}

function OwnerSetup({ onSetup, busy, error }: { onSetup: (details: { key: string; name: string; email: string; password: string }) => Promise<void>; busy: boolean; error: string }) {
  const { t } = useLocale();
  const [key, setKey] = useState(''); const [name, setName] = useState(''); const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  return <div className="setup-screen"><div className="setup-card"><div className="brand"><span className="brand-mark"><MapPin size={20} /></span><span>CivicPulse Dhaka</span></div><span className="eyebrow">{t('FIRST TIME SETUP')}</span><h1>{t('Set up the Dhaka workspace')}</h1><p className="muted">{t('The project owner creates the first administrator account. Keep the setup key private.')}</p><form onSubmit={e => { e.preventDefault(); void onSetup({ key, name, email, password }); }}><label>{t('Setup key')}<input type="password" value={key} onChange={e => setKey(e.target.value)} required /></label><label>{t('Your name')}<input value={name} onChange={e => setName(e.target.value)} minLength={3} required /></label><label>{t('Your email')}<input type="email" value={email} onChange={e => setEmail(e.target.value)} required /></label><label>{t('Password')}<input type="password" value={password} onChange={e => setPassword(e.target.value)} minLength={12} required /></label>{error && <div className="error-box">{error}</div>}<button className="primary full" disabled={busy}>{busy ? 'Setting up…' : 'Create owner account'} <ArrowRight size={17} /></button></form></div></div>;
}

function AreaOverview({ userId }: { userId: number }) {
  const { language, t } = useLocale();
  const [query, setQuery] = useState('');
  const [summary, setSummary] = useState<AreaSummary | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    let lastLoad = 0;
    const load = () => {
      if (document.visibilityState !== 'visible' || Date.now() - lastLoad < 60_000) return;
      lastLoad = Date.now();
      void request<AreaSummary>('areaSummary', { query }).then(result => { if (active) { setSummary(result); setError(''); } }).catch(() => { if (active) setError('Area totals could not be loaded.'); });
    };
    const initial = window.setTimeout(load, query ? 250 : 0);
    const timer = window.setInterval(load, 300000);
    const forceLoad = () => { lastLoad = 0; load(); };
    window.addEventListener('focus', load);
    window.addEventListener('civic:refresh', forceLoad);
    return () => { active = false; window.clearTimeout(initial); window.clearInterval(timer); window.removeEventListener('focus', load); window.removeEventListener('civic:refresh', forceLoad); };
  }, [query, userId]);
  return <section className="card area-overview"><SectionHeading eyebrow="ALL DHAKA REPORTS" title="Complaints by area" right={<span className="count-pill">{summary?.cityTotal ?? '—'} {t('citywide')}</span>} /><p className="muted">{t('Search an area to see its total across all citizens and statuses. Individual reports are not shown here.')}</p><div className="search-box"><Search size={18} /><input aria-label={t('Search an area')} placeholder={t('Search a Dhaka area, e.g. Dhanmondi')} value={query} onChange={event => setQuery(event.target.value)} maxLength={80} /></div>{error && <p role="status">{error}</p>}<div className="area-grid"><div className="area-total"><span>{query ? (language === 'bn' ? `“${query}” মিলে যাওয়া এলাকা` : `Matching “${query}”`) : t('All Dhaka areas')}</span><strong>{summary?.total ?? '—'}</strong></div></div>{summary && query && summary.total === 0 && <p className="muted">{t('No complaints found for this area.')}</p>}</section>;
}

function Dashboard({ data, onPage, onOpen, onWard, onFilter }: { data: Snapshot; onPage: (page: Page) => void; onOpen: (id: number) => void; onWard: (code: string) => void; onFilter: (scope: string) => void }) {
  const { user, complaints, summary } = data;
  const { language, t } = useLocale();
  const [allWards, setAllWards] = useState(false);
  const own = complaints.filter(c => c.reporter_id === user.id);
  const assigned = complaints.filter(c => c.department_id === user.departmentId);
  const relevant = user.role === 'citizen' ? own : user.role === 'staff' ? assigned : complaints;
  const [recent, setRecent] = useState(relevant.slice(0, 5));
  useEffect(() => {
    let cancelled = false;
    const scope = user.role === 'citizen' ? 'My reports' : user.role === 'staff' ? 'Assigned to my department' : 'All issues';
    void request<PageResult<Complaint>>('listComplaints', { scope, limit: 5 }).then(result => { if (!cancelled) setRecent(result.complaints); }).catch(() => {});
    return () => { cancelled = true; };
  }, [user.id, user.role, summary.counts.total]);
  const highlights = user.role === 'citizen' ? [
    ['My reports', summary.own.total, <FileText size={20} />, 'mint'], ['Open issues', summary.own.open || 0, <Activity size={20} />, 'amber'],
    ['Resolved', summary.own.resolved || 0, <Check size={20} />, 'blue'],
    ['Awaiting review', summary.counts.pending || 0, <MapPin size={20} />, 'violet']
  ] as const : [
    ['Total reports', user.role === 'staff' ? summary.assigned?.total || 0 : summary.counts.total, <FileText size={20} />, 'mint'],
    ['Open issues', user.role === 'staff' ? summary.assigned?.open || 0 : summary.counts.open || 0, <Activity size={20} />, 'amber'],
    [user.role === 'staff' ? 'Completed' : 'Needs verification', user.role === 'staff' ? summary.assigned?.resolved || 0 : summary.counts.pending || 0, <ClipboardCheck size={20} />, 'blue'],
    ['Critical alerts', summary.counts.critical || 0, <Flag size={20} />, 'rose']
  ] as const;
  const categoryCounts = summary.categories.map(row => ({ name: data.categories.find(cat => cat.id === row.id)?.name || 'Other', count: row.count })).slice(0, 5);
  return <><div className="hero"><div><span className="eyebrow"><Sparkles size={14} /> {language === 'bn' ? 'ঢাকার সেবার খবর এক জায়গায়' : 'DHAKA OPERATIONS, IN ONE PLACE'}</span><h1>{language === 'bn' ? `স্বাগতম, ${user.name.split(' ')[0]}।` : `Good ${new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 17 ? 'afternoon' : 'evening'}, ${user.name.split(' ')[0]}.`}</h1><p>{language === 'bn' ? (user.role === 'citizen' ? 'জমা দেওয়া থেকে সমাধান পর্যন্ত আপনার অভিযোগের অগ্রগতি দেখুন।' : user.role === 'staff' ? 'দায়িত্বপ্রাপ্ত কাজের অগ্রগতি দেখুন এবং নাগরিককে জানান।' : 'নতুন অভিযোগ দেখুন এবং কাজ এগিয়ে নিন।') : (user.role === 'citizen' ? 'Follow your own reports from submission through resolution.' : user.role === 'staff' ? 'Stay on top of assigned work and keep residents informed.' : 'Your Dhaka overview is ready. Review new reports and keep work moving.')}</p><div className="hero-actions"><button className="primary" onClick={() => onPage(user.role === 'citizen' ? 'report' : 'complaints')}>{user.role === 'citizen' ? <Plus size={18} /> : <ClipboardCheck size={18} />}{t(user.role === 'citizen' ? 'Report an issue' : 'Review complaints')}</button><button className="secondary" onClick={() => onPage('map')}><MapIcon size={18} /> {t(user.role === 'citizen' ? 'My report map' : 'Explore map')}</button></div></div><div className="hero-visual"><div className="visual-grid" /><span className="pulse-dot dot-one" /><span className="pulse-dot dot-two" /><span className="pulse-dot dot-three" /><div className="visual-label"><Activity size={17} /> {language === 'bn' ? 'ঢাকার চলমান তথ্য' : 'Live Dhaka signal'}</div></div></div>
  <div className="stat-grid">{highlights.map(([label,value,icon,tone]) => <StatCard key={label} label={label} value={value} icon={icon} tone={tone} onClick={() => onFilter(label)} />)}</div>
  {['admin','superadmin'].includes(user.role) && <div className="deadline-strip"><span><Flag size={17} /> <strong>{summary.counts.overdue_closure || 0}</strong> {language === 'bn' ? 'সময়সীমা পেরোনো অভিযোগ' : 'overdue closure targets'}</span><span><Activity size={17} /> <strong>{summary.counts.recurring || 0}</strong> {language === 'bn' ? 'সম্ভাব্য পুনরাবৃত্ত সমস্যা' : 'possible recurring issues'}</span>{user.role === 'superadmin' && <span><Check size={17} /> <strong>{summary.counts.citizen_verified || 0}</strong> {language === 'bn' ? 'সমাপ্ত করার অপেক্ষায়' : 'waiting for Finished work'}</span>}<button className="text-button" onClick={() => onPage('complaints')}>{language === 'bn' ? 'অভিযোগ দেখুন' : 'Review cases'} <ArrowRight size={15} /></button></div>}
  <AreaOverview userId={user.id} />
  {user.role !== 'citizen' && <NearbyIssues onOpen={onOpen} refreshKey={data} />}
  {user.role !== 'citizen' && <section className="card ward-workload"><SectionHeading eyebrow="DHAKA WARDS" title="Ward workload" /><p className="muted">{language === 'bn' ? 'ওয়ার্ডভিত্তিক অভিযোগের সংখ্যা দেখুন এবং সরাসরি সংশ্লিষ্ট তালিকা খুলুন। পুরোনো অভিযোগে ওয়ার্ড নাও থাকতে পারে।' : 'Open a ward queue to review its cases. Older reports may not have a ward.'}</p><div className="ward-grid">{data.wardSummary.filter(row => row.code).slice(0, allWards ? undefined : 12).map(row => <button type="button" key={row.code} onClick={() => onWard(row.code!)}><strong>{wardLabel(row.code, language)}</strong><span>{row.total} {t('Complaints')}</span><small>{row.open} {t('Open issues')} · {row.awaiting} {t('Waiting for verification')}</small><ArrowRight size={16} /></button>)}</div>{data.wardSummary.filter(row => row.code).length > 12 && <button type="button" className="secondary ward-expand" onClick={() => setAllWards(value => !value)}>{t(allWards ? 'Show fewer wards' : 'Show all wards')}</button>}{data.wardSummary.some(row => !row.code) && <p className="method-note">{language === 'bn' ? 'পুরোনো ওয়ার্ডবিহীন অভিযোগ:' : 'Legacy reports without a ward:'} {data.wardSummary.find(row => !row.code)?.total}</p>}</section>}
  <div className="two-col"><div className="card"><SectionHeading eyebrow="RECENT ACTIVITY" title={t(user.role === 'citizen' ? 'Your reports' : 'Latest complaints')} right={<button className="text-button" onClick={() => onPage('complaints')}>{t('View all')} <ArrowRight size={15} /></button>} /><ComplaintList items={recent} onOpen={onOpen} compact /></div>
  <div className="card"><SectionHeading eyebrow="DHAKA SNAPSHOT" title="Issues by category" right={<button className="text-button" onClick={() => onPage('analytics')}>{t('Explore')} <ArrowRight size={15} /></button>} /><div className="bar-list">{categoryCounts.map((item,i) => <div className="bar-row" key={item.name}><span>{t(item.name)}</span><div className="bar-track"><i style={{ width: `${Math.max(8,item.count/Math.max(1,categoryCounts[0].count)*100)}%`, background: ['#66dbc3','#82b7ff','#ffc883','#bca5ff','#ff9e9d'][i] }} /></div><strong>{item.count}</strong></div>)}</div><div className="insight-note"><MapPin size={17} /> {summary.counts.total} {t('reports visible to your role.')}</div></div></div></>;
}

function Complaints({ data, onOpen, initialWard, initialScope }: { data: Snapshot; onOpen: (id: number) => void; initialWard: string; initialScope: string }) {
  const { language, t } = useLocale();
  const [query, setQuery] = useState(''); const [status, setStatus] = useState('All statuses'); const [scope, setScope] = useState(initialScope || (data.user.role === 'citizen' ? 'My reports' : data.user.role === 'staff' ? 'Assigned to my department' : 'All issues'));
  const [wardCode, setWardCode] = useState(initialWard);
  const filterKey = `${query}\u0000${status}\u0000${scope}\u0000${wardCode}`; const filterRef = useRef(filterKey); filterRef.current = filterKey;
  const [page, setPage] = useState({ complaints: data.complaints, nextCursor: data.nextCursor, total: data.summary.counts.total });
  const [busy, setBusy] = useState(false);
  const scopes = data.user.role === 'citizen' ? ['My reports','Open issues','Resolved','Awaiting review','Finished / legacy closed','Repair cycles reopened'] : data.user.role === 'staff' ? ['Assigned to my department','Total reports','Open issues','Completed','Critical alerts','Finished / legacy closed','Repair cycles reopened','All issues'] : ['All issues','Open issues','Completed','Critical alerts','Finished / legacy closed','Repair cycles reopened','Citizen verified','Finished work','Overdue closure','Recurring issues','Needs verification','Awaiting feedback'];
  useEffect(() => setWardCode(initialWard), [initialWard]);
  useEffect(() => setScope(initialScope || scopes[0]), [data.user.role, initialScope]);
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => { void request<typeof page>('listComplaints', { query, scope, status, wardCode }).then(result => { if (!cancelled) setPage(result); }).catch(() => {}); }, query ? 250 : 0);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [query, scope, status, wardCode, data.user.id, data.summary.counts.total, data.summary.counts.overdue_closure, data.summary.counts.recurring, data.summary.counts.closed, data.summary.counts.citizen_verified, data.summary.counts.pending, data.summary.feedback.count]);
  const loadMore = async () => {
    if (!page.nextCursor || busy) return;
    setBusy(true);
    try { const more = await request<typeof page>('listComplaints', { query, scope, status, wardCode, cursor: page.nextCursor }); if (filterRef.current === filterKey) setPage(current => ({ complaints: [...current.complaints, ...more.complaints], nextCursor: more.nextCursor, total: more.total })); }
    finally { setBusy(false); }
  };
  return <><SectionHeading eyebrow="CASE MANAGEMENT" title="Complaints" right={<span className="count-pill">{page.total} {language === 'bn' ? 'অভিযোগ' : 'reports'}</span>} /><div className="filter-card"><div className="search-box"><Search size={18} /><input aria-label={t("Search by title, ID, ward, category…")} placeholder={t("Search by title, ID, ward, category…")} value={query} onChange={e => setQuery(e.target.value)} /></div><div className="select-wrap"><Filter size={17} /><select value={scope} onChange={e => setScope(e.target.value)}>{scopes.map(x => <option value={x} key={x}>{t(x)}</option>)}</select></div><div className="select-wrap"><ChevronDown size={17} /><select value={status} onChange={e => setStatus(e.target.value)}>{['All statuses','Submitted','Verified','Assigned','In Progress','Awaiting Feedback','Citizen Verified','Finished','Closed','Reopened','Rejected'].map(x => <option value={x} key={x}>{t(x)}</option>)}</select></div><label className="ward-filter">{t("Your ward")}<select aria-label={t("Your ward")} value={wardCode} onChange={event => setWardCode(event.target.value)}><option value="">{t("All wards")}</option>{wardOptions.map(item => <option key={item.code} value={item.code}>{wardLabel(item.code, language)}</option>)}</select></label></div><div className="card list-card"><ComplaintList items={page.complaints} onOpen={onOpen} /></div>{page.nextCursor && <button className="secondary load-more" disabled={busy} onClick={() => void loadMore()}>{busy ? (language === 'bn' ? 'লোড হচ্ছে…' : 'Loading…') : language === 'bn' ? `আরও দেখুন (${page.complaints.length} / ${page.total})` : `Load more (${page.complaints.length} of ${page.total})`}</button>}</>;
}

function MapPage({ data, onOpen, onReportAt, showError }: { data: Snapshot; onOpen: (id: number) => void; onReportAt: (location: MapPoint & { placeName: string }) => void; showError: (message: string) => void }) {
  const { language, t } = useLocale();
  const [mode, setMode] = useState<'markers' | 'heat'>('markers');
  const [category, setCategory] = useState('All categories');
  const [status, setStatus] = useState('All statuses');
  const [wardCode, setWardCode] = useState('');
  const [page, setPage] = useState({ complaints: data.complaints, nextCursor: data.nextCursor, total: data.summary.counts.total });
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(false);
  const [draftPin, setDraftPin] = useState<MapPoint | null>(null);
  const [regionFocus, setRegionFocus] = useState<MapPoint | null>(null);
  const [placeName, setPlaceName] = useState('');
  const [latitudeInput, setLatitudeInput] = useState('');
  const [longitudeInput, setLongitudeInput] = useState('');
  const [accuracy, setAccuracy] = useState<number | null>(null);
  useEffect(() => { setPage({ complaints: data.complaints, nextCursor: data.nextCursor, total: data.summary.counts.total }); }, [data.complaints, data.nextCursor, data.summary.counts.total]);
  const canReport = data.user.role === 'citizen';
  const filtered = page.complaints.filter(c => (category === 'All categories' || c.category === category) && (status === 'All statuses' || c.status === status) && (!wardCode || c.ward_code === wardCode));
  const choosePoint = (point: MapPoint) => { setDraftPin(point); setLatitudeInput(point.latitude.toFixed(6)); setLongitudeInput(point.longitude.toFixed(6)); setAccuracy(null); setMode('markers'); };
  const placeKeyboardPin = () => {
    const point = { latitude: Number(latitudeInput), longitude: Number(longitudeInput) };
    if (!latitudeInput.trim() || !longitudeInput.trim() || !Number.isFinite(point.latitude) || !Number.isFinite(point.longitude) || !inDhakaMap(point)) {
      showError(language === 'bn' ? 'ঢাকার সেবা এলাকার ভেতরে সঠিক স্থানাঙ্ক লিখুন।' : 'Enter valid coordinates inside the Dhaka service area.'); return;
    }
    choosePoint(point);
  };
  const loadMore = async () => {
    if (!page.nextCursor || busy) return;
    setBusy(true);
    try {
      const more = await request<typeof page>('listComplaints', { cursor: page.nextCursor });
      setPage(current => ({ complaints: [...current.complaints, ...more.complaints], nextCursor: more.nextCursor, total: more.total }));
    } catch (error) { showError(String(error instanceof Error ? error.message : error)); }
    finally { setBusy(false); }
  };
  const useMyLocation = () => {
    if (!navigator.geolocation) return showError('This device does not provide a location. Click the map to place a pin.');
    setLocating(true);
    navigator.geolocation.getCurrentPosition(({ coords }) => {
      setLocating(false);
      const point = { latitude: Number(coords.latitude.toFixed(6)), longitude: Number(coords.longitude.toFixed(6)) };
      if (!inDhakaMap(point)) return showError('Your detected location is outside the Dhaka city service area. Click the map to choose a location inside Dhaka.');
      setDraftPin(point);
      setLatitudeInput(point.latitude.toFixed(6)); setLongitudeInput(point.longitude.toFixed(6));
      setAccuracy(Math.round(coords.accuracy));
      setMode('markers');
    }, error => {
      setLocating(false);
      showError(error.code === 1 ? 'Location permission was denied. Click the map to place a pin.' : 'Could not detect your location. Click the map to place a pin.');
    }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 });
  };
  return <>
    <SectionHeading eyebrow="GEOGRAPHIC INTELLIGENCE" title="Explore Dhaka" right={<span className="count-pill"><MapPin size={15} /> {t('Dhaka, Bangladesh')}</span>} />
    <div className="map-toolbar">
      <div className="segmented"><button className={mode === 'markers' ? 'active' : ''} onClick={() => setMode('markers')}><MapPin size={16} /> {t("Issue map")}</button><button className={mode === 'heat' ? 'active' : ''} onClick={() => setMode('heat')}><Activity size={16} /> {t("Density view")}</button></div>
      <div className="map-filters"><select value={category} onChange={e => setCategory(e.target.value)}><option value="All categories">{t("All categories")}</option>{data.categories.map(c => <option key={c.id} value={c.name}>{t(c.name)}</option>)}</select><select value={status} onChange={e => setStatus(e.target.value)}>{['All statuses','Submitted','Assigned','In Progress','Awaiting Feedback','Citizen Verified','Finished','Closed','Reopened'].map(x => <option value={x} key={x}>{t(x)}</option>)}</select><select aria-label={t("Your ward")} value={wardCode} onChange={event => setWardCode(event.target.value)}><option value="">{t("All wards")}</option>{wardOptions.map(item => <option key={item.code} value={item.code}>{wardLabel(item.code, language)}</option>)}</select></div>
    </div>
    <div className="card map-region-guide"><div><strong>{language === 'bn' ? 'ঢাকা উত্তর ও দক্ষিণ দেখুন' : 'Explore Dhaka North and South'}</strong><p className="muted">{language === 'bn' ? 'মানচিত্রে রাস্তা ও এলাকার নাম দেখুন। সংযুক্ত তালিকা দিয়ে ওয়ার্ড নিশ্চিত করুন; এখানে সরকারি ওয়ার্ড সীমানা দেখানো হয়নি।' : 'Explore streets and place names on the map. Check the attached area lists to confirm a ward; official ward boundaries are not shown here.'}</p></div><div className="map-region-actions"><button type="button" className="secondary" onClick={() => setRegionFocus({ latitude: 23.843, longitude: 90.404 })}>{language === 'bn' ? 'ঢাকা উত্তর দেখুন' : 'View Dhaka North'}</button><button type="button" className="secondary" onClick={() => setRegionFocus({ latitude: 23.721, longitude: 90.408 })}>{language === 'bn' ? 'ঢাকা দক্ষিণ দেখুন' : 'View Dhaka South'}</button><a href="/ward-guides/dncc-areas.txt" target="_blank" rel="noreferrer">{language === 'bn' ? 'উত্তরের ওয়ার্ড ও এলাকা' : 'North ward areas'}</a><a href="/ward-guides/dscc-areas.pdf" target="_blank" rel="noreferrer">{language === 'bn' ? 'দক্ষিণের ওয়ার্ড ও এলাকা' : 'South ward areas'}</a></div></div>
    {canReport && <div className="map-pin-toolbar"><div><strong>{t("Mark a new issue")}</strong><span>{language === "bn" ? "মানচিত্রে ক্লিক করুন, অবস্থান ব্যবহার করুন অথবা নিচে স্থানাঙ্ক লিখুন।" : "Click the map, use your location, or enter coordinates below."}</span></div><button type="button" className="secondary" onClick={useMyLocation} disabled={locating}><MapPin size={16} /> {locating ? t('Finding location…') : t('Use my location')}</button></div>}
    {canReport && <div className="card map-keyboard"><label>{t("Latitude")}<input type="number" inputMode="decimal" step="any" min="23.68" max="23.92" value={latitudeInput} onChange={event => setLatitudeInput(event.target.value)} /></label><label>{t("Longitude")}<input type="number" inputMode="decimal" step="any" min="90.30" max="90.53" value={longitudeInput} onChange={event => setLongitudeInput(event.target.value)} /></label><button type="button" className="secondary" onClick={placeKeyboardPin}>{t("Place pin")}</button></div>}
    <IssueMap complaints={filtered} mode={mode} onOpen={onOpen} draftPin={draftPin} onPick={canReport ? choosePoint : undefined} regionFocus={regionFocus} />
    {canReport && <div className="card map-pin-panel"><div><strong>{draftPin ? t('New report pin selected') : t('Select a point on the map')}</strong><span>{draftPin ? `${draftPin.latitude.toFixed(6)}, ${draftPin.longitude.toFixed(6)}` : t('Your pin will appear here.')}</span>{accuracy !== null && <small>{t('Device accuracy about')} {accuracy} {t('m. Check and move the pin on the map if needed.')}</small>}</div><label>{t("Exact place name or nearby landmark")}<input value={placeName} onChange={e => setPlaceName(e.target.value)} maxLength={150} placeholder={t('e.g. East gate of Dhanmondi Lake')} /></label><button type="button" className="primary" disabled={!draftPin || placeName.trim().length < 3} onClick={() => draftPin && onReportAt({ ...draftPin, placeName: placeName.trim() })}>{t("Continue to report")} <ArrowRight size={16} /></button></div>}
    <p className="method-note">{language === 'bn' ? 'দেখানো হচ্ছে' : 'Showing'} {page.complaints.length} {language === 'bn' ? 'টি, মোট' : 'of'} {page.total} {t('reports. Filters apply to loaded map points. Exact locations are available only for reports you may access.')}</p>
    {page.nextCursor && <button className="secondary load-more" disabled={busy} onClick={() => void loadMore()}>{busy ? 'Loading…' : 'Load more map points'}</button>}
    <div className="map-bottom"><div className="card map-legend"><strong>{t('Issue types')}</strong><span><i style={{background:'#f59e6c'}} /> {t('Roads')}</span><span><i style={{background:'#b19aff'}} /> {t('Waste')}</span><span><i style={{background:'#66b8ff'}} /> {t('Water & drainage')}</span><span><i style={{background:'#ffd277'}} /> {t('Lighting')}</span></div><div className="card map-summary"><strong>{filtered.length} {t('loaded complaints')}</strong><span>{new Set(filtered.map(c => c.area)).size} {t('affected areas')}</span><span>{filtered.filter(c => !['Closed','Citizen Verified','Finished'].includes(c.status)).length} {t('still open')}</span></div></div>
  </>;
}

function FeedbackPage({ data, onOpen }: { data: Snapshot; onOpen: (id: number) => void }) {
  const { language, t } = useLocale();
  const awaiting = data.complaints.filter(c => c.status === 'Awaiting Feedback');
  const reviews = data.feedback.slice(0, 6);
  return <><SectionHeading eyebrow="COMMUNITY VOICE" title="Resolution feedback" /><div className="stat-grid three"><StatCard icon={<MessageSquare size={20} />} label="Community responses" value={data.summary.feedback.count} tone="mint" onClick={() => document.getElementById('recent-reviews')?.scrollIntoView({ behavior: 'smooth' })} /><StatCard icon={<Check size={20} />} label="Awaiting review" value={data.summary.counts.awaiting || 0} tone="blue" onClick={() => document.getElementById('completed-for-review')?.scrollIntoView({ behavior: 'smooth' })} /><StatCard icon={<Activity size={20} />} label="Average rating" value={data.summary.feedback.average !== null ? `${data.summary.feedback.average.toFixed(1)}/5` : '—'} tone="amber" onClick={() => document.getElementById('recent-reviews')?.scrollIntoView({ behavior: 'smooth' })} /></div><div className="two-col"><div className="card" id="completed-for-review"><SectionHeading eyebrow="READY FOR YOUR VOICE" title="Recent completed work" /><ComplaintList items={awaiting} onOpen={onOpen} compact /></div><div className="card" id="recent-reviews"><SectionHeading eyebrow="LATEST RESPONSES" title="What residents said" />{reviews.length ? <div className="review-list">{reviews.map(f => { const c = data.complaints.find(x => x.id === f.complaint_id); return <button key={f.id} onClick={() => c && onOpen(c.id)}><span className="review-avatar">{f.author[0]}</span><span><strong>{f.author} <em>{'★'.repeat(f.rating)}{'☆'.repeat(5-f.rating)}</em></strong><small>{c?.title} · {f.local ? 'Area matched resident' : 'Public feedback'}</small><p>{f.comment || `Issue ${f.resolution.toLowerCase()} resolved.`}</p></span></button>; })}</div> : <Empty title="No feedback yet" text="Residents can review issues after work is completed." />}</div></div><p className="method-note">{t('The list shows feedback for recent reports. Totals include all reports visible to your role.')}</p></>;
}

function Analytics({ data, onFilter }: { data: Snapshot; onFilter: (scope: string) => void }) {
  const { t } = useLocale();
  const { summary } = data;
  const categoryRows = summary.categories.map(row => ({ name: data.categories.find(c => c.id === row.id)?.name || 'Other', count: row.count }));
  const departments = summary.departments.map(row => ({ name: data.departments.find(d => d.id === row.id)?.name || 'Department', ...row }));
  return <><SectionHeading eyebrow="OPERATIONAL INSIGHTS" title="Dhaka analytics" /><div className="stat-grid"><StatCard icon={<FileText size={20} />} label="Total reports" value={summary.counts.total} tone="mint" onClick={() => onFilter(data.user.role === 'citizen' ? 'My reports' : 'All issues')} /><StatCard icon={<Activity size={20} />} label="Still open" value={summary.counts.open || 0} tone="amber" onClick={() => onFilter('Open issues')} /><StatCard icon={<Check size={20} />} label="Finished / legacy closed" value={summary.counts.closed || 0} tone="blue" onClick={() => onFilter('Finished / legacy closed')} /><StatCard icon={<Flag size={20} />} label="Repair cycles reopened" value={summary.reopened} tone="rose" onClick={() => onFilter('Repair cycles reopened')} /></div>
    <div className="two-col"><div className="card"><SectionHeading eyebrow="ISSUE MIX" title="Reports by category" /><div className="bar-list tall">{categoryRows.map((item,i) => <div className="bar-row" key={item.name}><span>{t(item.name)}</span><div className="bar-track"><i style={{ width: `${item.count/Math.max(1,categoryRows[0].count)*100}%`, background: ['#66dbc3','#82b7ff','#ffc883','#bca5ff','#ff9e9d'][i%5] }} /></div><strong>{item.count}</strong></div>)}</div></div>
    <div className="card"><SectionHeading eyebrow="GEOGRAPHIC PATTERN" title="Areas needing attention" /><div className="area-list">{summary.areas.map((row,i) => <div key={row.area}><span className="rank">{String(i+1).padStart(2,'0')}</span><span><strong>{row.area}</strong><small>{row.open} {t('Open issues')}</small></span><b>{row.count}</b></div>)}</div></div></div>
    <div className="card"><SectionHeading eyebrow="SERVICE DELIVERY" title="Department performance" /><div className="performance-grid">{departments.map(d => <div className="performance-card" key={d.id}><span className="dept-icon"><Users size={18} /></span><h3>{d.name}</h3><div><strong>{d.count}</strong><small>{t('assigned')}</small></div><div><strong>{d.resolved}</strong><small>{t('completed')}</small></div></div>)}</div></div><p className="method-note">{t('Counts use all reports visible to your role. Area and department lists show the top 20. Area matched feedback remains provisional until addresses are independently verified.')}</p></>;
}

function NotificationsPage({ data, onOpen, refresh, showError }: { data: Snapshot; onOpen: (id: number) => void; refresh: () => Promise<void>; showError: (message: string) => void }) {
  const { language, t } = useLocale();
  const openNotification = async (id: number, complaintId: number) => {
    try { await request('readNotification', { id }); await refresh(); onOpen(complaintId); }
    catch (error) { showError(String(error instanceof Error ? error.message : error)); }
  };
  return <><SectionHeading eyebrow="YOUR UPDATES" title="Notifications" right={<span className="count-pill">{data.notifications.filter(item => !item.read_at).length} {t('unread')}</span>} />
    <div className="card notification-list">{data.notifications.length ? data.notifications.map(item => { const localized = localizeNotification(item.title, item.message, language); return <button key={item.id} className={`notification-item ${item.read_at ? '' : 'unread'}`} onClick={() => void openNotification(item.id, item.complaint_id)}><span className="notification-icon"><Bell size={18} /></span><span><strong>{localized.title}</strong><small>{localized.message}</small><time>{dateTime(item.created_at)}</time></span><ArrowRight size={16} /></button>; }) : <Empty title={t('No notifications yet')} text={language === 'bn' ? 'অভিযোগের অগ্রগতি ও সময়সীমার সতর্কতা এখানে দেখাবে।' : 'Case updates and deadline alerts will appear here.'} />}</div></>;
}

function PerformancePage({ data, onPage, onOpen, onFilter, showError }: { data: Snapshot; onPage: (page: Page) => void; onOpen: (id: number) => void; onFilter: (scope: string) => void; showError: (message: string) => void }) {
  const { language, t } = useLocale();
  const [report, setReport] = useState<Performance | null>(null);
  const [departmentId, setDepartmentId] = useState('all');
  useEffect(() => { let active = true; void request<Performance>('performance').then(value => { if (active) setReport(value); }).catch(error => showError(String(error))); return () => { active = false; }; }, [data.summary.counts.finished, data.summary.counts.citizen_verified, data.summary.feedback.count]);
  const areas = (report?.areas || []).filter(row => departmentId === 'all' || row.department_id === Number(departmentId));
  const top = Math.max(1, ...areas.map(row => row.finished));
  return <><SectionHeading eyebrow="SUPER ADMIN REVIEW" title="Finished work performance" /><p className="muted">{t('Only citizen-confirmed repairs count. Ratings use the latest confirmation for each finished case.')}</p>
    <div className="stat-grid three"><StatCard icon={<Check size={20} />} label="Finished cases" value={report?.departments.reduce((sum,row) => sum + row.finished,0) ?? '—'} tone="mint" onClick={() => onFilter('Finished work')} /><StatCard icon={<Bell size={20} />} label="Waiting for your review" value={data.summary.counts.citizen_verified || 0} tone="amber" onClick={() => onFilter('Citizen verified')} /><StatCard icon={<Users size={20} />} label="Departments" value={report?.departments.length ?? '—'} tone="blue" onClick={() => document.getElementById('department-scorecard')?.scrollIntoView({ behavior: 'smooth' })} /></div>
    {(data.summary.counts.citizen_verified || 0) > 0 && <div className="deadline-strip"><span><Check size={17} /> <strong>{data.summary.counts.citizen_verified}</strong> {language === 'bn' ? 'টি নাগরিকের নিশ্চিত করা অভিযোগ সমাপ্ত করার অপেক্ষায়' : 'citizen verified case(s) await Finished work'}</span><button className="text-button" onClick={() => onPage('complaints')}>{t('Open complaints')} <ArrowRight size={15} /></button></div>}
    {!!report?.pendingReopenRequests.length && <div className="card"><SectionHeading eyebrow="REWORK" title="Requests awaiting a decision" /><div className="complaint-list">{report.pendingReopenRequests.map(item => <button className="complaint-row" key={item.id} onClick={() => onOpen(item.complaint_id)}><span className="row-main"><strong>{item.code} · {item.title}</strong><small>{item.reason}</small></span><ArrowRight size={16} /></button>)}</div></div>}
    <div className="card" id="department-scorecard"><SectionHeading eyebrow="CITIZEN RATINGS" title="Department scorecard" /><p className="muted">{t('Rates use finished, citizen-confirmed cases. Time is from report submission to citizen confirmation; rating count includes confirmed ratings.')}</p><div className="performance-grid">{report?.departments.map(row => <div className="performance-card performance-card-action" key={row.id} role="button" tabIndex={0} aria-label={`${t(row.name)} · ${t("Accomplished work by area")}`} onClick={() => { setDepartmentId(String(row.id)); document.getElementById("area-output")?.scrollIntoView({ behavior: "smooth" }); }} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setDepartmentId(String(row.id)); document.getElementById("area-output")?.scrollIntoView({ behavior: "smooth" }); } }}><span className="dept-icon"><Users size={18} /></span><h3>{t(row.name)}</h3><div><strong>{row.average_rating === null ? '—' : `${row.average_rating.toFixed(1)} ★`}</strong><small>{row.rating_count} {language === 'bn' ? 'টি রেটিং' : 'ratings'}</small></div><div><strong>{row.finished}</strong><small>{language === 'bn' ? `সমাপ্ত · ${row.awaiting_finish}টি পর্যালোচনার অপেক্ষায়` : `finished · ${row.awaiting_finish} awaiting review`}</small></div><div><strong>{row.median_confirmation_hours === null ? '—' : `${row.median_confirmation_hours} ${language === 'bn' ? 'ঘণ্টা' : 'h'}`}</strong><small>{language === 'bn' ? 'নাগরিকের নিশ্চিত করতে মাঝারি সময়' : 'median to citizen confirmation'}</small></div><div><strong>{row.on_time_percent === null ? '—' : `${row.on_time_percent}%`}</strong><small>{language === 'bn' ? `সময়সীমার মধ্যে নিশ্চিত · ${row.sample_count}টি অভিযোগ` : `confirmed by deadline · ${row.sample_count} cases`}</small></div><div><strong>{row.reopened_percent === null ? '—' : `${row.reopened_percent}%`}</strong><small>{language === 'bn' ? `নিশ্চিতের পর আবার খোলা · ${row.reopen_sample_count}টি অভিযোগ` : `reopened after confirmation · ${row.reopen_sample_count} cases`}</small></div></div>)}</div></div>
    <div className="card" id="area-output"><SectionHeading eyebrow="AREA OUTPUT" title="Accomplished work by area" right={<select aria-label={t('Filter department')} value={departmentId} onChange={event => setDepartmentId(event.target.value)}><option value="all">{t('All departments')}</option>{report?.departments.map(row => <option key={row.id} value={row.id}>{t(row.name)}</option>)}</select>} />{areas.length ? <div className="area-performance-chart">{areas.map(row => <div className="area-performance-row" key={`${row.department_id}:${row.area}`}><div><strong>{row.area}</strong><small>{t(row.department)} · {row.average_rating?.toFixed(1)} ★</small></div><div className="bar-track"><i style={{width: `${row.finished / top * 100}%`}} /></div><b>{row.finished}</b></div>)}</div> : <Empty title="No finished work yet" text="The graph will fill after citizens verify repairs and you move them to Finished work." />}</div></>;
}

function AuthenticatorPanel({ user, refresh, showError }: { user: User; refresh: () => Promise<void>; showError: (message: string) => void }) {
  const { t } = useLocale();
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const run = async (method: 'beginMfa' | 'confirmMfa' | 'disableMfa') => {
    setBusy(true); setStatus('');
    try {
      if (method === 'beginMfa') setSetup(await request<{ secret: string; uri: string }>(method, { password }));
      else { await request(method, { password, code }); setSetup(null); setPassword(''); setCode(''); await refresh(); setStatus(method === 'confirmMfa' ? 'Authenticator sign-in enabled. Other sessions were signed out.' : 'Authenticator sign-in disabled.'); }
    } catch (error) { showError(String(error instanceof Error ? error.message : error)); }
    finally { setBusy(false); }
  };
  if (!['admin','superadmin'].includes(user.role)) return null;
  return <div className="card profile-security"><h3>{t('Authenticator sign-in')}</h3><p className="muted">{t('Protect this administrative account with a six-digit code from an authenticator app. Save a recovery code before enabling this.')}</p><p role="status">{t(user.mfaEnabled ? 'Enabled' : 'Not enabled')}</p><div className="account-form"><label>{t('Password for authenticator')}<input type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} /></label>{setup && !user.mfaEnabled && <div className="security-key"><p>{t('Add an account in your authenticator app using this setup key. It expires here after ten minutes.')}</p><code>{setup.secret}</code><small>Account: CivicPulse · {user.email} · 6 digits · 30 seconds</small></div>}{(setup || user.mfaEnabled) && <label>{t('Six-digit code')}<input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={event => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} /></label>}<button type="button" className={user.mfaEnabled ? 'secondary' : 'primary'} disabled={busy || !password || ((setup || user.mfaEnabled) && code.length !== 6)} onClick={() => void run(user.mfaEnabled ? 'disableMfa' : setup ? 'confirmMfa' : 'beginMfa')}>{t(busy ? 'Please wait…' : user.mfaEnabled ? 'Disable authenticator' : setup ? 'Confirm and enable' : 'Set up authenticator')}</button>{status && <p role="status">{t(status)}</p>}</div></div>;
}

function PrivacyPanel({ requestState, refresh, showError }: { requestState: PrivacyRequest | null; refresh: () => Promise<void>; showError: (message: string) => void }) {
  const { t } = useLocale();
  const [password, setPassword] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true);
    try { await request('requestPrivacyRemoval', { password, reason }); setPassword(''); setReason(''); await refresh(); }
    catch (error) { showError(String(error instanceof Error ? error.message : error)); }
    finally { setBusy(false); }
  };
  return <div className="card profile-security"><h3>{t('Remove my personal data')}</h3><p className="muted">{t('Request owner review of your account and reports. Approval disables sign-in and removes your name, email, detailed location, written case details, and photos. Anonymous case status and totals remain. Earlier encrypted backups may retain the original records until those copies are removed.')}</p>{requestState && <p role="status">{t('Latest request')}: {t(requestState.status)} · {date(requestState.created_at)}{requestState.decision_note ? ` · ${requestState.decision_note}` : ''}</p>}{requestState?.status !== 'Pending' && <form className="account-form" onSubmit={submit}><label>{t('Reason (optional)')}<textarea value={reason} maxLength={500} onChange={event => setReason(event.target.value)} rows={2} /></label><label>{t('Current password')}<input type="password" value={password} onChange={event => setPassword(event.target.value)} required /></label><button className="secondary danger" disabled={busy}>{t(busy ? 'Sending…' : 'Request data removal')}</button></form>}</div>;
}

function Profile({ user, showError, emailEnabled, pushPublicKey, privacyRequest, refresh }: { user: User; showError: (message: string) => void; emailEnabled: boolean; pushPublicKey: string | null; privacyRequest: PrivacyRequest | null; refresh: () => Promise<void> }) {
  const { t } = useLocale();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [verificationSent, setVerificationSent] = useState(false);
  const [recoveryPassword, setRecoveryPassword] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [pushStatus, setPushStatus] = useState('');
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setSaved(false);
    try { await request('changePassword', { currentPassword, newPassword }); setCurrentPassword(''); setNewPassword(''); setRecoveryCode(''); setSaved(true); }
    catch (error) { showError(String(error instanceof Error ? error.message : error)); }
    finally { setBusy(false); }
  };
  const resend = async () => { setBusy(true); try { await request('requestVerification'); setVerificationSent(true); } catch (error) { showError(String(error instanceof Error ? error.message : error)); } finally { setBusy(false); } };
  const generateCode = async (event: FormEvent) => { event.preventDefault(); setBusy(true); setRecoveryCode(''); try { setRecoveryCode(await request<string>('issueRecoveryCode', { password: recoveryPassword })); setRecoveryPassword(''); } catch (error) { showError(String(error instanceof Error ? error.message : error)); } finally { setBusy(false); } };
  const turnOnAlerts = async () => { if (!pushPublicKey) return; setBusy(true); try { const status = await enablePush(pushPublicKey); setPushStatus(status === 'enabled' ? 'Browser alerts enabled on this device.' : status === 'denied' ? 'Browser notification permission was declined. Change it in browser settings.' : 'This browser does not support background alerts.'); } catch (error) { showError(String(error instanceof Error ? error.message : error)); } finally { setBusy(false); } };
  const turnOffAlerts = async () => { setBusy(true); try { await disablePush(); setPushStatus('Browser alerts disabled on this device.'); } catch (error) { showError(String(error instanceof Error ? error.message : error)); } finally { setBusy(false); } };
  return <><SectionHeading eyebrow="YOUR ACCOUNT" title="Account security" /><div className="card profile-security"><h3>{user.name}</h3><p>{user.email} · {t(roleName[user.role])}</p><p>{t('Email')}: {t(user.emailVerified ? 'verified' : emailEnabled ? 'verification needed' : 'verification not available yet')}</p>{!user.emailVerified && emailEnabled && <><button type="button" className="secondary" disabled={busy} onClick={() => void resend()}>{t('Send verification link')}</button>{verificationSent && <p role="status">{t('Verification link sent. Check your email, then click Refresh here.')}</p>}</>}<form className="account-form" onSubmit={submit}><label>{t('Current password')}<input type="password" value={currentPassword} onChange={event => setCurrentPassword(event.target.value)} required /></label><label>{t('New password')}<input type="password" value={newPassword} onChange={event => setNewPassword(event.target.value)} minLength={12} maxLength={128} required /></label><button className="primary" disabled={busy}>{t(busy ? 'Saving…' : 'Change password')}</button></form>{saved && <p role="status">{t('Password updated. Other signed-in devices have been signed out.')}</p>}</div>{pushPublicKey && pushAvailable() && <div className="card profile-security"><h3>{t('Browser alerts')}</h3><p className="muted">{t('Receive case updates even when this tab is closed. Your browser will ask for permission once.')}</p><div className="action-row"><button type="button" className="primary" disabled={busy} onClick={() => void turnOnAlerts()}>{t('Enable alerts')}</button><button type="button" className="secondary" disabled={busy} onClick={() => void turnOffAlerts()}>{t('Disable on this device')}</button></div>{pushStatus && <p role="status">{t(pushStatus)}</p>}</div>}<div className="card profile-security"><h3>{t('Recovery code')}</h3><p className="muted">{t('Generate a one-time code while you can sign in. Save it privately outside this laptop. A new code replaces the previous one and expires after one year.')}</p><form className="account-form" onSubmit={generateCode}><label>{t('Password to generate recovery code')}<input type="password" value={recoveryPassword} onChange={event => setRecoveryPassword(event.target.value)} required /></label><button className="secondary" disabled={busy}>{t('Generate new recovery code')}</button></form>{recoveryCode && <div role="status"><p>{t('Save this code now. It will not be shown again:')}</p><code className="recovery-code">{recoveryCode}</code></div>}</div><AuthenticatorPanel user={user} refresh={refresh} showError={showError} />{user.role === 'citizen' && <PrivacyPanel requestState={privacyRequest} refresh={refresh} showError={showError} />}</>;
}

function Manage({ data, refresh, showError, backupEnabled }: { data: Snapshot; refresh: () => Promise<void>; showError: (message: string) => void; backupEnabled: boolean }) {
  const { language, t } = useLocale();
  const [kind, setKind] = useState<'department' | 'category'>('category');
  const [name, setName] = useState(''); const [departmentId, setDepartmentId] = useState('');
  const [accountName, setAccountName] = useState(''); const [accountEmail, setAccountEmail] = useState('');
  const [accountPassword, setAccountPassword] = useState(''); const [accountRole, setAccountRole] = useState<'staff' | 'admin'>('staff');
  const [accountDepartment, setAccountDepartment] = useState(''); const [busy, setBusy] = useState(false);
  const [managementStatus, setManagementStatus] = useState('');
  const [targetCategoryId, setTargetCategoryId] = useState('');
  const [targetHours, setTargetHours] = useState('168');
  const [targetStatus, setTargetStatus] = useState('');
  const [backupPassword, setBackupPassword] = useState('');
  const [backupPassphrase, setBackupPassphrase] = useState('');
  const [backupStatus, setBackupStatus] = useState('');
  const [backupBusy, setBackupBusy] = useState(false);
  const [checkFile, setCheckFile] = useState<File | null>(null);
  const [checkPassphrase, setCheckPassphrase] = useState('');
  const [lastBackupCheck, setLastBackupCheck] = useState(() => localStorage.getItem('civicpulse:lastVerifiedBackup') || '');
  const [checkStatus, setCheckStatus] = useState('');
  const [privacyNote, setPrivacyNote] = useState('');
  const [retentionDays, setRetentionDays] = useState('730');
  const [retentionCount, setRetentionCount] = useState<number | null>(null);
  const [retentionPassword, setRetentionPassword] = useState('');
  const [retentionConfirm, setRetentionConfirm] = useState('');
  const [retentionStatus, setRetentionStatus] = useState('');
  const [purgeCount, setPurgeCount] = useState<number | null>(null);
  const [purgePassword, setPurgePassword] = useState('');
  const [purgeConfirm, setPurgeConfirm] = useState('');
  const [purgeStatus, setPurgeStatus] = useState('');
  const previewPurge = async () => {
    setBusy(true);
    try { const result = await request<{ complaints: number }>('complaintPurgePreview'); setPurgeCount(result.complaints); }
    catch (error) { showError(String(error instanceof Error ? error.message : error)); }
    finally { setBusy(false); }
  };
  const applyPurge = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true);
    try {
      const result = await request<{ complaints: number }>('purgeComplaints', { password: purgePassword, confirm: purgeConfirm });
      setPurgePassword(''); setPurgeConfirm(''); setPurgeCount(0);
      setPurgeStatus(language === 'bn' ? `${result.complaints}টি অভিযোগ ও সংশ্লিষ্ট ইতিহাস মুছে ফেলা হয়েছে।` : `${result.complaints} complaints and related history removed.`);
      await refresh();
    } catch (error) { showError(String(error instanceof Error ? error.message : error)); }
    finally { setBusy(false); }
  };
  const saveBackup = async (event: FormEvent) => {
    event.preventDefault(); setBackupBusy(true); setBackupStatus(t('Starting backup…'));
    try { await downloadEncryptedBackup(backupPassword, backupPassphrase, message => setBackupStatus(language === 'bn' ? message.startsWith('Collecting ') ? `${t('Collecting backup data')}…` : t(message) : message)); setBackupPassword(''); setBackupPassphrase(''); }
    catch (error) { setBackupStatus(''); showError(String(error instanceof Error ? error.message : error)); }
    finally { setBackupBusy(false); }
  };
  const checkBackup = async (event: FormEvent) => {
    event.preventDefault(); if (!checkFile) return;
    setBackupBusy(true); setCheckStatus(t('Checking encrypted file…'));
    try {
      const checked = await verifyEncryptedBackup(checkFile, checkPassphrase);
      const now = new Date().toISOString(); localStorage.setItem('civicpulse:lastVerifiedBackup', now); setLastBackupCheck(now);
      setCheckStatus(language === 'bn' ? `${new Date(checked.createdAt).toLocaleString('bn-BD')} তারিখের ব্যাকআপ যাচাই হয়েছে: ${checked.accounts}টি অ্যাকাউন্ট ও ${checked.complaints}টি অভিযোগ। ডিক্রিপশন ও গঠন যাচাই হয়েছে; মাঝে মাঝে স্থানীয়ভাবে পূর্ণ রিস্টোর পরীক্ষা করুন।` : `Verified backup from ${new Date(checked.createdAt).toLocaleString()}: ${checked.accounts} accounts and ${checked.complaints} reports. This checks decryption and structure; test a full local restore periodically.`);
      setCheckPassphrase('');
    } catch (error) { setCheckStatus(''); showError(String(error instanceof Error ? error.message : error)); }
    finally { setBackupBusy(false); }
  };
  const reviewPrivacy = async (requestId: number, decision: 'Approved' | 'Declined') => {
    if (decision === 'Approved' && !window.confirm(t('Approve removal of this citizen’s personal data and disable their account? This cannot be undone from the live app.'))) return;
    setBusy(true);
    try { await request('decidePrivacyRemoval', { requestId, decision, note: privacyNote }); setPrivacyNote(''); await refresh(); }
    catch (error) { showError(String(error instanceof Error ? error.message : error)); }
    finally { setBusy(false); }
  };
  const previewRetention = async () => {
    setBusy(true);
    try { setRetentionCount(await request<number>('retentionPreview', { days: Number(retentionDays) })); setRetentionStatus(''); }
    catch (error) { showError(String(error instanceof Error ? error.message : error)); }
    finally { setBusy(false); }
  };
  const applyRetention = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true);
    try {
      const result = await request<{ processed: number; remaining: number }>('applyRetention', { days: Number(retentionDays), password: retentionPassword, confirm: retentionConfirm });
      setRetentionPassword(''); setRetentionConfirm(''); setRetentionCount(result.remaining);
      setRetentionStatus(language === 'bn' ? `${result.processed}টি পুরোনো অভিযোগ বেনামি হয়েছে। ${result.remaining}টি বাকি আছে। প্রয়োজন হলে আবার করুন।` : `${result.processed} old cases anonymized. ${result.remaining} eligible cases remain. Repeat if needed.`);
      await refresh();
    } catch (error) { showError(String(error instanceof Error ? error.message : error)); }
    finally { setBusy(false); }
  };
  const add = async (event: FormEvent) => { event.preventDefault(); setBusy(true); setManagementStatus(''); try { await request('manage', { type: kind, name, departmentId: departmentId || null }); setName(''); await refresh(); setManagementStatus(kind === 'department' ? 'Department created. Add a category assigned to it so citizens can choose that service.' : 'Category created and available for new reports.'); } catch (error) { showError(String(error instanceof Error ? error.message : error)); } finally { setBusy(false); } };
  const addAccount = async (event: FormEvent) => { event.preventDefault(); setBusy(true); try { await request('manage', { type: 'user', name: accountName, email: accountEmail, password: accountPassword, role: accountRole, departmentId: accountDepartment || null }); setAccountName(''); setAccountEmail(''); setAccountPassword(''); await refresh(); } catch (error) { showError(String(error instanceof Error ? error.message : error)); } finally { setBusy(false); } };
  const saveTarget = async (event: FormEvent) => { event.preventDefault(); setBusy(true); setTargetStatus(''); try { await request('manage', { type: 'resolutionTime', categoryId: Number(targetCategoryId), hours: Number(targetHours) }); await refresh(); setTargetStatus('Closure target saved. It applies to new reports only.'); } catch (error) { showError(String(error instanceof Error ? error.message : error)); } finally { setBusy(false); } };
  const changeAccount = async (account: User) => { setBusy(true); try { await request('manage', { type: 'userStatus', userId: account.id, active: !account.active }); await refresh(); } catch (error) { showError(String(error instanceof Error ? error.message : error)); } finally { setBusy(false); } };
  return <><SectionHeading eyebrow="PLATFORM CONTROL" title="Administration" />
    <div className="stat-grid three"><StatCard icon={<Users size={20} />} label="Accounts" value={data.users.length} tone="mint" onClick={() => document.getElementById('team-accounts')?.scrollIntoView({ behavior: 'smooth' })} /><StatCard icon={<Settings size={20} />} label="Categories" value={data.categories.length} tone="blue" onClick={() => document.getElementById('categories-departments')?.scrollIntoView({ behavior: 'smooth' })} /><StatCard icon={<ShieldCheck size={20} />} label="Audit events" value={data.audit.length} tone="amber" onClick={() => document.getElementById('audit-trail')?.scrollIntoView({ behavior: 'smooth' })} /></div>
    <div className="two-col"><div className="card" id="categories-departments"><SectionHeading eyebrow="STRUCTURE" title="Categories & departments" /><form className="management-form" onSubmit={add}><select value={kind} onChange={e => setKind(e.target.value as 'category' | 'department')}><option value="category">{t('New category')}</option><option value="department">{t('New department')}</option></select><input value={name} onChange={e => setName(e.target.value)} placeholder={t('Name')} minLength={3} required />{kind === 'category' && <select value={departmentId} onChange={e => setDepartmentId(e.target.value)}><option value="">{t('No default department')}</option>{data.departments.filter(d => d.active).map(d => <option value={d.id} key={d.id}>{t(d.name)}</option>)}</select>}<button className="primary" disabled={busy}><Plus size={16} /> {t('Add')}</button></form>{managementStatus && <p role="status">{t(managementStatus)}</p>}<h3>{t('Departments')}</h3><div className="settings-list">{data.departments.map(d => <div key={d.id}><strong>{t(d.name)}</strong><span>{data.categories.filter(c => c.department_id === d.id).length} {t('Categories')} · {t(d.active ? 'Active' : 'Inactive')}</span></div>)}</div><h3>{t('Report categories')}</h3><p className="muted">{t('Citizens select a category. Assign categories to departments to route new reports.')}</p><div className="settings-list">{data.categories.map(c => <div key={c.id}><strong>{t(c.name)}</strong><span>{t(data.departments.find(d => d.id === c.department_id)?.name || 'Unassigned')}</span></div>)}</div></div>
    <div className="card" id="team-accounts"><SectionHeading eyebrow="ACCESS" title="Team accounts" /><form className="account-form" onSubmit={addAccount}><input value={accountName} onChange={e => setAccountName(e.target.value)} placeholder={t('Full name')} minLength={3} required /><input value={accountEmail} onChange={e => setAccountEmail(e.target.value)} type="email" placeholder={t('Work email')} required /><input value={accountPassword} onChange={e => setAccountPassword(e.target.value)} type="password" minLength={10} placeholder={t('Temporary password (10+ characters)')} required /><select value={accountRole} onChange={e => setAccountRole(e.target.value as 'staff' | 'admin')}><option value="staff">{t('Department staff')}</option><option value="admin">{t('Administrator')}</option></select>{accountRole === 'staff' && <select value={accountDepartment} onChange={e => setAccountDepartment(e.target.value)} required><option value="">{t('Choose department')}</option>{data.departments.filter(d => d.active).map(d => <option value={d.id} key={d.id}>{t(d.name)}</option>)}</select>}<button className="primary" disabled={busy}><Plus size={16} /> {t('Add account')}</button></form><div className="settings-list">{data.users.map(u => <div key={u.id}><strong>{u.name}</strong><span>{t(roleName[u.role])} · {u.department_id ? t(data.departments.find(d => d.id === u.department_id)?.name || '') + ' · ' : ''}{u.email}</span></div>)}</div></div></div>
    <div className="card"><SectionHeading eyebrow="SERVICE TARGETS" title="Closure deadlines by category" /><p className="muted">{t('New complaints receive the selected category’s target. Changing a target does not rewrite deadlines already given to residents.')}</p><form className="target-form" onSubmit={saveTarget}><label>{t('Category')}<select value={targetCategoryId} onChange={e => { setTargetCategoryId(e.target.value); setTargetHours(String(data.categories.find(c => c.id === Number(e.target.value))?.resolution_hours || 168)); }} required><option value="">{t('Choose category')}</option>{data.categories.map(c => <option key={c.id} value={c.id}>{t(c.name)}</option>)}</select></label><label>{t('Hours to closure')}<input type="number" min="1" max="720" step="1" value={targetHours} onChange={e => setTargetHours(e.target.value)} required /></label><button className="primary" disabled={busy}>{t('Save target')}</button></form>{targetStatus && <p role="status">{t(targetStatus)}</p>}<div className="target-grid">{data.categories.map(c => <span key={c.id}><strong>{t(c.name)}</strong>{c.resolution_hours} {t('hours')}</span>)}</div></div>
    <div className="card"><SectionHeading eyebrow="ACCESS CONTROL" title="Manage staff access" /><div className="settings-list">{data.users.filter(u => ['admin','staff'].includes(u.role)).map(u => <div key={u.id}><strong>{u.name} · {t(roleName[u.role])}</strong><span>{u.email} · {t(u.active ? 'Active' : 'Disabled')}</span><button type="button" className="account-toggle" disabled={busy} onClick={() => void changeAccount(u)}>{t(u.active ? 'Disable access' : 'Reactivate access')}</button></div>)}</div></div>
    <div className="card"><SectionHeading eyebrow="DATA RECOVERY" title="Encrypted owner backup" /><p role="status">{t('Scheduled offsite backup')}: {t(backupEnabled ? 'configured; check the private bucket for successful daily files' : 'not configured. Keep downloading manual encrypted backups.')}</p><p className="muted">{t('Download a protected copy of accounts, reports, images, feedback, and audit records. Keep the backup passphrase in a separate safe place. This export can use significant browser memory as records grow.')}</p><form className="account-form" onSubmit={saveBackup}><label>{t('Your current password')}<input type="password" autoComplete="current-password" value={backupPassword} onChange={e => setBackupPassword(e.target.value)} required /></label><label>{t('Backup passphrase (16+ characters)')}<input type="password" autoComplete="new-password" minLength={16} value={backupPassphrase} onChange={e => setBackupPassphrase(e.target.value)} required /></label><button className="primary" disabled={backupBusy}><Download size={16} /> {t(backupBusy ? 'Preparing…' : 'Download encrypted backup')}</button></form>{backupStatus && <p role="status">{backupStatus}</p>}<p role="status">{lastBackupCheck ? `Last checked on this device: ${new Date(lastBackupCheck).toLocaleDateString()}${Date.now() - Date.parse(lastBackupCheck) > 7 * 86400000 ? ' · Check a fresh backup this week.' : ''}` : 'No encrypted backup has been checked on this device. Check one every week.'}</p><form className="account-form" onSubmit={checkBackup}><label>{t('Check a downloaded .cpbk file')}<input type="file" accept=".cpbk" onChange={event => setCheckFile(event.target.files?.[0] || null)} required /></label><label>{t('Its backup passphrase')}<input type="password" value={checkPassphrase} onChange={event => setCheckPassphrase(event.target.value)} required /></label><button className="secondary" disabled={backupBusy || !checkFile}>{t('Verify backup file')}</button></form>{checkStatus && <p role="status">{checkStatus}</p>}</div>
    <div className="card"><SectionHeading eyebrow="PRIVACY" title="Citizen data removal requests" /><p className="muted">{t('Review a request before approving. Approval removes personal case details and photos, anonymizes the account, and signs the citizen out. Check old backup copies separately.')}</p>{data.privacyRequests.filter(item => item.status === 'Pending').length === 0 ? <p className="muted">{t('No requests waiting for review.')}</p> : <div className="settings-list">{data.privacyRequests.filter(item => item.status === 'Pending').map(item => <div key={item.id}><strong>{item.name} · {item.email}</strong><span>{t('Requested')} {date(item.created_at)}{item.reason ? ` · ${item.reason}` : ''}</span><label>{t('Decision note')}<input value={privacyNote} maxLength={500} onChange={event => setPrivacyNote(event.target.value)} placeholder={t('Required when declining')} /></label><div className="action-row"><button type="button" className="secondary danger" disabled={busy} onClick={() => void reviewPrivacy(item.id, 'Approved')}>{t('Approve removal')}</button><button type="button" className="secondary" disabled={busy || privacyNote.trim().length < 5} onClick={() => void reviewPrivacy(item.id, 'Declined')}>{t('Decline')}</button></div></div>)}</div>}</div>
    <div className="card"><SectionHeading eyebrow="DATA RETENTION" title="Remove old case content" /><p className="muted">{t('For closed, finished, rejected or duplicate reports older than the chosen age, remove written details and photos, reduce location precision, and retain status and counts. Each action handles up to 50 cases. Reporter account links remain until a citizen removal request is approved. Verify an encrypted backup first; old backup files must be reviewed separately.')}</p><div className="account-form"><label>{t('Age in days (365–3650)')}<input type="number" min="365" max="3650" value={retentionDays} onChange={event => { setRetentionDays(event.target.value); setRetentionCount(null); }} /></label><button type="button" className="secondary" disabled={busy} onClick={() => void previewRetention()}>{t('Preview eligible cases')}</button>{retentionCount !== null && <p role="status">{retentionCount} {t('eligible cases')}</p>}</div>{retentionCount !== null && retentionCount > 0 && <form className="account-form" onSubmit={applyRetention}><label>{t('Password to apply retention')}<input type="password" value={retentionPassword} onChange={event => setRetentionPassword(event.target.value)} required /></label><label>{t('Type ANONYMIZE to confirm')}<input value={retentionConfirm} onChange={event => setRetentionConfirm(event.target.value)} required /></label><button className="secondary danger" disabled={busy || retentionConfirm !== 'ANONYMIZE'}>{t('Anonymize up to 50 old cases')}</button></form>}{retentionStatus && <p role="status">{retentionStatus}</p>}</div>
    <div className="card"><SectionHeading eyebrow="COMPLAINT RESET" title="Delete complaints and history" /><p className="muted">{t('This removes all complaints, photos, messages, feedback, notifications and case history. Accounts, departments and categories stay. Existing backup files are separate.')}</p><button type="button" className="secondary" disabled={busy} onClick={() => void previewPurge()}>{t('Preview complaint count')}</button>{purgeCount !== null && <p role="status">{purgeCount} {t('complaints would be deleted')}</p>}{purgeCount !== null && purgeCount > 0 && <form className="account-form" onSubmit={applyPurge}><label>{t('Your current password')}<input type="password" autoComplete="current-password" value={purgePassword} onChange={event => setPurgePassword(event.target.value)} required /></label><label>{t('Type DELETE COMPLAINTS to confirm')}<input value={purgeConfirm} onChange={event => setPurgeConfirm(event.target.value)} required /></label><button type="submit" className="secondary danger" disabled={busy || purgeConfirm !== 'DELETE COMPLAINTS'}>{t('Delete complaints and history')}</button></form>}{purgeStatus && <p role="status">{purgeStatus}</p>}</div>
    <div className="card" id="audit-trail"><SectionHeading eyebrow="ACCOUNTABILITY" title="Recent audit trail" /><div className="audit-list">{data.audit.slice(0, 12).map(a => <div key={a.id}><span className="audit-dot" /><span><strong>{a.actor}</strong> {a.action.toLowerCase()} {a.target_type} #{a.target_id}<small>{a.detail || '—'}</small></span><time>{date(a.created_at)}</time></div>)}</div></div></>;
}

function Detail({ data, complaint, recurrence, escalationEvents, reopenRequests, messages, onClose, refresh, showError }: { data: Snapshot; complaint: Complaint; recurrence: ComplaintDetail['recurrence']; escalationEvents: ComplaintDetail['escalationEvents']; reopenRequests: ComplaintDetail['reopenRequests']; messages: ComplaintDetail['messages']; onClose: () => void; refresh: () => Promise<void>; showError: (message: string) => void }) {
  const { language, t } = useLocale();
  const [note, setNote] = useState(''); const [departmentId, setDepartmentId] = useState(complaint.department_id ? String(complaint.department_id) : ''); const [priority, setPriority] = useState(complaint.priority);
  const [messageBody, setMessageBody] = useState(''); const [messageImage, setMessageImage] = useState<string | null>(null);
  const [rating, setRating] = useState(5); const [resolution, setResolution] = useState('Yes'); const [comment, setComment] = useState(''); const [completionImage, setCompletionImage] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const [reworkReason, setReworkReason] = useState('');
  const [nearby, setNearby] = useState<Array<{ id: number; code: string; title: string; distance: number }>>([]); const [duplicateId, setDuplicateId] = useState('');
  useEffect(() => { void request<typeof nearby>('nearby', { latitude: complaint.latitude, longitude: complaint.longitude, categoryId: complaint.category_id }).then(rows => setNearby(rows.filter(row => row.id !== complaint.id))).catch(() => setNearby([])); }, [complaint.id,complaint.category_id,complaint.latitude,complaint.longitude]);
  const updates = data.updates.filter(u => u.complaint_id === complaint.id);
  const cycles = data.cycles.filter(c => c.complaint_id === complaint.id);
  const latestCycle = cycles[0];
  const reviews = data.feedback.filter(f => f.complaint_id === complaint.id);
  const currentReviews = reviews.filter(f => f.cycle_id === latestCycle?.id);
  const average = currentReviews.length ? currentReviews.reduce((s,f) => s + f.rating,0)/currentReviews.length : null;
  const notResolved = currentReviews.length ? currentReviews.filter(f => f.resolution === 'No').length/currentReviews.length*100 : 0;
  const flagged = average !== null && (average < 3 || notResolved > 40);
  const canFeedback = data.user.role === 'citizen' && complaint.status === 'Awaiting Feedback' && !currentReviews.some(f => f.user_id === data.user.id);
  const perform = async (action: string, extra: Record<string, unknown> = {}) => { setBusy(true); try { await request('action', { id: complaint.id, action, note, ...extra }); setNote(''); setCompletionImage(null); await refresh(); } catch (error) { showError(String(error instanceof Error ? error.message : error)); } finally { setBusy(false); } };
  const sendFeedback = async (event: FormEvent) => { event.preventDefault(); setBusy(true); try { await request('feedback', { id: complaint.id, rating, resolution, comment }); setComment(''); await refresh(); } catch (error) { showError(String(error instanceof Error ? error.message : error)); } finally { setBusy(false); } };
  const askRework = async (event: FormEvent) => { event.preventDefault(); setBusy(true); try { await request('requestReopen', { id: complaint.id, reason: reworkReason }); setReworkReason(''); await refresh(); } catch (error) { showError(String(error instanceof Error ? error.message : error)); } finally { setBusy(false); } };
  const decideRework = async (requestId: number, decision: 'Approved' | 'Declined') => { setBusy(true); try { await request('decideReopen', { requestId, decision, note }); setNote(''); await refresh(); } catch (error) { showError(String(error instanceof Error ? error.message : error)); } finally { setBusy(false); } };
  const admin = ['admin','superadmin'].includes(data.user.role); const staff = data.user.role === 'staff' && complaint.department_id === data.user.departmentId;
  const canTalk = complaint.location_exact && (data.user.role === 'citizen' || admin || staff);
  const sendCaseMessage = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true);
    try { await request('caseMessage', { id: complaint.id, body: messageBody, image: messageImage }); setMessageBody(''); setMessageImage(null); await refresh(); }
    catch (error) { showError(String(error instanceof Error ? error.message : error)); }
    finally { setBusy(false); }
  };
  return <div className="drawer-backdrop" onClick={onClose}><aside className="detail-drawer" role="dialog" aria-modal="true" aria-label={`${complaint.code} ${t('Issue details')}`} onKeyDown={e => { if (e.key === 'Escape') onClose(); }} onClick={e => e.stopPropagation()}><div className="drawer-top"><div><span className="eyebrow">CASE {complaint.code}</span><h2>{t('Issue details')}</h2></div><div className="drawer-actions"><button type="button" className="icon-button" disabled={busy} onClick={() => { setBusy(true); void refresh().catch(error => showError(String(error))).finally(() => setBusy(false)); }} aria-label={t('Refresh case')} title={t('Refresh case')}><Activity size={18} /></button><button className="icon-button" onClick={onClose} aria-label={t('Close details')}><X size={20} /></button></div></div><div className="drawer-body"><div className="detail-heading"><div className="detail-icon"><MapPin size={24} /></div><h3>{complaint.title}</h3><p>{complaint.description}</p><div className="badge-row"><Badge value={complaint.status} /><Badge value={complaint.severity} type="severity" /></div></div>
    <div className="detail-grid"><div><small>{t('AREA')}</small><strong>{complaint.ward_code ? wardLabel(complaint.ward_code, language) : complaint.area}</strong></div><div><small>{t('CATEGORY')}</small><strong>{t(complaint.category)}</strong></div><div><small>{t('DEPARTMENT')}</small><strong>{complaint.department ? t(complaint.department) : t('Not assigned')}</strong></div><div><small>{t('PRIORITY')}</small><strong>{t(complaint.priority)}</strong></div><div><small>{t('REPORTED')}</small><strong>{date(complaint.created_at)}</strong></div><div><small>{t('PLACE')}</small><strong>{complaint.place_name || (complaint.location_exact ? t('Place name not recorded') : t('Approximate location'))}</strong></div><div><small>{t('LOCATION')}</small><strong>{complaint.latitude.toFixed(complaint.location_exact ? 6 : 3)}, {complaint.longitude.toFixed(complaint.location_exact ? 6 : 3)}</strong></div></div>
    <div className={`detail-section closure-panel ${closureState(complaint)?.overdue ? 'is-overdue' : ''}`}><h4>{t('Closure target')}</h4><strong>{closureState(complaint)?.label || t('Not applicable to this case status')}</strong>{complaint.resolution_due_at && !['Rejected','Duplicate'].includes(complaint.status) && <p>{language === 'bn' ? `লক্ষ্য: ${dateTime(complaint.resolution_due_at)}। নাগরিক কাজটি নিশ্চিত করলে সময়সীমার গণনা থামে। এরপর প্রধান প্রশাসক কাজটি সমাপ্ত হিসেবে নথিভুক্ত করেন।` : `Target: ${dateTime(complaint.resolution_due_at)}. The target stops when the citizen confirms the completed repair. The super administrator then files it as Finished work.`}</p>}</div>
    {complaint.recurrence_flag && <div className="detail-section recurrence-panel"><h4>{t('Possible recurring issue')}</h4><p>{language === 'bn' ? 'একই ধরনের একটি অভিযোগ ১০০ মিটারের মধ্যে গত ৯০ দিনে সমাপ্ত হয়েছিল। এটি মানুষের পর্যালোচনার জন্য চিহ্ন; অভিযোগটি স্বয়ংক্রিয়ভাবে বাতিল হয় না।' : 'A closed issue in the same category was reported within 100 metres and closed in the past 90 days. This flag needs human review; it does not mark this report as a duplicate.'}</p>{recurrence && <p><strong>{recurrence.code}</strong> · {recurrence.title} · {recurrence.closed_at ? `closed ${date(recurrence.closed_at)}` : 'reopened after the repeat report'}</p>}</div>}
    {complaint.image && <div className="detail-section"><h4>{t('Report evidence')}</h4><img src={complaint.image} alt="Citizen submitted evidence" /></div>}{complaint.completion_image && <div className="detail-section"><h4>{t('Completion evidence')}</h4><img src={complaint.completion_image} alt="Department completion evidence" /></div>}
    {cycles.length > 0 && <div className="detail-section"><h4>{t('Repair evidence by cycle')}</h4>{cycles.map(c => <div className="repair-evidence" key={c.id}><strong>{language === 'bn' ? 'পর্যায়' : 'Cycle'} {c.number} · {t(c.reopened_at ? 'Reopened' : c.closed_at ? 'Citizen confirmed' : 'Feedback open')}</strong><small>{language === 'bn' ? 'কাজ শেষ' : 'Completed'} {dateTime(c.resolved_at)}</small>{c.completion_note && <p>{c.completion_note}</p>}{c.completion_image && <img src={c.completion_image} alt={`Department repair photo, cycle ${c.number}`} />}</div>)}</div>}
    {latestCycle && <div className="detail-section"><h4>{t('Citizen review')}</h4><div className="feedback-summary"><strong>{average === null ? '—' : `${average.toFixed(1)}/5`}</strong><span>{currentReviews.length} {language === 'bn' ? 'নাগরিকের মতামত' : 'reporter response'}<br />{flagged ? `⚑ ${t('Needs administrative review')}` : t(complaint.status === 'Citizen Verified' ? 'Ready for super admin review' : complaint.status === 'Finished' ? 'Filed as Finished work' : 'Awaiting confirmation')}</span></div>{currentReviews.map(f => <div className="drawer-review" key={f.id}><strong>{f.author} · {'★'.repeat(f.rating)}</strong><small>{t(f.resolution)} {language === 'bn' ? 'সমাধান' : 'resolved'}</small><p>{f.comment}</p></div>)}</div>}
    {canFeedback && <form className="detail-section action-card" onSubmit={sendFeedback}><h4>{t('Verify the completed work')}</h4><p className="muted">{language === 'bn' ? 'বিভাগীয় কর্মী কাজ শেষ করেছেন। কাজটি দেখে নিশ্চিত করুন এবং রেটিং দিন।' : 'Department staff marked this repair complete. Confirm what you see and rate the work.'}</p><div className="star-picker" aria-label={language === 'bn' ? 'পাঁচ তারকার মধ্যে রেটিং' : 'Rating out of five stars'}>{[1,2,3,4,5].map(n => <button type="button" key={n} aria-label={`${n} star${n === 1 ? '' : 's'}`} aria-pressed={rating === n} className={n <= rating ? 'selected' : ''} onClick={() => setRating(n)}>★</button>)}<span>{rating}/5</span></div><label>{t('Was it resolved?')}<select value={resolution} onChange={e => setResolution(e.target.value)}>{['Yes','Partially','No'].map(x => <option key={x} value={x}>{t(x)}</option>)}</select></label><label>{t('Comment')}<textarea value={comment} onChange={e => setComment(e.target.value)} rows={3} placeholder={t('What changed on site?')} /></label><button className="primary" disabled={busy}>{t('Send verification and rating')}</button></form>}
    {reopenRequests.length > 0 && <div className="detail-section"><h4>{t('Rework requests')}</h4>{reopenRequests.map(item => <div className="repair-evidence" key={item.id}><strong>{t(item.status)} · {dateTime(item.created_at)}</strong><p>{item.reason}</p>{item.decision_note && <small>{t('Owner decision')}: {item.decision_note}</small>}{data.user.role === 'superadmin' && item.status === 'Pending' && <div className="action-row"><button className="primary" disabled={busy || note.trim().length < 5} onClick={() => void decideRework(item.id, 'Approved')}>{t('Approve rework')}</button><button className="secondary" disabled={busy || note.trim().length < 5} onClick={() => void decideRework(item.id, 'Declined')}>{t('Decline')}</button></div>}</div>)}</div>}
    {data.user.role === 'citizen' && complaint.status === 'Finished' && complaint.finished_at && Date.now() - utcTime(complaint.finished_at).getTime() <= 14 * 86400000 && !reopenRequests.some(item => item.status === 'Pending') && <form className="detail-section action-card" onSubmit={askRework}><h4>{t('Repair failed again?')}</h4><p className="muted">{language === 'bn' ? 'সমাপ্ত হওয়ার ১৪ দিনের মধ্যে সমস্যা আবার দেখা দিলে পুনরায় কাজের আবেদন করুন।' : 'Within 14 days of Finished work, ask the owner to review this case for rework.'}</p><label>{t('What failed again?')}<textarea minLength={12} required value={reworkReason} onChange={e => setReworkReason(e.target.value)} rows={3} /></label><button className="secondary" disabled={busy}>{t('Request rework review')}</button></form>}
    {admin && <div className="detail-section action-card"><h4>{t('Administrator actions')}</h4><label>{t('Note')}<textarea value={note} onChange={e => setNote(e.target.value)} rows={2} placeholder={t('Reason or instruction for the timeline')} /></label>{['Submitted','Under Review'].includes(complaint.status) && <><div className="action-row"><button className="primary" disabled={busy} onClick={() => void perform('verify')}><Check size={15} /> {t('Verify')}</button><button className="secondary danger" disabled={busy} onClick={() => void perform('reject')}>{t('Reject')}</button></div>{nearby.length > 0 && <><label>{t('Nearby report in the same category')}<select value={duplicateId} onChange={e => setDuplicateId(e.target.value)}><option value="">{t('Choose an original report')}</option>{nearby.map(row => <option key={row.id} value={row.id}>{row.code} · {row.title} ({row.distance} m)</option>)}</select></label><button className="secondary" disabled={busy || !duplicateId} onClick={() => void perform('duplicate', { duplicateOf: Number(duplicateId) })}>{t('Mark as duplicate')}</button></>}</>}{['Verified','Assigned','Reopened'].includes(complaint.status) && <><label>{t('Assign department')}<select value={departmentId} onChange={e => setDepartmentId(e.target.value)}><option value="">{t('Select department')}</option>{data.departments.filter(d => d.active).map(d => <option value={d.id} key={d.id}>{d.name}</option>)}</select></label><button className="primary" disabled={busy || !departmentId} onClick={() => void perform('assign', { departmentId: Number(departmentId) })}>{t('Assign department')}</button></>}
    <label>{t('Priority')}<select value={priority} onChange={e => setPriority(e.target.value)}>{['Normal','High','Urgent'].map(x => <option key={x} value={x}>{t(x)}</option>)}</select></label><button className="secondary" disabled={busy} onClick={() => void perform('priority', { priority })}>{t('Update priority')}</button>{complaint.recurrence_flag && <button className="secondary" disabled={busy || note.trim().length < 5} onClick={() => void perform('dismissRecurrence')}>{t('Dismiss recurrence flag')}</button>}
    {complaint.status === 'Citizen Verified' && data.user.role === 'superadmin' && <button className="primary" disabled={busy} onClick={() => void perform('finish')}>{t('Move to Finished work')}</button>}{['Awaiting Feedback','Citizen Verified','Closed'].includes(complaint.status) && <button className="secondary danger" disabled={busy || note.trim().length < 5} onClick={() => void perform('reopen')}>{t('Reopen case')}</button>}{complaint.status === 'Finished' && data.user.role === 'superadmin' && <button className="secondary danger" disabled={busy || note.trim().length < 5} onClick={() => void perform('reopen')}>{t('Reopen finished case')}</button>}</div>}
    {staff && ['Assigned','Reopened','In Progress'].includes(complaint.status) && <div className="detail-section action-card"><h4>{t('Department work')}</h4><label>{t('Work note')}<textarea value={note} onChange={e => setNote(e.target.value)} rows={3} placeholder={t('What has been done?')} /></label>{['Assigned','Reopened'].includes(complaint.status) && <button className="primary" disabled={busy} onClick={() => void perform('start')}>{t('Start work')}</button>}{complaint.status === 'In Progress' && <><button className="secondary" disabled={busy} onClick={() => void perform('progress')}>{t('Add progress note')}</button><label className="inline-upload"><Upload size={17} /> {t('Completion photo required')}<input type="file" accept="image/png,image/jpeg,image/webp" onChange={async e => { try { setCompletionImage(e.target.files?.[0] ? await readImage(e.target.files[0]) : null); } catch (err) { showError(String(err)); } }} /></label>{completionImage && <small className="success-text">{t('Photo ready to attach')}</small>}<button className="primary" disabled={busy || !completionImage || note.trim().length < 5} onClick={() => void perform('resolve', { image: completionImage })}>{t('Mark work completed')}</button></>}</div>}
    {canTalk && <section className="detail-section case-conversation"><h4>{t('Private case conversation')}</h4><p className="muted">{t('Only you, administrators and the assigned department can read this conversation.')}</p><div className="case-messages" role="log" aria-label={t('Private case conversation')}>{messages.length ? messages.map(item => <article key={item.id} className={item.sender_id === data.user.id ? 'mine' : ''}><div><strong>{item.sender_id === data.user.id ? (language === 'bn' ? 'আপনি' : 'You') : item.sender}</strong><time>{dateTime(item.created_at)}</time></div>{item.body && <p>{item.body}</p>}{item.image && <img src={item.image} alt={language === 'bn' ? 'কথোপকথনে যুক্ত ছবি' : 'Case conversation attachment'} />}</article>) : <p className="muted">{t('No messages yet. Ask a question or request another photo.')}</p>}</div><form className="case-message-form" onSubmit={sendCaseMessage}><label>{t('Write a message')}<textarea value={messageBody} onChange={event => setMessageBody(event.target.value)} maxLength={1000} rows={3} /></label><label className="case-photo-input">{t('Add a photo')}<input type="file" accept="image/png,image/jpeg,image/webp" onChange={async event => { try { setMessageImage(event.target.files?.[0] ? await readImage(event.target.files[0]) : null); } catch (error) { showError(String(error)); } }} /></label>{messageImage && <img className="preview-image" src={messageImage} alt={language === 'bn' ? 'ছবির প্রাকদর্শন' : 'Attachment preview'} />}<button className="primary" disabled={busy || (messageBody.trim().length < 3 && !messageImage)}>{busy ? t('Sending…') : t('Send message')}</button></form></section>}
    <div className="detail-section"><h4>{t('Activity timeline')}</h4><div className="timeline">{[...updates.map(u => ({ key: `u${u.id}`, action: u.action, actor: u.actor, note: u.note, created_at: u.created_at })),...escalationEvents.map(e => ({ key: `e${e.id}`, action: `Deadline ${e.stage.toLowerCase()}`, actor: 'CivicPulse', note: e.message, created_at: e.created_at }))].sort((a,b) => b.created_at.localeCompare(a.created_at)).map(u => <div key={u.key}><span className="timeline-point" /><div><strong>{t(u.action)}</strong><small>{u.actor} · {date(u.created_at)}</small>{u.note && <p>{u.note}</p>}</div></div>)}</div></div>
  </div></aside></div>;
}

export default function App() {
  const { language, setLanguage, t } = useLocale();
  const [user, setUser] = useState<User | null>(null); const [data, setData] = useState<Snapshot | null>(null);
  const [setupRequired, setSetupRequired] = useState(false);
  const [emailEnabled, setEmailEnabled] = useState(false); const [backupEnabled, setBackupEnabled] = useState(false);
  const [pushPublicKey, setPushPublicKey] = useState<string | null>(null);
  const [turnstileSiteKey, setTurnstileSiteKey] = useState<string | null>(null);
  const [accountLink, setAccountLink] = useState<{ purpose: 'verify' | 'reset'; token: string } | null>(() => { const match = location.hash.match(/^#(verify|reset)=([A-Za-z0-9_-]{43})$/); return match ? { purpose: match[1] as 'verify' | 'reset', token: match[2] } : null; });
  const [page, setPage] = useState<Page>('dashboard'); const [selectedId, setSelectedId] = useState<number | null>(null);
  const [selectedWard, setSelectedWard] = useState('');
  const [selectedScope, setSelectedScope] = useState('');
  const [reportLocation, setReportLocation] = useState<(MapPoint & { placeName: string }) | null>(null);
  const [detail, setDetail] = useState<ComplaintDetail | null>(null);
  const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const [busy, setBusy] = useState(false); const [loading, setLoading] = useState(true);
  const [signOutOpen, setSignOutOpen] = useState(false); const [signOutBusy, setSignOutBusy] = useState(false);
  const [refreshBusy, setRefreshBusy] = useState(false);
  const [lastRefresh, setLastRefresh] = useState('');
  const refresh = useCallback(async () => { const snapshot = await request<Snapshot>('snapshot'); setData(snapshot); setUser(snapshot.user); }, []);
  useEffect(() => {
    if (!user?.id) return;
    try {
      if (localStorage.getItem('civicpulse-language')) {
        if (user.language !== language) void request('setLanguage', { language }).catch(() => {});
      } else if (user.language === 'bn') setLanguage('bn');
    } catch { /* Language choice remains in memory. */ }
  }, [user?.id]);
  useEffect(() => { if (accountLink) history.replaceState(null, '', location.pathname + location.search); }, []);
  useEffect(() => { void Promise.all([request<{ setupRequired?: boolean; emailEnabled?: boolean; offsiteBackupEnabled?: boolean; pushPublicKey?: string | null; turnstileSiteKey?: string | null }>('config'), request<User | null>('session')]).then(async ([config, account]) => { setSetupRequired(Boolean(config.setupRequired)); setEmailEnabled(Boolean(config.emailEnabled)); setBackupEnabled(Boolean(config.offsiteBackupEnabled)); setPushPublicKey(config.pushPublicKey || null); setTurnstileSiteKey(config.turnstileSiteKey || null); if (account) { setUser(account); await refresh(); } }).catch(err => setError(String(err))).finally(() => setLoading(false)); }, [refresh]);
  useEffect(() => { if (user?.id && pushPublicKey && pushAvailable() && Notification.permission === 'granted') void enablePush(pushPublicKey).catch(() => {}); }, [user?.id,pushPublicKey]);
  useEffect(() => {
    if (!user?.id) return;
    let active = true;
    let lastCheck = Date.now();
    const update = () => {
      if (document.visibilityState !== 'visible' || Date.now() - lastCheck < 60_000) return;
      lastCheck = Date.now();
      void request<Snapshot>('snapshot').then(snapshot => { if (active && snapshot.user.id === user.id) setData(snapshot); }).catch(() => {});
      if (selectedId !== null) void request<ComplaintDetail>('complaintDetail', { id: selectedId }).then(next => { if (active) setDetail(next); }).catch(() => {});
    };
    const timer = window.setInterval(update, 300000);
    window.addEventListener('focus', update);
    document.addEventListener('visibilitychange', update);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener('focus', update); document.removeEventListener('visibilitychange', update); };
  }, [user?.id, selectedId]);
  useEffect(() => onNotice(message => { setNotice(message); setTimeout(() => setNotice(''), 4500); }), []);
  useEffect(() => { window.scrollTo(0, 0); }, [page, user?.id]);
  const login = async (email: string, password: string, code: string) => { setBusy(true); setError(''); try { const account = await request<User>('login', { email, password, code }); setUser(account); setPage('dashboard'); setSelectedId(null); await refresh(); } catch (err) { setError(String(err instanceof Error ? err.message : err)); } finally { setBusy(false); } };
  const register = async (details: { name: string; email: string; area: string; password: string }) => { setBusy(true); setError(''); try { const account = await request<User>('register', details); setUser(account); setPage('dashboard'); await refresh(); } catch (err) { setError(String(err instanceof Error ? err.message : err)); } finally { setBusy(false); } };
  const setup = async (details: { key: string; name: string; email: string; password: string }) => { setBusy(true); setError(''); try { const account = await request<User>('bootstrap', details); setUser(account); setSetupRequired(false); await refresh(); } catch (err) { setError(String(err instanceof Error ? err.message : err)); } finally { setBusy(false); } };
  const logout = async () => { setSignOutBusy(true); try { await request('logout'); setSignOutOpen(false); setUser(null); setData(null); setPage('dashboard'); setSelectedId(null); setDetail(null); setError(''); } catch (err) { showError(String(err instanceof Error ? err.message : err)); } finally { setSignOutBusy(false); } };
  const showError = (message: string) => { setError(message); setTimeout(() => setError(''), 7000); };
  const forgot = async (email: string) => { setBusy(true); setError(''); try { await request('forgotPassword', { email }); return true; } catch (err) { setError(String(err instanceof Error ? err.message : err)); return false; } finally { setBusy(false); } };
  const recoverWithCode = async (code: string, newPassword: string) => { setBusy(true); setError(''); try { await request('recoverWithCode', { code, newPassword }); return true; } catch (err) { setError(String(err instanceof Error ? err.message : err)); return false; } finally { setBusy(false); } };
  const refreshNow = async () => { if (refreshBusy) return; setRefreshBusy(true); setLastRefresh(''); try { await refresh(); window.dispatchEvent(new Event('civic:refresh')); if (selectedId !== null) setDetail(await request<ComplaintDetail>('complaintDetail', { id: selectedId })); setLastRefresh(`Updated ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`); setNotice('Shared reports refreshed.'); setTimeout(() => setNotice(''), 4000); } catch (err) { showError(String(err instanceof Error ? err.message : err)); setLastRefresh('Refresh failed'); } finally { setRefreshBusy(false); } };
  const open = (id: number) => { setSelectedId(id); setDetail(null); void request<ComplaintDetail>('complaintDetail', { id }).then(setDetail).catch(err => showError(String(err))); };
  const refreshDetail = async () => { await refresh(); if (selectedId !== null) setDetail(await request<ComplaintDetail>('complaintDetail', { id: selectedId })); };
  const selected = detail?.complaint && detail.complaint.id === selectedId ? detail.complaint : null;
  const nav = useMemo(() => {
    const base: Array<[Page,string,ReactNode]> = [['dashboard','Overview',<LayoutDashboard size={19} />],['complaints','Complaints',<FileText size={19} />]];
    if (user?.role === 'citizen') base.push(['report','Report an issue',<Plus size={19} />]);
    base.push(['notifications','Notifications',<Bell size={19} />]);
    base.push(['map','Issue map',<MapIcon size={19} />],['feedback','Community feedback',<MessageSquare size={19} />],['analytics','Analytics',<BarChart3 size={19} />]);
    if (user?.role === 'superadmin') base.push(['performance','Finished work',<BarChart3 size={19} />],['manage','Administration',<Settings size={19} />]);
    base.push(['profile','Account security',<ShieldCheck size={19} />]);
    return base;
  }, [user?.role]);
  if (loading) return <div className="loading-screen"><div className="loading-logo"><Activity size={35} /></div><span>{t('Loading CivicPulse…')}</span></div>;
  if (accountLink) return <AccountLink purpose={accountLink.purpose} token={accountLink.token} onDone={() => { const wasReset = accountLink.purpose === 'reset'; setAccountLink(null); if (wasReset) { setUser(null); setData(null); } else if (user) void refresh(); }} />;
  if (setupRequired) return <OwnerSetup onSetup={setup} busy={busy} error={error} />;
  if (!user || !data) return <Login onLogin={login} onRegister={register} onForgot={forgot} onRecoverCode={recoverWithCode} emailEnabled={emailEnabled} turnstileSiteKey={turnstileSiteKey} busy={busy} error={error} />;
  return <div className="shell"><aside className="sidebar"><div className="brand"><span className="brand-mark"><MapPin size={20} /></span><span>CivicPulse</span></div><div className="workspace-label">{t('WORKSPACE')}</div><nav>{nav.map(([key,label,icon]) => <button key={key} className={page === key ? 'active' : ''} onClick={() => { if (key === 'report') setReportLocation(null); if (key === 'complaints') { setSelectedWard(''); setSelectedScope(''); } setPage(key); setSelectedId(null); }} aria-label={t(label)} title={t(label)}>{icon}<span>{t(label)}</span>{key === 'notifications' && data.notifications.filter(item => !item.read_at).length > 0 && <i className="nav-count">{data.notifications.filter(item => !item.read_at).length}</i>}{key === 'complaints' && (data.summary.counts.pending || 0) > 0 && ['admin','superadmin'].includes(user.role) && <i className="nav-count">{data.summary.counts.pending || 0}</i>}</button>)}</nav><div className="sidebar-bottom"><div className="sidebar-tip"><span><Activity size={17} /> {t('DHAKA SIGNAL')}</span><strong>{data.summary.counts.open || 0} {t('active reports')}</strong><small>{t('In the Dhaka service area')}</small></div><button className="profile-mini" onClick={() => setSignOutOpen(true)} title={t('Sign out')} aria-label={t('Sign out')}><span className="profile-avatar">{user.name[0]}</span><span><strong>{user.name}</strong><small>{t(roleName[user.role])}</small></span><LogOut size={17} /></button></div></aside><div className="main-area"><header className="topbar"><div className="breadcrumb">CivicPulse <span>/</span> <strong>{t(nav.find(n => n[0] === page)?.[1] || '')}</strong></div><div className="top-actions"><LanguageToggle signedIn /><button type="button" className="notification-trigger" onClick={() => setPage('notifications')} aria-label={`${data.notifications.filter(item => !item.read_at).length} unread notifications`}><Bell size={17} /> {data.notifications.filter(item => !item.read_at).length} {t('unread')}</button>{user.role !== 'citizen' && <span className="today">{user.role === 'superadmin' ? (data.summary.counts.citizen_verified || 0) + ' ' + t('ready to finish') : (data.summary.counts.pending || 0) + ' ' + t('new reports')}</span>}<span className="top-date">{new Date().toLocaleDateString(language === 'bn' ? 'bn-BD' : 'en-GB', { weekday: 'short', day: 'numeric', month: 'long' })}</span><span className="refresh-status" role="status" aria-live="polite">{lastRefresh}</span><button type="button" className="refresh-button" disabled={refreshBusy} onClick={() => void refreshNow()} title={t('Refresh')}><Activity size={15} /> {refreshBusy ? (language === 'bn' ? 'নতুন তথ্য আনা হচ্ছে…' : 'Refreshing…') : t('Refresh')}</button><button type="button" className="top-avatar" aria-label={t('Account security')} title={t('Account security')} onClick={() => { setPage('profile'); setSelectedId(null); }}>{user.name[0]}</button></div></header><main className="content">
    {page === 'dashboard' && <Dashboard data={data} onPage={setPage} onOpen={open} onWard={code => { setSelectedWard(code); setSelectedScope(''); setPage('complaints'); }} onFilter={scope => { setSelectedWard(''); setSelectedScope(scope); setPage('complaints'); }} />}
    {page === 'complaints' && <Complaints data={data} onOpen={open} initialWard={selectedWard} initialScope={selectedScope} />}
    {page === 'report' && <Report data={data} showError={showError} turnstileSiteKey={turnstileSiteKey} initialLocation={reportLocation} onCreated={async id => { setReportLocation(null); await refresh(); setPage('complaints'); open(id); setNotice('Complaint submitted successfully.'); setTimeout(() => setNotice(''), 5000); }} />}
    {page === 'notifications' && <NotificationsPage data={data} onOpen={open} refresh={refresh} showError={showError} />}
    {page === 'map' && <MapPage data={data} onOpen={open} showError={showError} onReportAt={location => { setReportLocation(location); setPage('report'); }} />}
    {page === 'feedback' && <FeedbackPage data={data} onOpen={open} />}
    {page === 'analytics' && <Analytics data={data} onFilter={scope => { setSelectedScope(scope); setSelectedWard(''); setPage('complaints'); }} />}
    {page === 'performance' && user.role === 'superadmin' && <PerformancePage data={data} onPage={setPage} onOpen={open} onFilter={scope => { setSelectedScope(scope); setSelectedWard(''); setPage('complaints'); }} showError={showError} />}
    {page === 'profile' && <Profile user={user} showError={showError} emailEnabled={emailEnabled} pushPublicKey={pushPublicKey} privacyRequest={data.privacyRequest} refresh={refresh} />}
    {page === 'manage' && user.role === 'superadmin' && <Manage data={data} refresh={refresh} showError={showError} backupEnabled={backupEnabled} />}
    {['admin','superadmin'].includes(user.role) && <div className="export-bar"><span>{t('Need a copy of the current data?')}</span><button className="secondary" onClick={() => void request('exportCsv').catch(err => showError(String(err)))}><Download size={16} /> {t('Export CSV')}</button><button className="secondary" onClick={() => void request('exportPdf').catch(err => showError(String(err)))}><Download size={16} /> {t('Save PDF')}</button></div>}
  </main></div>{selected && detail && <Detail key={`${selected.id}-${user.id}`} data={{ ...data, updates: detail.updates, cycles: detail.cycles, feedback: detail.feedback }} complaint={selected} messages={detail.messages || []} recurrence={detail.recurrence} escalationEvents={detail.escalationEvents || []} reopenRequests={detail.reopenRequests || []} onClose={() => { setSelectedId(null); setDetail(null); }} refresh={refreshDetail} showError={showError} />}{error && <div className="toast error-toast" role="alert"><Flag size={17} /> {error}<button onClick={() => setError('')} aria-label={t('Dismiss error')}><X size={15} /></button></div>}{notice && <div className="toast success-toast" role="status"><Check size={17} /> {notice}</div>}{signOutOpen && <div className="confirm-backdrop" onClick={() => !signOutBusy && setSignOutOpen(false)}><div className="confirm-card" role="dialog" aria-modal="true" aria-labelledby="signout-title" onClick={event => event.stopPropagation()}><span className="eyebrow">{t('ACCOUNT')}</span><h2 id="signout-title">{t('Sign out of CivicPulse?')}</h2><p>{t('You can sign in again to continue your work.')}</p><div className="confirm-actions"><button type="button" className="secondary" disabled={signOutBusy} onClick={() => setSignOutOpen(false)}>{t('Stay signed in')}</button><button type="button" className="primary" disabled={signOutBusy} onClick={() => void logout()}>{t(signOutBusy ? 'Signing out…' : 'Sign out')}</button></div></div></div>}</div>;
}
