import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  Activity, ArrowRight, BarChart3, Bell, Check, ChevronDown, CircleHelp, ClipboardCheck,
  Download, FileText, Filter, Flag, LayoutDashboard, LogOut, Map as MapIcon, MapPin,
  MessageSquare, Plus, Search, Settings, ShieldCheck, Sparkles, Upload, Users, X
} from 'lucide-react';
import { onNotice, request } from './api';
import { downloadEncryptedBackup } from './backup';
import { IssueMap, LocationPicker } from './MapViews';
import type { Category, Complaint, ComplaintDetail, Department, Feedback, PageResult, PublicSnapshot, Snapshot, User } from './types';

type Page = 'dashboard' | 'complaints' | 'report' | 'map' | 'feedback' | 'analytics' | 'manage' | 'profile';
const date = (value: string) => new Date(value.replace(' ', 'T') + (value.includes('Z') ? '' : 'Z')).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const roleName: Record<string, string> = { citizen: 'Citizen', staff: 'Department staff', admin: 'Administrator', superadmin: 'Super administrator' };
const severityClass = (severity: string) => severity.toLowerCase().replaceAll(' ', '-');

function Badge({ value, type = 'status' }: { value: string; type?: 'status' | 'severity' }) {
  return <span className={`badge ${type}-${severityClass(value)}`}>{value}</span>;
}
function SectionHeading({ eyebrow, title, right }: { eyebrow: string; title: string; right?: ReactNode }) {
  return <div className="section-heading"><div><span className="eyebrow">{eyebrow}</span><h2>{title}</h2></div>{right}</div>;
}
function Empty({ title, text }: { title: string; text: string }) {
  return <div className="empty"><CircleHelp size={27} /><strong>{title}</strong><p>{text}</p></div>;
}
function StatCard({ icon, label, value, foot, tone = 'mint' }: { icon: ReactNode; label: string; value: string | number; foot?: string; tone?: string }) {
  return <div className={`stat-card tone-${tone}`}><div className="stat-icon">{icon}</div><div className="stat-value">{value}</div><div className="stat-label">{label}</div>{foot && <div className="stat-foot">{foot}</div>}</div>;
}
function ComplaintList({ items, onOpen, compact = false }: { items: Complaint[]; onOpen: (id: number) => void; compact?: boolean }) {
  if (!items.length) return <Empty title="No issues here yet" text="Reports will appear as soon as they are submitted." />;
  return <div className="complaint-list">{items.map(c => <button className="complaint-row" key={c.id} onClick={() => onOpen(c.id)}>
    <span className={`row-icon ${severityClass(c.severity)}`}><MapPin size={18} /></span>
    <span className="row-main"><strong>{c.title}</strong><small>{c.code} <span>·</span> {c.area} <span>·</span> {c.category}</small></span>
    {!compact && <span className="row-date">{date(c.created_at)}</span>}
    <Badge value={c.status} /><ArrowRight size={16} className="row-arrow" />
  </button>)}</div>;
}
function Login({ onLogin, onRegister, onExplore, busy, error }: { onLogin: (email: string, password: string) => Promise<void>; onRegister: (details: { name: string; email: string; area: string; password: string }) => Promise<void>; onExplore: () => void; busy: boolean; error: string }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [area, setArea] = useState('');
  const [registering, setRegistering] = useState(false);
  return <div className="login-screen"><div className="login-left"><div className="brand"><span className="brand-mark"><MapPin size={20} /></span><span>CivicPulse</span></div>
    <div className="login-art"><div className="orbit orbit-one" /><div className="orbit orbit-two" /><span className="art-pin pin-a"><MapPin /></span><span className="art-pin pin-b"><MapPin /></span><span className="art-pin pin-c"><MapPin /></span><span className="art-center"><Activity size={48} /></span></div>
    <div className="login-copy"><span className="eyebrow">A clearer view of Dhaka</span><h1>Every report moves Dhaka forward.</h1><p>Follow Dhaka city issues from first report to community-verified resolution.</p></div>
    <div className="login-proof"><span><Check size={16} /> Public issue map</span><span><Check size={16} /> Traceable progress</span><span><Check size={16} /> Community feedback</span></div>
  </div><div className="login-right"><div className="login-box"><span className="eyebrow">CIVIC ISSUE TRACKER</span><h2>{registering ? 'Join your community' : 'Welcome back'}</h2><p className="muted">{registering ? 'Create a citizen account to report issues and track progress.' : 'Sign in to report, manage, or review local issues.'}</p>
    <form onSubmit={e => { e.preventDefault(); if (registering) void onRegister({ name, email, area, password }); else void onLogin(email,password); }}>
      {registering && <label>Full name<input value={name} onChange={e => setName(e.target.value)} minLength={2} maxLength={80} required /></label>}
      <label>Email address<input type="email" value={email} onChange={e => setEmail(e.target.value)} required /></label>
      {registering && <label>Your Dhaka neighborhood<input value={area} onChange={e => setArea(e.target.value)} minLength={2} maxLength={100} placeholder="e.g. Dhanmondi" required /></label>}
      <label>Password<input type="password" value={password} onChange={e => setPassword(e.target.value)} minLength={registering ? 10 : undefined} required /></label>
      {registering && <p className="muted">Email ownership is not verified yet. Use an address you control and avoid entering sensitive details in public report titles.</p>}{error && <div className="error-box">{error}</div>}<button className="primary full" disabled={busy}>{busy ? 'Please wait…' : registering ? 'Create citizen account' : 'Sign in'} <ArrowRight size={17} /></button></form>
    <div className="login-links"><button type="button" onClick={() => { setRegistering(!registering); setPassword(''); }}>{registering ? 'Already have an account? Sign in' : 'New citizen? Create an account'}</button><button type="button" onClick={onExplore}>Browse public issues</button></div>
    </div></div></div>;
}

function OwnerSetup({ onSetup, busy, error }: { onSetup: (details: { key: string; name: string; email: string; password: string }) => Promise<void>; busy: boolean; error: string }) {
  const [key, setKey] = useState(''); const [name, setName] = useState(''); const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  return <div className="setup-screen"><div className="setup-card"><div className="brand"><span className="brand-mark"><MapPin size={20} /></span><span>CivicPulse Dhaka</span></div><span className="eyebrow">FIRST TIME SETUP</span><h1>Set up the Dhaka workspace</h1><p className="muted">The project owner creates the first administrator account. Keep the setup key private.</p><form onSubmit={e => { e.preventDefault(); void onSetup({ key, name, email, password }); }}><label>Setup key<input type="password" value={key} onChange={e => setKey(e.target.value)} required /></label><label>Your name<input value={name} onChange={e => setName(e.target.value)} minLength={3} required /></label><label>Your email<input type="email" value={email} onChange={e => setEmail(e.target.value)} required /></label><label>Password<input type="password" value={password} onChange={e => setPassword(e.target.value)} minLength={12} required /></label>{error && <div className="error-box">{error}</div>}<button className="primary full" disabled={busy}>{busy ? 'Setting up…' : 'Create owner account'} <ArrowRight size={17} /></button></form></div></div>;
}

