import { useEffect, useState } from 'react';
import { ArrowRight, ClipboardCheck } from 'lucide-react';
import { request } from './api';
import { useLocale } from './i18n';
import type { User, WorkItem, WorkQueue } from './types';
import { wardLabel } from './wards';

type Filter = 'all' | 'unaccepted' | 'mine' | 'blocked' | 'overdue';

export default function WorkQueuePage({ user, onOpen, showError }: { user: User; onOpen: (id: number) => void; showError: (message: string) => void }) {
  const { language, t } = useLocale();
  const [queue, setQueue] = useState<WorkQueue | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [selected, setSelected] = useState<number | null>(null);
  const [assignee, setAssignee] = useState('');
  const [blockedReason, setBlockedReason] = useState('');
  const [nextAction, setNextAction] = useState('');
  const [busy, setBusy] = useState(false);
  const reload = async () => setQueue(await request<WorkQueue>('workQueue'));
  useEffect(() => { void reload().catch(error => showError(String(error))); }, []);
  const now = Date.now();
  const items = (queue?.cases || []).filter(item => filter === 'all' ||
    (filter === 'unaccepted' && !item.assignee_id) ||
    (filter === 'mine' && item.assignee_id === user.id) ||
    (filter === 'blocked' && Boolean(item.blocked_reason)) ||
    (filter === 'overdue' && Boolean(item.resolution_due_at && Date.parse(item.resolution_due_at.replace(' ', 'T') + 'Z') < now)));
  const selectedItem = queue?.cases.find(item => item.id === selected);
  const choose = (item: WorkItem) => {
    setSelected(item.id); setAssignee(item.assignee_id ? String(item.assignee_id) : '');
    setBlockedReason(item.blocked_reason || '');
    if (item.next_action_at) {
      const instant = new Date(item.next_action_at);
      setNextAction(new Date(instant.getTime() - instant.getTimezoneOffset() * 60_000).toISOString().slice(0, 16));
    } else setNextAction('');
  };
  const change = async (method: 'assignWork' | 'setWorkPlan', payload: Record<string, unknown>) => {
    setBusy(true);
    try { await request(method, { id: selected, ...payload }); await reload(); }
    catch (error) { showError(String(error instanceof Error ? error.message : error)); }
    finally { setBusy(false); }
  };
  const labels: Array<[Filter,string,string]> = [
    ['all','All active','সব সক্রিয়'],['unaccepted','Unaccepted','দায়িত্ব নেওয়া হয়নি'],['mine','My work','আমার কাজ'],
    ['blocked','Blocked','আটকে আছে'],['overdue','Overdue','সময়সীমা পেরিয়েছে']
  ];
  return <><div className="section-heading"><div><span className="eyebrow">{language === 'bn' ? 'বিভাগীয় কাজ' : 'DEPARTMENT WORK'}</span><h2>{language === 'bn' ? 'কাজের তালিকা' : 'Staff work queue'}</h2></div></div>
    <p className="muted">{language === 'bn' ? 'দায়িত্ব গ্রহণ করুন, পরবর্তী কাজের সময় লিখুন এবং আটকে থাকলে কারণ জানান। প্রশাসকেরা একই বিভাগের কর্মীকে কাজ দিতে পারেন।' : 'Accept a case, set the next action, and explain any blocker. Administrators can assign staff in the same department.'}</p>
    <div className="work-tabs">{labels.map(([key,en,bn]) => <button type="button" key={key} className={filter === key ? 'active' : 'secondary'} onClick={() => setFilter(key)}>{language === 'bn' ? bn : en}</button>)}</div>
    <div className="work-layout"><div className="card work-list">{!queue ? <p role="status">{t('Loading…')}</p> : items.length ? items.map(item => <button type="button" key={item.id} className={`work-row ${selected === item.id ? 'selected' : ''}`} onClick={() => choose(item)}><strong>{item.code} · {item.title}</strong><small>{item.department} · {item.ward_code ? wardLabel(item.ward_code, language) : item.area}</small><span>{item.assignee || (language === 'bn' ? 'কেউ দায়িত্ব নেননি' : 'Unaccepted')} · {t(item.status)}{item.blocked_reason ? ` · ${language === 'bn' ? 'আটকে আছে' : 'Blocked'}` : ''}</span><ArrowRight size={16} /></button>) : <p className="muted">{language === 'bn' ? 'এই তালিকায় কোনো অভিযোগ নেই।' : 'No cases in this view.'}</p>}{queue && queue.cases.length >= 200 && <p className="method-note">{language === 'bn' ? 'প্রথম ২০০টি সক্রিয় কাজ দেখানো হচ্ছে।' : 'Showing the first 200 active cases.'}</p>}</div>
      <div className="card work-plan">{selectedItem ? <><span className="eyebrow">{selectedItem.code}</span><h3>{selectedItem.title}</h3><p className="muted">{language === 'bn' ? 'সমাধানের লক্ষ্য' : 'Closure target'}: {selectedItem.resolution_due_at ? new Date(selectedItem.resolution_due_at.replace(' ', 'T') + 'Z').toLocaleString(language === 'bn' ? 'bn-BD' : 'en-GB') : '—'}</p>
        <button type="button" className="secondary" onClick={() => onOpen(selectedItem.id)}>{language === 'bn' ? 'সম্পূর্ণ অভিযোগ খুলুন' : 'Open full case'} <ArrowRight size={15} /></button>
        {user.role === 'staff' ? <div className="action-row"><button type="button" className="primary" disabled={busy || Boolean(selectedItem.assignee_id && selectedItem.assignee_id !== user.id)} onClick={() => void change('assignWork', { release: selectedItem.assignee_id === user.id })}>{selectedItem.assignee_id === user.id ? (language === 'bn' ? 'দায়িত্ব ছাড়ুন' : 'Release case') : (language === 'bn' ? 'দায়িত্ব নিন' : 'Accept case')}</button></div> : <label>{language === 'bn' ? 'দায়িত্বপ্রাপ্ত কর্মী' : 'Assigned staff'}<select value={assignee} onChange={event => setAssignee(event.target.value)}><option value="">{language === 'bn' ? 'কেউ নয়' : 'Unassigned'}</option>{queue?.staff.filter(staff => staff.department_id === selectedItem.department_id).map(staff => <option key={staff.id} value={staff.id}>{staff.name}</option>)}</select><button type="button" className="secondary" disabled={busy} onClick={() => void change('assignWork', { assigneeId: assignee ? Number(assignee) : null })}>{language === 'bn' ? 'দায়িত্ব সংরক্ষণ' : 'Save assignment'}</button></label>}
        {(user.role !== 'staff' || selectedItem.assignee_id === user.id) && <div className="work-plan-fields"><label>{language === 'bn' ? 'আটকে থাকার কারণ (না থাকলে খালি)' : 'Blocker (leave blank to clear)'}<textarea value={blockedReason} onChange={event => setBlockedReason(event.target.value)} maxLength={300} rows={3} /></label><label>{language === 'bn' ? 'পরবর্তী কাজের সময়' : 'Next action time'}<input type="datetime-local" value={nextAction} onChange={event => setNextAction(event.target.value)} /></label><button type="button" className="primary" disabled={busy} onClick={() => void change('setWorkPlan', { blockedReason, nextActionAt: nextAction ? new Date(nextAction).toISOString() : null })}><ClipboardCheck size={16} /> {language === 'bn' ? 'কাজের পরিকল্পনা সংরক্ষণ' : 'Save work plan'}</button></div>}
      </> : <p className="muted">{language === 'bn' ? 'বিস্তারিত কাজ দেখতে একটি অভিযোগ বাছুন।' : 'Select a case to manage its work.'}</p>}</div></div>
  </>;
}
