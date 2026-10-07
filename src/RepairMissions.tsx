import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { ArrowRight, ClipboardCheck, MapPin, Plus, RefreshCw } from 'lucide-react';
import { request } from './api';
import { readImage } from './image';
import { localizeStatus, useLocale } from './i18n';
import { wardLabel } from './wards';
import type { MissionCandidate, MissionDetail, MissionList, User } from './types';

const localDate = (value: string, language: string) => new Date(value.replace(' ', 'T') + (value.includes('Z') ? '' : 'Z')).toLocaleString(language === 'bn' ? 'bn-BD' : 'en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const timeInput = (value: string | null) => value ? new Date(new Date(value).getTime() - new Date(value).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '';
const statusBn: Record<string,string> = { Planned: 'পরিকল্পিত', 'In Progress': 'কাজ চলছে', Completed: 'কাজ শেষ', Cancelled: 'বাতিল' };

export default function RepairMissions({ user, focusId, anchorCaseId, onOpenCase, onChanged, showError }: {
  user: User; focusId: number | null; anchorCaseId: number | null; onOpenCase: (id: number) => void; onChanged: () => Promise<void>; showError: (message: string) => void;
}) {
  const { language } = useLocale();
  const bn = language === 'bn';
  const [scope, setScope] = useState<'active' | 'history'>('active');
  const [page, setPage] = useState(1);
  const [list, setList] = useState<MissionList | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(focusId);
  const [detail, setDetail] = useState<MissionDetail | null>(null);
  const [query, setQuery] = useState('');
  const [candidates, setCandidates] = useState<MissionCandidate[]>([]);
  const [anchorId, setAnchorId] = useState<number | null>(anchorCaseId);
  const [caseIds, setCaseIds] = useState<number[]>(anchorCaseId ? [anchorCaseId] : []);
  const [title, setTitle] = useState('');
  const [plan, setPlan] = useState('');
  const [nextAction, setNextAction] = useState('');
  const [assigneeId, setAssigneeId] = useState('');
  const [editPlan, setEditPlan] = useState('');
  const [editNext, setEditNext] = useState('');
  const [completionNote, setCompletionNote] = useState('');
  const [completionImage, setCompletionImage] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const [notice, setNotice] = useState('');
  const loadList = useCallback(async () => {
    try { const result = await request<MissionList>('listMissions', { scope, page }); setList(result); }
    catch (error) { showError(String(error instanceof Error ? error.message : error)); }
  }, [scope,page,showError]);
  useEffect(() => { void loadList(); }, [loadList]);
  useEffect(() => { setSelectedId(focusId); }, [focusId]);
  useEffect(() => {
    if (!selectedId) { setDetail(null); return; }
    let active = true;
    void request<MissionDetail>('missionDetail', { id: selectedId }).then(result => { if (!active) return; setDetail(result); setEditPlan(result.plan); setEditNext(timeInput(result.next_action_at)); }).catch(error => { if (active) showError(String(error)); });
    return () => { active = false; };
  }, [selectedId,showError]);
  useEffect(() => {
    let active = true;
    setLoadingCandidates(true);
    const timer = window.setTimeout(() => {
      void request<MissionCandidate[]>('missionCandidates', anchorId ? { anchorId } : { query }).then(rows => { if (active) setCandidates(rows); }).catch(error => { if (active) showError(String(error)); }).finally(() => { if (active) setLoadingCandidates(false); });
    }, anchorId ? 0 : 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [anchorId,query,showError]);
  const anchor = candidates.find(item => item.id === anchorId);
  const assigned = user.role === 'staff' ? user.id : Number(assigneeId);
  const staffChoices = useMemo(() => list?.staff.filter(item => item.department_id === anchor?.department_id) || [], [list?.staff,anchor?.department_id]);
  const eligible = (candidate: MissionCandidate) => !candidate.assignee_id || candidate.assignee_id === assigned;
  const chooseAnchor = (item: MissionCandidate) => { setAnchorId(item.id); setCaseIds([item.id]); setAssigneeId(item.assignee_id ? String(item.assignee_id) : ''); setNotice(''); };
  const reload = async (id?: number) => { await Promise.all([loadList(),onChanged()]); if (id) setDetail(await request<MissionDetail>('missionDetail', { id })); };
  const create = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true);
    try {
      const id = await request<number>('createMission', { caseIds, title, plan, nextActionAt: nextAction ? new Date(nextAction).toISOString() : null, assigneeId: user.role === 'staff' ? undefined : assigned });
      setSelectedId(id); setAnchorId(null); setCaseIds([]); setTitle(''); setPlan(''); setNextAction(''); setAssigneeId(''); setScope('active'); setPage(1);
      setNotice(bn ? 'মেরামত মিশন তৈরি হয়েছে।' : 'Repair Mission created.'); await reload(id);
    } catch (error) { showError(String(error instanceof Error ? error.message : error)); }
    finally { setBusy(false); }
  };
  const act = async (action: 'plan' | 'start' | 'complete' | 'cancel') => {
    if (!detail) return;
    setBusy(true);
    try {
      const payload = action === 'plan' ? { plan: editPlan, nextActionAt: editNext ? new Date(editNext).toISOString() : null }
        : action === 'complete' ? { note: completionNote, image: completionImage } : action === 'cancel' ? { reason: cancelReason } : {};
      await request('missionAction', { id: detail.id, action, ...payload });
      setCompletionNote(''); setCompletionImage(null); setCancelReason('');
      setNotice(bn ? 'মিশনের তথ্য সংরক্ষিত হয়েছে।' : 'Mission updated.'); await reload(detail.id);
    } catch (error) { showError(String(error instanceof Error ? error.message : error)); }
    finally { setBusy(false); }
  };
  const canWork = user.role === 'staff' && detail?.assignee_id === user.id;
  const canCancel = detail && (user.role !== 'staff' || (canWork && detail.status === 'Planned'));
  const maxPage = Math.max(1, Math.ceil((list?.total || 0) / 25));
  return <section className="mission-page" aria-label={bn ? 'মেরামত মিশন' : 'Repair Missions'}>
    <header className="mission-hero"><div><span className="eyebrow">{bn ? 'সমন্বিত কাজ' : 'COORDINATED REPAIRS'}</span><h1>{bn ? 'মেরামত মিশন' : 'Repair Missions'}</h1><p>{bn ? 'একই ওয়ার্ডে ২৫০ মিটারের মধ্যে একই বিভাগের দুই বা ততোধিক অভিযোগ একটি কাজের পরিকল্পনায় রাখুন। প্রত্যেক নাগরিক নিজের অভিযোগ আলাদাভাবে নিশ্চিত করবেন।' : 'Group two or more nearby cases from one department and ward into one work plan. Every resident keeps a private case and reviews their own result.'}</p></div><ClipboardCheck size={38} /></header>
    {notice && <p className="mission-notice" role="status">{notice}</p>}
    <div className="mission-layout"><div className="mission-main">
      <form className="card mission-create" onSubmit={create}><div className="mission-heading"><span className="eyebrow">01 / {bn ? 'নতুন কাজ' : 'NEW MISSION'}</span><h2>{bn ? 'নিকটবর্তী অভিযোগগুলো যুক্ত করুন' : 'Group nearby cases'}</h2><p>{bn ? 'প্রথম অভিযোগ বাছুন। এরপর একই বিভাগ ও ওয়ার্ডের ২৫০ মিটারের মধ্যে থাকা অভিযোগগুলো দেখা যাবে।' : 'Choose a starting case, then select nearby cases in the same department and ward.'}</p></div>
        {!anchorId ? <><label>{bn ? 'অভিযোগ খুঁজুন' : 'Find a case'}<input value={query} onChange={event => setQuery(event.target.value)} placeholder={bn ? 'কেস নম্বর বা বিষয় লিখুন' : 'Search by case code or title'} /></label><div className="mission-candidates">{loadingCandidates ? <p className="muted">{bn ? 'খোঁজা হচ্ছে…' : 'Searching…'}</p> : candidates.length ? candidates.map(item => <button type="button" key={item.id} className="mission-candidate" onClick={() => chooseAnchor(item)}><span><strong>{item.code} · {item.title}</strong><small>{item.department} · {wardLabel(item.ward_code,language)}</small></span><ArrowRight size={16} /></button>) : <p className="muted">{bn ? 'উপযুক্ত অভিযোগ পাওয়া যায়নি।' : 'No eligible cases found.'}</p>}</div></> : <><div className="mission-anchor"><strong>{anchor?.code || `C-${1000+anchorId}`} · {anchor?.title || (bn ? 'নির্বাচিত অভিযোগ' : 'Selected case')}</strong><button type="button" className="secondary" onClick={() => { setAnchorId(null); setCaseIds([]); }}>{bn ? 'বদলান' : 'Change'}</button></div>{user.role !== 'staff' && <label>{bn ? 'দায়িত্বপ্রাপ্ত কর্মী' : 'Assigned worker'}<select value={assigneeId} onChange={event => { setAssigneeId(event.target.value); setCaseIds([anchorId]); }} required><option value="">{bn ? 'কর্মী বাছুন' : 'Choose staff'}</option>{staffChoices.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}<div className="mission-checks" role="group" aria-label={bn ? 'যুক্ত অভিযোগ' : 'Cases in mission'}>{candidates.map(item => <label key={item.id} className="mission-check"><input type="checkbox" checked={caseIds.includes(item.id)} disabled={item.id === anchorId || (user.role !== 'staff' && !assigneeId) || !eligible(item)} onChange={event => setCaseIds(current => event.target.checked ? [...current,item.id] : current.filter(id => id !== item.id))} /><span><strong>{item.code} · {item.title}</strong><small>{item.id === anchorId ? (bn ? 'প্রথম অভিযোগ' : 'Starting case') : `${item.distance} m`}{!eligible(item) ? (bn ? ' · অন্য কর্মীর দায়িত্বে' : ' · assigned to another worker') : ''}</small></span></label>)}</div><p className="muted">{bn ? `${caseIds.length}টি অভিযোগ বাছা হয়েছে · ২–১০টি প্রয়োজন` : `${caseIds.length} selected · choose 2–10 cases`}</p><div className="mission-form-grid"><label>{bn ? 'মিশনের নাম' : 'Mission title'}<input value={title} onChange={event => setTitle(event.target.value)} minLength={8} maxLength={100} required placeholder={bn ? 'যেমন: স্কুলের সামনের রাস্তা মেরামত' : 'For example: Repair school crossing'} /></label><label>{bn ? 'পরবর্তী কাজের সময়' : 'Next action time'}<input type="datetime-local" value={nextAction} onChange={event => setNextAction(event.target.value)} /></label></div><label>{bn ? 'একটি কাজের পরিকল্পনা' : 'Shared work plan'}<textarea value={plan} onChange={event => setPlan(event.target.value)} minLength={12} maxLength={1200} rows={4} required placeholder={bn ? 'পরিদর্শন, মেরামত ও যাচাইয়ের ধাপ লিখুন' : 'Describe inspection, repair and checking steps'} /></label><button className="primary" disabled={busy || caseIds.length < 2 || caseIds.length > 10 || (user.role !== 'staff' && !assigneeId)}><Plus size={16} /> {bn ? 'মিশন তৈরি করুন' : 'Create Repair Mission'}</button></>}
      </form>
      <div className="card mission-list"><div className="mission-heading"><span className="eyebrow">02 / {bn ? 'কাজের তালিকা' : 'WORK BOARD'}</span><h2>{bn ? 'মিশনগুলো' : 'Missions'}</h2></div><div className="mission-tabs"><button type="button" className={scope === 'active' ? 'active' : ''} aria-pressed={scope === 'active'} onClick={() => { setScope('active'); setPage(1); }}>{bn ? 'চলমান' : 'Active'}</button><button type="button" className={scope === 'history' ? 'active' : ''} aria-pressed={scope === 'history'} onClick={() => { setScope('history'); setPage(1); }}>{bn ? 'ইতিহাস' : 'History'}</button><button type="button" className="mission-refresh" onClick={() => void loadList()} aria-label={bn ? 'তালিকা নতুন করে দেখুন' : 'Refresh missions'}><RefreshCw size={16} /></button></div>{list?.missions.length ? <div className="mission-cards">{list.missions.map(item => <button type="button" key={item.id} className={selectedId === item.id ? 'mission-card selected' : 'mission-card'} onClick={() => setSelectedId(item.id)}><span><strong>{item.code} · {item.title}</strong><small><MapPin size={13} /> {wardLabel(item.ward_code,language)} · {item.department}</small></span><span className="mission-card-side"><em>{bn ? statusBn[item.status] : item.status}</em><small>{item.case_count} {bn ? 'অভিযোগ' : 'cases'}</small>{item.status === 'Completed' && <small>{item.confirmed_count}/{item.case_count} {bn ? 'নাগরিক নিশ্চিত' : 'confirmed'}</small>}</span></button>)}</div> : <p className="muted">{bn ? 'এখানে কোনো মিশন নেই।' : 'No missions in this view yet.'}</p>}<div className="mission-pagination"><span>{bn ? 'পৃষ্ঠা' : 'Page'} {page} / {maxPage}</span><button type="button" className="secondary" disabled={page <= 1} onClick={() => setPage(page-1)}>{bn ? 'আগে' : 'Previous'}</button><button type="button" className="secondary" disabled={page >= maxPage} onClick={() => setPage(page+1)}>{bn ? 'পরে' : 'Next'}</button></div></div>
    </div><aside className="card mission-detail">{detail && detail.id === selectedId ? <><span className="eyebrow">{detail.code} / {bn ? statusBn[detail.status] : detail.status}</span><h2>{detail.title}</h2><p className="muted">{detail.department} · {wardLabel(detail.ward_code,language)} · {detail.assignee}</p><div className="mission-metrics"><div><strong>{detail.cases.length}</strong><span>{bn ? 'যুক্ত অভিযোগ' : 'Linked cases'}</span></div><div><strong>{detail.cases.filter(item => ['Citizen Verified','Finished'].includes(item.status)).length}</strong><span>{bn ? 'নাগরিক নিশ্চিত' : 'Citizen confirmed'}</span></div></div><div className="mission-plan"><h3>{bn ? 'কাজের পরিকল্পনা' : 'Shared work plan'}</h3><p>{detail.plan}</p>{detail.next_action_at && <small>{bn ? 'পরবর্তী কাজ' : 'Next action'}: {localDate(detail.next_action_at,language)}</small>}</div><div className="mission-case-list"><h3>{bn ? 'যুক্ত অভিযোগ' : 'Linked cases'}</h3>{detail.cases.map(item => <button type="button" key={item.id} onClick={() => onOpenCase(item.id)}><span><strong>{item.code}</strong><small>{item.title}</small></span><span>{localizeStatus(item.status, language)} <ArrowRight size={14} /></span></button>)}</div>{detail.status === 'Completed' && <div className="mission-plan"><h3>{bn ? 'কাজ সম্পন্ন' : 'Work completed'}</h3><p>{detail.completion_note}</p>{detail.completion_image && <img src={detail.completion_image} alt={bn ? 'সমাপ্ত কাজের ছবি' : 'Completed repair evidence'} />}<p className="muted">{bn ? 'প্রত্যেক নাগরিক নিজের অভিযোগ আলাদাভাবে যাচাই ও রেটিং দেবেন।' : 'Each resident reviews and rates their own case separately.'}</p></div>}{(detail.status === 'Planned' || detail.status === 'In Progress') && (canWork || user.role !== 'staff') && <div className="mission-actions"><h3>{bn ? 'পরিকল্পনা বদলান' : 'Update plan'}</h3><label>{bn ? 'কাজের পরিকল্পনা' : 'Work plan'}<textarea value={editPlan} onChange={event => setEditPlan(event.target.value)} minLength={12} maxLength={1200} rows={3} /></label><label>{bn ? 'পরবর্তী কাজের সময়' : 'Next action'}<input type="datetime-local" value={editNext} onChange={event => setEditNext(event.target.value)} /></label><button type="button" className="secondary" disabled={busy || editPlan.trim().length < 12} onClick={() => void act('plan')}>{bn ? 'পরিকল্পনা সংরক্ষণ' : 'Save plan'}</button></div>}{detail.status === 'Planned' && canWork && <button type="button" className="primary" disabled={busy} onClick={() => void act('start')}>{bn ? 'সব অভিযোগের কাজ শুরু করুন' : 'Start work on all cases'}</button>}{detail.status === 'In Progress' && canWork && <div className="mission-actions"><h3>{bn ? 'সব কাজ শেষ করুন' : 'Complete shared repair'}</h3><p className="muted">{bn ? 'একটি কাজের বিবরণ ও ছবি সব যুক্ত অভিযোগে যাবে; পরে নাগরিকেরা আলাদাভাবে নিশ্চিত করবেন।' : 'One repair note and photo will be attached to every linked case for separate citizen review.'}</p><label>{bn ? 'সমাপ্ত কাজের বিবরণ' : 'Completion note'}<textarea value={completionNote} onChange={event => setCompletionNote(event.target.value)} minLength={5} maxLength={1000} rows={3} /></label><label>{bn ? 'সমাপ্ত কাজের ছবি' : 'Completion photo'}<input type="file" accept="image/png,image/jpeg,image/webp" onChange={async event => { try { setCompletionImage(event.target.files?.[0] ? await readImage(event.target.files[0]) : null); } catch (error) { showError(String(error)); } }} /></label>{completionImage && <small className="mission-notice">{bn ? 'ছবি প্রস্তুত' : 'Photo ready'}</small>}<button type="button" className="primary" disabled={busy || completionNote.trim().length < 5 || !completionImage} onClick={() => void act('complete')}>{bn ? 'সব অভিযোগে কাজ শেষ দেখান' : 'Mark all work complete'}</button></div>}{canCancel && ['Planned','In Progress'].includes(detail.status) && <div className="mission-actions"><h3>{bn ? 'মিশন বাতিল' : 'Cancel mission'}</h3><label>{bn ? 'কারণ' : 'Reason'}<textarea value={cancelReason} onChange={event => setCancelReason(event.target.value)} minLength={5} maxLength={300} rows={2} /></label><button type="button" className="secondary danger" disabled={busy || cancelReason.trim().length < 5} onClick={() => void act('cancel')}>{bn ? 'মিশন বাতিল করুন' : 'Cancel mission'}</button></div>}</> : <div className="mission-empty"><ClipboardCheck size={32} /><h2>{bn ? 'একটি মিশন বাছুন' : 'Select a mission'}</h2><p>{bn ? 'কাজের পরিকল্পনা, যুক্ত অভিযোগ ও নাগরিকের নিশ্চিতকরণ এখানে দেখুন।' : 'See the shared plan, linked cases and separate citizen confirmations here.'}</p></div>}</aside></div>
  </section>;
}