function PublicIssues({ initial, onBack }: { initial: PublicSnapshot; onBack: () => void }) {
  const [page, setPage] = useState(initial);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [query, setQuery] = useState('');
  const queryRef = useRef(query); queryRef.current = query;
  const [mode, setMode] = useState<'markers' | 'heat'>('markers');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!query) { setPage(initial); return; }
    let cancelled = false;
    const timer = setTimeout(() => { void request<PublicSnapshot>('publicSnapshot', { query }).then(result => { if (!cancelled) setPage(result); }).catch(() => {}); }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [query, initial]);
  const loadMore = async () => {
    if (!page.nextCursor || busy) return;
    setBusy(true);
    try { const more = await request<PublicSnapshot>('publicSnapshot', { query, cursor: page.nextCursor }); if (queryRef.current === query) setPage(current => ({ ...current, complaints: [...current.complaints, ...more.complaints], nextCursor: more.nextCursor, total: more.total })); }
    finally { setBusy(false); }
  };
  const selected = page.complaints.find(c => c.id === selectedId);
  return <div className="public-page"><header className="public-header"><div className="brand"><span className="brand-mark"><MapPin size={20} /></span><span>CivicPulse Dhaka</span></div><button className="secondary" onClick={onBack}>Sign in or report <ArrowRight size={16} /></button></header><main className="public-content">
    <div className="public-hero"><span className="eyebrow">DHAKA CITY ISSUE BOARD</span><h1>See what is happening in Dhaka.</h1><p>Browse Dhaka city reports, their locations, and the progress made so far.</p><p className="public-disclaimer">Independent project prototype. Reports are not automatically sent to DNCC or DSCC.</p><div className="public-stats"><span><strong>{page.total}</strong> matching reports</span><span><strong>{page.complaints.length}</strong> currently loaded</span></div></div>
    <div className="public-toolbar"><div className="search-box"><Search size={18} /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search issue, category, or Dhaka area" aria-label="Search public issues" /></div><div className="segmented"><button className={mode === 'markers' ? 'active' : ''} onClick={() => setMode('markers')}>Pins</button><button className={mode === 'heat' ? 'active' : ''} onClick={() => setMode('heat')}>Density</button></div></div>
    <IssueMap complaints={page.complaints} mode={mode} onOpen={setSelectedId} /><p className="method-note">Map shows the reports loaded below. Load more to see older reports.</p>
    <div className="public-cards">{page.complaints.map(c => <button className="public-card" key={c.id} onClick={() => setSelectedId(c.id)}><span className="eyebrow">{c.code} · {c.category}</span><h3>{c.title}</h3><div><span><MapPin size={14} /> {c.area}</span><Badge value={c.status} /></div></button>)}</div>
    {!page.complaints.length && <Empty title="No matching reports" text="Try another Dhaka area or issue type." />}
    {page.nextCursor && <button className="secondary load-more" onClick={() => void loadMore()} disabled={busy}>{busy ? 'Loading…' : `Load more (${page.complaints.length} of ${page.total})`}</button>}
  </main>{selected && <div className="drawer-backdrop" onClick={() => setSelectedId(null)}><aside className="detail-drawer" onClick={e => e.stopPropagation()}><div className="drawer-top"><div><span className="eyebrow">{selected.code}</span><h2>{selected.title}</h2></div><button className="icon-button" onClick={() => setSelectedId(null)} aria-label="Close details"><X size={20} /></button></div><div className="drawer-body"><div className="detail-grid"><div><small>STATUS</small><strong>{selected.status}</strong></div><div><small>AREA</small><strong>{selected.area}</strong></div><div><small>CATEGORY</small><strong>{selected.category}</strong></div><div><small>DEPARTMENT</small><strong>{selected.department || 'Unassigned'}</strong></div><div><small>REPORTED</small><strong>{date(selected.created_at)}</strong></div></div><p className="muted">Sign in to report an issue or review completed work.</p><button className="primary" onClick={onBack}>Sign in <ArrowRight size={16} /></button></div></aside></div>}</div>;
}

function Dashboard({ data, onPage, onOpen }: { data: Snapshot; onPage: (page: Page) => void; onOpen: (id: number) => void }) {
  const { user, complaints, summary } = data;
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
    ['Visible reports', summary.counts.total, <MapPin size={20} />, 'violet']
  ] as const : [
    ['Total reports', user.role === 'staff' ? summary.assigned?.total || 0 : summary.counts.total, <FileText size={20} />, 'mint'],
    ['Open issues', user.role === 'staff' ? summary.assigned?.open || 0 : summary.counts.open || 0, <Activity size={20} />, 'amber'],
    [user.role === 'staff' ? 'Completed' : 'Needs verification', user.role === 'staff' ? summary.assigned?.resolved || 0 : summary.counts.pending || 0, <ClipboardCheck size={20} />, 'blue'],
    ['Critical alerts', summary.counts.critical || 0, <Flag size={20} />, 'rose']
  ] as const;
  const categoryCounts = summary.categories.map(row => ({ name: data.categories.find(cat => cat.id === row.id)?.name || 'Other', count: row.count })).slice(0, 5);
  return <><div className="hero"><div><span className="eyebrow"><Sparkles size={14} /> DHAKA OPERATIONS, IN ONE PLACE</span><h1>Good {new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 17 ? 'afternoon' : 'evening'}, {user.name.split(' ')[0]}.</h1><p>{user.role === 'citizen' ? 'See what is happening around you, and follow every report through to a real result.' : user.role === 'staff' ? 'Stay on top of assigned work and keep residents informed.' : 'Your Dhaka overview is ready. Review new reports and keep work moving.'}</p><div className="hero-actions"><button className="primary" onClick={() => onPage(user.role === 'citizen' ? 'report' : 'complaints')}>{user.role === 'citizen' ? <Plus size={18} /> : <ClipboardCheck size={18} />}{user.role === 'citizen' ? 'Report an issue' : 'Review complaints'}</button><button className="secondary" onClick={() => onPage('map')}><MapIcon size={18} /> Explore map</button></div></div><div className="hero-visual"><div className="visual-grid" /><span className="pulse-dot dot-one" /><span className="pulse-dot dot-two" /><span className="pulse-dot dot-three" /><div className="visual-label"><Activity size={17} /> Live Dhaka signal</div></div></div>
  <div className="stat-grid">{highlights.map(([label,value,icon,tone]) => <StatCard key={label} label={label} value={value} icon={icon} tone={tone} />)}</div>
  <div className="two-col"><div className="card"><SectionHeading eyebrow="RECENT ACTIVITY" title={user.role === 'citizen' ? 'Your reports' : 'Latest complaints'} right={<button className="text-button" onClick={() => onPage('complaints')}>View all <ArrowRight size={15} /></button>} /><ComplaintList items={recent} onOpen={onOpen} compact /></div>
  <div className="card"><SectionHeading eyebrow="DHAKA SNAPSHOT" title="Issues by category" right={<button className="text-button" onClick={() => onPage('analytics')}>Explore <ArrowRight size={15} /></button>} /><div className="bar-list">{categoryCounts.map((item,i) => <div className="bar-row" key={item.name}><span>{item.name}</span><div className="bar-track"><i style={{ width: `${Math.max(8,item.count/Math.max(1,categoryCounts[0].count)*100)}%`, background: ['#66dbc3','#82b7ff','#ffc883','#bca5ff','#ff9e9d'][i] }} /></div><strong>{item.count}</strong></div>)}</div><div className="insight-note"><MapPin size={17} /> {summary.counts.total} reports visible to your role.</div></div></div></>;
}

function Complaints({ data, onOpen }: { data: Snapshot; onOpen: (id: number) => void }) {
  const [query, setQuery] = useState(''); const [status, setStatus] = useState('All statuses'); const [scope, setScope] = useState('All issues');
  const filterKey = `${query}\u0000${status}\u0000${scope}`; const filterRef = useRef(filterKey); filterRef.current = filterKey;
  const [page, setPage] = useState({ complaints: data.complaints, nextCursor: data.nextCursor, total: data.summary.counts.total });
  const [busy, setBusy] = useState(false);
  const scopes = data.user.role === 'citizen' ? ['All issues','My reports','My area'] : data.user.role === 'staff' ? ['Assigned to my department','All issues'] : ['All issues','Needs verification','Awaiting feedback'];
  useEffect(() => setScope(scopes[0]), [data.user.role]);
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => { void request<typeof page>('listComplaints', { query, scope, status }).then(result => { if (!cancelled) setPage(result); }).catch(() => {}); }, query ? 250 : 0);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [query, scope, status, data.user.id, data.summary.counts.total]);
  const loadMore = async () => {
    if (!page.nextCursor || busy) return;
    setBusy(true);
    try { const more = await request<typeof page>('listComplaints', { query, scope, status, cursor: page.nextCursor }); if (filterRef.current === filterKey) setPage(current => ({ complaints: [...current.complaints, ...more.complaints], nextCursor: more.nextCursor, total: more.total })); }
    finally { setBusy(false); }
  };
  return <><SectionHeading eyebrow="CASE MANAGEMENT" title="Complaints" right={<span className="count-pill">{page.total} reports</span>} /><div className="filter-card"><div className="search-box"><Search size={18} /><input placeholder="Search by title, ID, area, category…" value={query} onChange={e => setQuery(e.target.value)} /></div><div className="select-wrap"><Filter size={17} /><select value={scope} onChange={e => setScope(e.target.value)}>{scopes.map(x => <option key={x}>{x}</option>)}</select></div><div className="select-wrap"><ChevronDown size={17} /><select value={status} onChange={e => setStatus(e.target.value)}>{['All statuses','Submitted','Verified','Assigned','In Progress','Awaiting Feedback','Closed','Reopened','Rejected'].map(x => <option key={x}>{x}</option>)}</select></div></div><div className="card list-card"><ComplaintList items={page.complaints} onOpen={onOpen} /></div>{page.nextCursor && <button className="secondary load-more" disabled={busy} onClick={() => void loadMore()}>{busy ? 'Loading…' : `Load more (${page.complaints.length} of ${page.total})`}</button>}</>;
}

function readImage(file: File): Promise<string> {
  return new Promise((resolve,reject) => {
    if (!['image/png','image/jpeg','image/webp'].includes(file.type) || file.size > 2_000_000) return reject(new Error('Choose a PNG, JPEG or WebP image under 2 MB.'));
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      for (const [limit, quality] of [[1200,.78],[960,.67],[760,.55]] as const) {
        const scale = Math.min(1, limit / Math.max(image.naturalWidth, image.naturalHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        canvas.getContext('2d')?.drawImage(image, 0, 0, canvas.width, canvas.height);
        const result = canvas.toDataURL('image/webp', quality);
        if (result.length < 600000) return resolve(result);
      }
      reject(new Error('This image is too detailed. Choose a smaller photo.'));
    };
    image.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error('Could not read image.')); };
    image.src = objectUrl;
  });
}

function Report({ data, onCreated, showError }: { data: Snapshot; onCreated: (id: number) => void; showError: (message: string) => void }) {
  const [title, setTitle] = useState(''); const [description, setDescription] = useState(''); const [categoryId, setCategoryId] = useState(0);
  const [severity, setSeverity] = useState('Medium'); const [area, setArea] = useState(data.user.area || 'Dhanmondi');
  const [point, setPoint] = useState<{ latitude: number; longitude: number } | null>(null); const [image, setImage] = useState<string | null>(null);
  const [nearby, setNearby] = useState<Array<{ id: number; code: string; title: string; status: string; distance: number }>>([]); const [busy, setBusy] = useState(false);
  useEffect(() => { if (point && categoryId) void request<typeof nearby>('nearby', { ...point, categoryId }).then(setNearby).catch(() => setNearby([])); else setNearby([]); }, [point,categoryId]);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (!point) return showError('Click the map to choose a location.');
    setBusy(true); try { const id = await request<number>('create', { title, description, categoryId, severity, area, ...point, image }); onCreated(id); }
    catch (error) { showError(String(error instanceof Error ? error.message : error)); } finally { setBusy(false); }
  };
  return <><SectionHeading eyebrow="HELP YOUR NEIGHBORHOOD" title="Report an issue" /><div className="report-layout"><form className="card report-form" onSubmit={submit}><div className="form-intro"><span className="step">01</span><div><h3>Tell us what happened</h3><p>A clear report helps the right team respond quickly.</p></div></div><div className="form-grid"><label className="wide">Issue title<input value={title} onChange={e => setTitle(e.target.value)} minLength={6} maxLength={120} placeholder="e.g. Large pothole near the main crossing" required /></label><label className="wide">Description<textarea value={description} onChange={e => setDescription(e.target.value)} minLength={12} rows={4} placeholder="Describe the problem and anything residents should know…" required /></label><label>Category<select value={categoryId} onChange={e => setCategoryId(Number(e.target.value))} required><option value={0}>Choose category</option>{data.categories.filter(c => c.active).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label>Severity<select value={severity} onChange={e => setSeverity(e.target.value)}>{['Low','Medium','High','Critical'].map(x => <option key={x}>{x}</option>)}</select></label><label className="wide">Dhaka neighborhood<input value={area} onChange={e => setArea(e.target.value)} required /></label></div>
    <div className="form-intro middle"><span className="step">02</span><div><h3>Pin the exact location</h3><p>Click on a location inside Dhaka city.</p></div></div><LocationPicker value={point} onPick={(latitude, longitude) => setPoint({ latitude, longitude })} />{point && <div className="coordinate"><MapPin size={15} /> {point.latitude.toFixed(5)}, {point.longitude.toFixed(5)}</div>}
    {nearby.length > 0 && <div className="duplicate-warning"><strong>Similar reports nearby</strong><p>Someone may already have reported this issue. You can still submit a new report.</p>{nearby.map(item => <div key={item.id}>{item.code} · {item.title} · {item.distance} m · {item.status}</div>)}</div>}
    <div className="form-intro middle"><span className="step">03</span><div><h3>Add evidence</h3><p>One photo helps the team identify the issue.</p></div></div><label className="upload-box"><Upload size={22} /><strong>{image ? 'Photo attached' : 'Choose a photo'}</strong><small>PNG, JPEG or WebP · maximum 2 MB</small><input type="file" accept="image/png,image/jpeg,image/webp" onChange={async e => { try { setImage(e.target.files?.[0] ? await readImage(e.target.files[0]) : null); } catch (err) { showError(String(err)); } }} /></label>{image && <img className="preview-image" src={image} alt="Complaint evidence preview" />}
    <button className="primary submit-report" disabled={busy}>{busy ? 'Submitting…' : 'Submit complaint'} <ArrowRight size={18} /></button></form><aside className="report-aside"><div className="card aside-card"><div className="aside-icon"><ShieldCheck size={23} /></div><h3>What happens next?</h3><div className="mini-timeline"><span>1</span><p>An administrator verifies your report.</p><span>2</span><p>The responsible department receives it.</p><span>3</span><p>You can follow updates and review completed work.</p></div></div><div className="aside-tip"><MapPin size={19} /><p>Your report appears on the Dhaka issue map after administrator verification. Its public location is approximate. Avoid personal details in the title and photos.</p></div></aside></div></>;
}

function MapPage({ data, onOpen }: { data: Snapshot; onOpen: (id: number) => void }) {
  const [mode, setMode] = useState<'markers' | 'heat'>('markers'); const [category, setCategory] = useState('All categories'); const [status, setStatus] = useState('All statuses');
  const [page, setPage] = useState({ complaints: data.complaints, nextCursor: data.nextCursor, total: data.summary.counts.total });
  const [busy, setBusy] = useState(false);
  const filtered = page.complaints.filter(c => (category === 'All categories' || c.category === category) && (status === 'All statuses' || c.status === status));
  const loadMore = async () => { if (!page.nextCursor || busy) return; setBusy(true); try { const more = await request<typeof page>('listComplaints', { cursor: page.nextCursor }); setPage(current => ({ complaints: [...current.complaints, ...more.complaints], nextCursor: more.nextCursor, total: more.total })); } finally { setBusy(false); } };
  return <><SectionHeading eyebrow="GEOGRAPHIC INTELLIGENCE" title="Explore Dhaka" right={<span className="count-pill"><MapPin size={15} /> Dhaka, Bangladesh</span>} /><div className="map-toolbar"><div className="segmented"><button className={mode === 'markers' ? 'active' : ''} onClick={() => setMode('markers')}><MapPin size={16} /> Issue map</button><button className={mode === 'heat' ? 'active' : ''} onClick={() => setMode('heat')}><Activity size={16} /> Density view</button></div><div className="map-filters"><select value={category} onChange={e => setCategory(e.target.value)}><option>All categories</option>{data.categories.map(c => <option key={c.id}>{c.name}</option>)}</select><select value={status} onChange={e => setStatus(e.target.value)}>{['All statuses','Submitted','Assigned','In Progress','Awaiting Feedback','Closed','Reopened'].map(x => <option key={x}>{x}</option>)}</select></div></div><IssueMap complaints={filtered} mode={mode} onOpen={onOpen} /><p className="method-note">Showing {page.complaints.length} of {page.total} reports. Filters apply to loaded map points.</p>{page.nextCursor && <button className="secondary load-more" disabled={busy} onClick={() => void loadMore()}>{busy ? 'Loading…' : 'Load more map points'}</button>}<div className="map-bottom"><div className="card map-legend"><strong>Issue types</strong><span><i style={{background:'#f59e6c'}} /> Roads</span><span><i style={{background:'#b19aff'}} /> Waste</span><span><i style={{background:'#66b8ff'}} /> Water & drainage</span><span><i style={{background:'#ffd277'}} /> Lighting</span></div><div className="card map-summary"><strong>{filtered.length} loaded complaints</strong><span>{new Set(filtered.map(c => c.area)).size} affected areas</span><span>{filtered.filter(c => c.status !== 'Closed').length} still open</span></div></div></>;
}

function FeedbackPage({ data, onOpen }: { data: Snapshot; onOpen: (id: number) => void }) {
  const awaiting = data.complaints.filter(c => c.status === 'Awaiting Feedback');
  const reviews = data.feedback.slice(0, 6);
  return <><SectionHeading eyebrow="COMMUNITY VOICE" title="Resolution feedback" /><div className="stat-grid three"><StatCard icon={<MessageSquare size={20} />} label="Community responses" value={data.summary.feedback.count} tone="mint" /><StatCard icon={<Check size={20} />} label="Awaiting review" value={data.summary.counts.awaiting || 0} tone="blue" /><StatCard icon={<Activity size={20} />} label="Average rating" value={data.summary.feedback.average !== null ? `${data.summary.feedback.average.toFixed(1)}/5` : '—'} tone="amber" /></div><div className="two-col"><div className="card"><SectionHeading eyebrow="READY FOR YOUR VOICE" title="Recent completed work" /><ComplaintList items={awaiting} onOpen={onOpen} compact /></div><div className="card"><SectionHeading eyebrow="LATEST RESPONSES" title="What residents said" />{reviews.length ? <div className="review-list">{reviews.map(f => { const c = data.complaints.find(x => x.id === f.complaint_id); return <button key={f.id} onClick={() => c && onOpen(c.id)}><span className="review-avatar">{f.author[0]}</span><span><strong>{f.author} <em>{'★'.repeat(f.rating)}{'☆'.repeat(5-f.rating)}</em></strong><small>{c?.title} · {f.local ? 'Area matched resident' : 'Public feedback'}</small><p>{f.comment || `Issue ${f.resolution.toLowerCase()} resolved.`}</p></span></button>; })}</div> : <Empty title="No feedback yet" text="Residents can review issues after work is completed." />}</div></div><p className="method-note">The list shows feedback for recent reports. Totals include all reports visible to your role.</p></>;
}

function Analytics({ data }: { data: Snapshot }) {
  const { summary } = data;
  const categoryRows = summary.categories.map(row => ({ name: data.categories.find(c => c.id === row.id)?.name || 'Other', count: row.count }));
  const departments = summary.departments.map(row => ({ name: data.departments.find(d => d.id === row.id)?.name || 'Department', ...row }));
  return <><SectionHeading eyebrow="OPERATIONAL INSIGHTS" title="Dhaka analytics" /><div className="stat-grid"><StatCard icon={<FileText size={20} />} label="Total reports" value={summary.counts.total} tone="mint" /><StatCard icon={<Activity size={20} />} label="Still open" value={summary.counts.open || 0} tone="amber" /><StatCard icon={<Check size={20} />} label="Closed" value={summary.counts.closed || 0} tone="blue" /><StatCard icon={<Flag size={20} />} label="Repair cycles reopened" value={summary.reopened} tone="rose" /></div>
    <div className="two-col"><div className="card"><SectionHeading eyebrow="ISSUE MIX" title="Reports by category" /><div className="bar-list tall">{categoryRows.map((item,i) => <div className="bar-row" key={item.name}><span>{item.name}</span><div className="bar-track"><i style={{ width: `${item.count/Math.max(1,categoryRows[0].count)*100}%`, background: ['#66dbc3','#82b7ff','#ffc883','#bca5ff','#ff9e9d'][i%5] }} /></div><strong>{item.count}</strong></div>)}</div></div>
    <div className="card"><SectionHeading eyebrow="GEOGRAPHIC PATTERN" title="Areas needing attention" /><div className="area-list">{summary.areas.map((row,i) => <div key={row.area}><span className="rank">{String(i+1).padStart(2,'0')}</span><span><strong>{row.area}</strong><small>{row.open} open issues</small></span><b>{row.count}</b></div>)}</div></div></div>
    <div className="card"><SectionHeading eyebrow="SERVICE DELIVERY" title="Department performance" /><div className="performance-grid">{departments.map(d => <div className="performance-card" key={d.id}><span className="dept-icon"><Users size={18} /></span><h3>{d.name}</h3><div><strong>{d.count}</strong><small>assigned</small></div><div><strong>{d.resolved}</strong><small>completed</small></div></div>)}</div></div><p className="method-note">Counts use all reports visible to your role. Area and department lists show the top 20. Area matched feedback remains provisional until addresses are independently verified.</p></>;
}

function Profile({ user, showError }: { user: User; showError: (message: string) => void }) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setSaved(false);
    try { await request('changePassword', { currentPassword, newPassword }); setCurrentPassword(''); setNewPassword(''); setSaved(true); }
    catch (error) { showError(String(error instanceof Error ? error.message : error)); }
    finally { setBusy(false); }
  };
  return <><SectionHeading eyebrow="YOUR ACCOUNT" title="Account security" /><div className="card profile-security"><h3>{user.name}</h3><p>{user.email} · {roleName[user.role]}</p><form className="account-form" onSubmit={submit}><label>Current password<input type="password" value={currentPassword} onChange={event => setCurrentPassword(event.target.value)} required /></label><label>New password<input type="password" value={newPassword} onChange={event => setNewPassword(event.target.value)} minLength={12} maxLength={128} required /></label><button className="primary" disabled={busy}>{busy ? 'Saving…' : 'Change password'}</button></form>{saved && <p role="status">Password updated. Other signed-in devices have been signed out.</p>}</div></>;
}

function Manage({ data, refresh, showError }: { data: Snapshot; refresh: () => Promise<void>; showError: (message: string) => void }) {
  const [kind, setKind] = useState<'department' | 'category'>('category');
  const [name, setName] = useState(''); const [departmentId, setDepartmentId] = useState('');
  const [accountName, setAccountName] = useState(''); const [accountEmail, setAccountEmail] = useState('');
  const [accountPassword, setAccountPassword] = useState(''); const [accountRole, setAccountRole] = useState<'staff' | 'admin'>('staff');
  const [accountDepartment, setAccountDepartment] = useState(''); const [busy, setBusy] = useState(false);
  const [managementStatus, setManagementStatus] = useState('');
  const [backupPassword, setBackupPassword] = useState('');
  const [backupPassphrase, setBackupPassphrase] = useState('');
  const [backupStatus, setBackupStatus] = useState('');
  const [backupBusy, setBackupBusy] = useState(false);
  const saveBackup = async (event: FormEvent) => {
    event.preventDefault(); setBackupBusy(true); setBackupStatus('Starting backup…');
    try { await downloadEncryptedBackup(backupPassword, backupPassphrase, setBackupStatus); setBackupPassword(''); setBackupPassphrase(''); }
    catch (error) { setBackupStatus(''); showError(String(error instanceof Error ? error.message : error)); }
    finally { setBackupBusy(false); }
  };
  const add = async (event: FormEvent) => { event.preventDefault(); setBusy(true); setManagementStatus(''); try { await request('manage', { type: kind, name, departmentId: departmentId || null }); setName(''); await refresh(); setManagementStatus(kind === 'department' ? 'Department created. Add a category assigned to it so citizens can choose that service.' : 'Category created and available for new reports.'); } catch (error) { showError(String(error instanceof Error ? error.message : error)); } finally { setBusy(false); } };
  const addAccount = async (event: FormEvent) => { event.preventDefault(); setBusy(true); try { await request('manage', { type: 'user', name: accountName, email: accountEmail, password: accountPassword, role: accountRole, departmentId: accountDepartment || null }); setAccountName(''); setAccountEmail(''); setAccountPassword(''); await refresh(); } catch (error) { showError(String(error instanceof Error ? error.message : error)); } finally { setBusy(false); } };
  const changeAccount = async (account: User) => { setBusy(true); try { await request('manage', { type: 'userStatus', userId: account.id, active: !account.active }); await refresh(); } catch (error) { showError(String(error instanceof Error ? error.message : error)); } finally { setBusy(false); } };
  return <><SectionHeading eyebrow="PLATFORM CONTROL" title="Administration" />
    <div className="stat-grid three"><StatCard icon={<Users size={20} />} label="Accounts" value={data.users.length} tone="mint" /><StatCard icon={<Settings size={20} />} label="Categories" value={data.categories.length} tone="blue" /><StatCard icon={<ShieldCheck size={20} />} label="Audit events" value={data.audit.length} tone="amber" /></div>
    <div className="two-col"><div className="card"><SectionHeading eyebrow="STRUCTURE" title="Categories & departments" /><form className="management-form" onSubmit={add}><select value={kind} onChange={e => setKind(e.target.value as 'category' | 'department')}><option value="category">New category</option><option value="department">New department</option></select><input value={name} onChange={e => setName(e.target.value)} placeholder="Name" minLength={3} required />{kind === 'category' && <select value={departmentId} onChange={e => setDepartmentId(e.target.value)}><option value="">No default department</option>{data.departments.filter(d => d.active).map(d => <option value={d.id} key={d.id}>{d.name}</option>)}</select>}<button className="primary" disabled={busy}><Plus size={16} /> Add</button></form>{managementStatus && <p role="status">{managementStatus}</p>}<h3>Departments</h3><div className="settings-list">{data.departments.map(d => <div key={d.id}><strong>{d.name}</strong><span>{data.categories.filter(c => c.department_id === d.id).length} categories · {d.active ? 'Active' : 'Inactive'}</span></div>)}</div><h3>Report categories</h3><p className="muted">Citizens select a category. Assign categories to departments to route new reports.</p><div className="settings-list">{data.categories.map(c => <div key={c.id}><strong>{c.name}</strong><span>{data.departments.find(d => d.id === c.department_id)?.name || 'Unassigned'}</span></div>)}</div></div>
    <div className="card"><SectionHeading eyebrow="ACCESS" title="Team accounts" /><form className="account-form" onSubmit={addAccount}><input value={accountName} onChange={e => setAccountName(e.target.value)} placeholder="Full name" minLength={3} required /><input value={accountEmail} onChange={e => setAccountEmail(e.target.value)} type="email" placeholder="Work email" required /><input value={accountPassword} onChange={e => setAccountPassword(e.target.value)} type="password" minLength={10} placeholder="Temporary password (10+ characters)" required /><select value={accountRole} onChange={e => setAccountRole(e.target.value as 'staff' | 'admin')}><option value="staff">Department staff</option><option value="admin">Administrator</option></select>{accountRole === 'staff' && <select value={accountDepartment} onChange={e => setAccountDepartment(e.target.value)} required><option value="">Choose department</option>{data.departments.filter(d => d.active).map(d => <option value={d.id} key={d.id}>{d.name}</option>)}</select>}<button className="primary" disabled={busy}><Plus size={16} /> Add account</button></form><div className="settings-list">{data.users.map(u => <div key={u.id}><strong>{u.name}</strong><span>{roleName[u.role]} · {u.department_id ? data.departments.find(d => d.id === u.department_id)?.name + ' · ' : ''}{u.email}</span></div>)}</div></div></div>
    <div className="card"><SectionHeading eyebrow="ACCESS CONTROL" title="Manage staff access" /><div className="settings-list">{data.users.filter(u => ['admin','staff'].includes(u.role)).map(u => <div key={u.id}><strong>{u.name} · {roleName[u.role]}</strong><span>{u.email} · {u.active ? 'Active' : 'Disabled'}</span><button type="button" className="account-toggle" disabled={busy} onClick={() => void changeAccount(u)}>{u.active ? 'Disable access' : 'Reactivate access'}</button></div>)}</div></div>
    <div className="card"><SectionHeading eyebrow="DATA RECOVERY" title="Encrypted owner backup" /><p className="muted">Download a protected copy of accounts, reports, images, feedback, and audit records. Keep the backup passphrase in a separate safe place. This export can use significant browser memory as records grow.</p><form className="account-form" onSubmit={saveBackup}><label>Your current password<input type="password" autoComplete="current-password" value={backupPassword} onChange={e => setBackupPassword(e.target.value)} required /></label><label>Backup passphrase (16+ characters)<input type="password" autoComplete="new-password" minLength={16} value={backupPassphrase} onChange={e => setBackupPassphrase(e.target.value)} required /></label><button className="primary" disabled={backupBusy}><Download size={16} /> {backupBusy ? 'Preparing…' : 'Download encrypted backup'}</button></form>{backupStatus && <p role="status">{backupStatus}</p>}</div>
    <div className="card"><SectionHeading eyebrow="ACCOUNTABILITY" title="Recent audit trail" /><div className="audit-list">{data.audit.slice(0, 12).map(a => <div key={a.id}><span className="audit-dot" /><span><strong>{a.actor}</strong> {a.action.toLowerCase()} {a.target_type} #{a.target_id}<small>{a.detail || '—'}</small></span><time>{date(a.created_at)}</time></div>)}</div></div></>;
}

function Detail({ data, complaint, onClose, refresh, showError }: { data: Snapshot; complaint: Complaint; onClose: () => void; refresh: () => Promise<void>; showError: (message: string) => void }) {
  const [note, setNote] = useState(''); const [departmentId, setDepartmentId] = useState(complaint.department_id ? String(complaint.department_id) : ''); const [priority, setPriority] = useState(complaint.priority);
  const [rating, setRating] = useState(5); const [resolution, setResolution] = useState('Yes'); const [comment, setComment] = useState(''); const [completionImage, setCompletionImage] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const [nearby, setNearby] = useState<Array<{ id: number; code: string; title: string; distance: number }>>([]); const [duplicateId, setDuplicateId] = useState('');
  useEffect(() => { void request<typeof nearby>('nearby', { latitude: complaint.latitude, longitude: complaint.longitude, categoryId: complaint.category_id }).then(rows => setNearby(rows.filter(row => row.id !== complaint.id))).catch(() => setNearby([])); }, [complaint.id,complaint.category_id,complaint.latitude,complaint.longitude]);
  const updates = data.updates.filter(u => u.complaint_id === complaint.id);
  const cycles = data.cycles.filter(c => c.complaint_id === complaint.id);
  const latestCycle = cycles[0];
  const reviews = data.feedback.filter(f => f.complaint_id === complaint.id);
  const currentReviews = reviews.filter(f => f.cycle_id === latestCycle?.id);
  const localReviews = currentReviews.filter(f => f.local);
  const average = localReviews.length ? localReviews.reduce((s,f) => s + f.rating,0)/localReviews.length : null;
  const notResolved = localReviews.length ? localReviews.filter(f => f.resolution === 'No').length/localReviews.length*100 : 0;
  const flagged = average !== null && (average < 3 || notResolved > 40);
  const canFeedback = data.user.role === 'citizen' && complaint.status === 'Awaiting Feedback' && !currentReviews.some(f => f.user_id === data.user.id);
  const perform = async (action: string, extra: Record<string, unknown> = {}) => { setBusy(true); try { await request('action', { id: complaint.id, action, note, ...extra }); setNote(''); setCompletionImage(null); await refresh(); } catch (error) { showError(String(error instanceof Error ? error.message : error)); } finally { setBusy(false); } };
  const sendFeedback = async (event: FormEvent) => { event.preventDefault(); setBusy(true); try { await request('feedback', { id: complaint.id, rating, resolution, comment }); setComment(''); await refresh(); } catch (error) { showError(String(error instanceof Error ? error.message : error)); } finally { setBusy(false); } };
  const admin = ['admin','superadmin'].includes(data.user.role); const staff = data.user.role === 'staff' && complaint.department_id === data.user.departmentId;
  return <div className="drawer-backdrop" onClick={onClose}><aside className="detail-drawer" onClick={e => e.stopPropagation()}><div className="drawer-top"><div><span className="eyebrow">CASE {complaint.code}</span><h2>Issue details</h2></div><button className="icon-button" onClick={onClose} aria-label="Close details"><X size={20} /></button></div><div className="drawer-body"><div className="detail-heading"><div className="detail-icon"><MapPin size={24} /></div><h3>{complaint.title}</h3><p>{complaint.description}</p><div className="badge-row"><Badge value={complaint.status} /><Badge value={complaint.severity} type="severity" /></div></div>
    <div className="detail-grid"><div><small>AREA</small><strong>{complaint.area}</strong></div><div><small>CATEGORY</small><strong>{complaint.category}</strong></div><div><small>DEPARTMENT</small><strong>{complaint.department || 'Not assigned'}</strong></div><div><small>PRIORITY</small><strong>{complaint.priority}</strong></div><div><small>REPORTED</small><strong>{date(complaint.created_at)}</strong></div><div><small>LOCATION</small><strong>{complaint.latitude.toFixed(4)}, {complaint.longitude.toFixed(4)}</strong></div></div>
    {complaint.image && <div className="detail-section"><h4>Report evidence</h4><img src={complaint.image} alt="Citizen submitted evidence" /></div>}{complaint.completion_image && <div className="detail-section"><h4>Completion evidence</h4><img src={complaint.completion_image} alt="Department completion evidence" /></div>}
    {cycles.length > 0 && <div className="detail-section"><h4>Resolution cycles</h4><div className="cycle-row">{cycles.map(c => <span key={c.id}>Cycle {c.number} · {c.reopened_at ? 'Reopened' : c.closed_at ? 'Closed' : 'Feedback open'}</span>)}</div></div>}
    {latestCycle && <div className="detail-section"><h4>Community feedback</h4><div className="feedback-summary"><strong>{average === null ? '—' : `${average.toFixed(1)}/5`}</strong><span>{localReviews.length} area matched reviews<br />{flagged ? '⚑ Needs administrative review' : `${currentReviews.length} total responses`}</span></div>{currentReviews.map(f => <div className="drawer-review" key={f.id}><strong>{f.author} · {'★'.repeat(f.rating)}</strong><small>{f.local ? 'Area matched resident' : 'Public feedback'} · {f.resolution} resolved</small><p>{f.comment}</p></div>)}</div>}
    {canFeedback && <form className="detail-section action-card" onSubmit={sendFeedback}><h4>Review the completed work</h4><label>Rating<select value={rating} onChange={e => setRating(Number(e.target.value))}>{[5,4,3,2,1].map(n => <option value={n} key={n}>{n} / 5</option>)}</select></label><label>Was it resolved?<select value={resolution} onChange={e => setResolution(e.target.value)}>{['Yes','Partially','No'].map(x => <option key={x}>{x}</option>)}</select></label><label>Comment<textarea value={comment} onChange={e => setComment(e.target.value)} rows={3} placeholder="What changed on site?" /></label><button className="primary" disabled={busy}>Send feedback</button></form>}
    {admin && <div className="detail-section action-card"><h4>Administrator actions</h4><label>Note<textarea value={note} onChange={e => setNote(e.target.value)} rows={2} placeholder="Reason or instruction for the timeline" /></label>{['Submitted','Under Review'].includes(complaint.status) && <><div className="action-row"><button className="primary" disabled={busy} onClick={() => void perform('verify')}><Check size={15} /> Verify</button><button className="secondary danger" disabled={busy} onClick={() => void perform('reject')}>Reject</button></div>{nearby.length > 0 && <><label>Nearby report in the same category<select value={duplicateId} onChange={e => setDuplicateId(e.target.value)}><option value="">Choose an original report</option>{nearby.map(row => <option key={row.id} value={row.id}>{row.code} · {row.title} ({row.distance} m)</option>)}</select></label><button className="secondary" disabled={busy || !duplicateId} onClick={() => void perform('duplicate', { duplicateOf: Number(duplicateId) })}>Mark as duplicate</button></>}</>}{['Verified','Assigned','Reopened'].includes(complaint.status) && <><label>Assign department<select value={departmentId} onChange={e => setDepartmentId(e.target.value)}><option value="">Select department</option>{data.departments.filter(d => d.active).map(d => <option value={d.id} key={d.id}>{d.name}</option>)}</select></label><button className="primary" disabled={busy || !departmentId} onClick={() => void perform('assign', { departmentId: Number(departmentId) })}>Assign department</button></>}
    <label>Priority<select value={priority} onChange={e => setPriority(e.target.value)}>{['Normal','High','Urgent'].map(x => <option key={x}>{x}</option>)}</select></label><button className="secondary" disabled={busy} onClick={() => void perform('priority', { priority })}>Update priority</button>
    {complaint.status === 'Awaiting Feedback' && <div className="action-row"><button className="primary" disabled={busy} onClick={() => void perform('close')}>Close case</button><button className="secondary danger" disabled={busy} onClick={() => void perform('reopen')}>Reopen</button></div>}{complaint.status === 'Closed' && <button className="secondary danger" disabled={busy} onClick={() => void perform('reopen')}>Reopen case</button>}</div>}
    {staff && ['Assigned','Reopened','In Progress'].includes(complaint.status) && <div className="detail-section action-card"><h4>Department work</h4><label>Work note<textarea value={note} onChange={e => setNote(e.target.value)} rows={3} placeholder="What has been done?" /></label>{['Assigned','Reopened'].includes(complaint.status) && <button className="primary" disabled={busy} onClick={() => void perform('start')}>Start work</button>}{complaint.status === 'In Progress' && <><button className="secondary" disabled={busy} onClick={() => void perform('progress')}>Add progress note</button><label className="inline-upload"><Upload size={17} /> Completion photo<input type="file" accept="image/png,image/jpeg,image/webp" onChange={async e => { try { setCompletionImage(e.target.files?.[0] ? await readImage(e.target.files[0]) : null); } catch (err) { showError(String(err)); } }} /></label>{completionImage && <small className="success-text">Photo ready to attach</small>}<button className="primary" disabled={busy} onClick={() => void perform('resolve', { image: completionImage })}>Mark work completed</button></>}</div>}
    <div className="detail-section"><h4>Activity timeline</h4><div className="timeline">{updates.map(u => <div key={u.id}><span className="timeline-point" /><div><strong>{u.action}</strong><small>{u.actor} · {date(u.created_at)}</small>{u.note && <p>{u.note}</p>}</div></div>)}</div></div>
  </div></aside></div>;
}

export default function App() {
  const [user, setUser] = useState<User | null>(null); const [data, setData] = useState<Snapshot | null>(null);
  const [setupRequired, setSetupRequired] = useState(false); const [exploring, setExploring] = useState(false); const [publicData, setPublicData] = useState<PublicSnapshot | null>(null);
  const [page, setPage] = useState<Page>('dashboard'); const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<ComplaintDetail | null>(null);
  const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const [busy, setBusy] = useState(false); const [loading, setLoading] = useState(true);
  const [signOutOpen, setSignOutOpen] = useState(false); const [signOutBusy, setSignOutBusy] = useState(false);
  const refresh = useCallback(async () => { const snapshot = await request<Snapshot>('snapshot'); setData(snapshot); setUser(snapshot.user); }, []);
  useEffect(() => { void Promise.all([request<{ setupRequired?: boolean }>('config'), request<User | null>('session')]).then(async ([config, account]) => { setSetupRequired(Boolean(config.setupRequired)); if (account) { setUser(account); await refresh(); } }).catch(err => setError(String(err))).finally(() => setLoading(false)); }, [refresh]);
  useEffect(() => {
    if (!user?.id) return;
    let active = true;
    const update = () => {
      if (document.visibilityState !== 'visible') return;
      void request<Snapshot>('snapshot').then(snapshot => { if (active && snapshot.user.id === user.id) setData(snapshot); }).catch(() => {});
      if (selectedId !== null) void request<ComplaintDetail>('complaintDetail', { id: selectedId }).then(next => { if (active) setDetail(next); }).catch(() => {});
    };
    const timer = window.setInterval(update, 15000);
    window.addEventListener('focus', update);
    document.addEventListener('visibilitychange', update);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener('focus', update); document.removeEventListener('visibilitychange', update); };
  }, [user?.id, selectedId]);
  useEffect(() => onNotice(message => { setNotice(message); setTimeout(() => setNotice(''), 4500); }), []);
  useEffect(() => { window.scrollTo(0, 0); }, [page, user?.id]);
  const login = async (email: string, password: string) => { setBusy(true); setError(''); try { const account = await request<User>('login', { email, password }); setUser(account); setPage('dashboard'); setSelectedId(null); await refresh(); } catch (err) { setError(String(err instanceof Error ? err.message : err)); } finally { setBusy(false); } };
  const register = async (details: { name: string; email: string; area: string; password: string }) => { setBusy(true); setError(''); try { const account = await request<User>('register', details); setUser(account); setPage('dashboard'); setExploring(false); await refresh(); } catch (err) { setError(String(err instanceof Error ? err.message : err)); } finally { setBusy(false); } };
  const setup = async (details: { key: string; name: string; email: string; password: string }) => { setBusy(true); setError(''); try { const account = await request<User>('bootstrap', details); setUser(account); setSetupRequired(false); await refresh(); } catch (err) { setError(String(err instanceof Error ? err.message : err)); } finally { setBusy(false); } };
  const explore = async () => { setBusy(true); setError(''); try { setPublicData(await request<PublicSnapshot>('publicSnapshot')); setExploring(true); } catch (err) { setError(String(err instanceof Error ? err.message : err)); } finally { setBusy(false); } };
  const logout = async () => { setSignOutBusy(true); try { await request('logout'); setSignOutOpen(false); setUser(null); setData(null); setPage('dashboard'); setSelectedId(null); setDetail(null); setError(''); } catch (err) { showError(String(err instanceof Error ? err.message : err)); } finally { setSignOutBusy(false); } };
  const showError = (message: string) => { setError(message); setTimeout(() => setError(''), 7000); };
  const open = (id: number) => { setSelectedId(id); setDetail(null); void request<ComplaintDetail>('complaintDetail', { id }).then(setDetail).catch(err => showError(String(err))); };
  const refreshDetail = async () => { await refresh(); if (selectedId !== null) setDetail(await request<ComplaintDetail>('complaintDetail', { id: selectedId })); };
  const selected = detail?.complaint && detail.complaint.id === selectedId ? detail.complaint : null;
  const nav = useMemo(() => {
    const base: Array<[Page,string,ReactNode]> = [['dashboard','Overview',<LayoutDashboard size={19} />],['complaints','Complaints',<FileText size={19} />]];
    if (user?.role === 'citizen') base.push(['report','Report an issue',<Plus size={19} />]);
    base.push(['map','Issue map',<MapIcon size={19} />],['feedback','Community feedback',<MessageSquare size={19} />],['analytics','Analytics',<BarChart3 size={19} />]);
    if (user?.role === 'superadmin') base.push(['manage','Administration',<Settings size={19} />]);
    base.push(['profile','Account security',<ShieldCheck size={19} />]);
    return base;
  }, [user?.role]);
  if (loading) return <div className="loading-screen"><div className="loading-logo"><Activity size={35} /></div><span>Loading CivicPulse…</span></div>;
  if (setupRequired) return <OwnerSetup onSetup={setup} busy={busy} error={error} />;
  if (!user || !data) return exploring && publicData ? <PublicIssues initial={publicData} onBack={() => setExploring(false)} /> : <Login onLogin={login} onRegister={register} onExplore={() => void explore()} busy={busy} error={error} />;
  return <div className="shell"><aside className="sidebar"><div className="brand"><span className="brand-mark"><MapPin size={20} /></span><span>CivicPulse</span></div><div className="workspace-label">WORKSPACE</div><nav>{nav.map(([key,label,icon]) => <button key={key} className={page === key ? 'active' : ''} onClick={() => { setPage(key); setSelectedId(null); }}>{icon}<span>{label}</span>{key === 'complaints' && (data.summary.counts.pending || 0) > 0 && ['admin','superadmin'].includes(user.role) && <i className="nav-count">{data.summary.counts.pending || 0}</i>}</button>)}</nav><div className="sidebar-bottom"><div className="sidebar-tip"><span><Activity size={17} /> DHAKA SIGNAL</span><strong>{data.summary.counts.open || 0} active reports</strong><small>In the Dhaka service area</small></div><button className="profile-mini" onClick={() => setSignOutOpen(true)} title="Sign out"><span className="profile-avatar">{user.name[0]}</span><span><strong>{user.name}</strong><small>{roleName[user.role]}</small></span><LogOut size={17} /></button></div></aside><div className="main-area"><header className="topbar"><div className="breadcrumb">CivicPulse <span>/</span> <strong>{nav.find(n => n[0] === page)?.[1]}</strong></div><div className="top-actions"><span className="today"><Bell size={17} /> {data.summary.counts.pending || 0} new reports</span><span className="top-date">{new Date().toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'long' })}</span><button type="button" className="top-avatar" aria-label="Account security" title="Account security" onClick={() => { setPage('profile'); setSelectedId(null); }}>{user.name[0]}</button></div></header><main className="content">
    {page === 'dashboard' && <Dashboard data={data} onPage={setPage} onOpen={open} />}
    {page === 'complaints' && <Complaints data={data} onOpen={open} />}
    {page === 'report' && <Report data={data} showError={showError} onCreated={async id => { await refresh(); setPage('complaints'); open(id); setNotice('Complaint submitted successfully.'); setTimeout(() => setNotice(''), 5000); }} />}
    {page === 'map' && <MapPage data={data} onOpen={open} />}
    {page === 'feedback' && <FeedbackPage data={data} onOpen={open} />}
    {page === 'analytics' && <Analytics data={data} />}
    {page === 'profile' && <Profile user={user} showError={showError} />}
    {page === 'manage' && user.role === 'superadmin' && <Manage data={data} refresh={refresh} showError={showError} />}
    {['admin','superadmin'].includes(user.role) && <div className="export-bar"><span>Need a copy of the current data?</span><button className="secondary" onClick={() => void request('exportCsv').catch(err => showError(String(err)))}><Download size={16} /> Export CSV</button><button className="secondary" onClick={() => void request('exportPdf').catch(err => showError(String(err)))}><Download size={16} /> Save PDF</button></div>}
  </main></div>{selected && detail && <Detail key={`${selected.id}-${user.id}`} data={{ ...data, updates: detail.updates, cycles: detail.cycles, feedback: detail.feedback }} complaint={selected} onClose={() => { setSelectedId(null); setDetail(null); }} refresh={refreshDetail} showError={showError} />}{error && <div className="toast error-toast"><Flag size={17} /> {error}<button onClick={() => setError('')}><X size={15} /></button></div>}{notice && <div className="toast success-toast"><Check size={17} /> {notice}</div>}{signOutOpen && <div className="confirm-backdrop" onClick={() => !signOutBusy && setSignOutOpen(false)}><div className="confirm-card" role="dialog" aria-modal="true" aria-labelledby="signout-title" onClick={event => event.stopPropagation()}><span className="eyebrow">ACCOUNT</span><h2 id="signout-title">Sign out of CivicPulse?</h2><p>You can sign in again to continue your work.</p><div className="confirm-actions"><button type="button" className="secondary" disabled={signOutBusy} onClick={() => setSignOutOpen(false)}>Stay signed in</button><button type="button" className="primary" disabled={signOutBusy} onClick={() => void logout()}>{signOutBusy ? 'Signing out…' : 'Sign out'}</button></div></div></div>}</div>;
}
