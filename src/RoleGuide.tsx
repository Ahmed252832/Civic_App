import { useState } from 'react';
import { ArrowRight, X } from 'lucide-react';
import { useLocale } from './i18n';
import type { Role } from './types';

type GuideStep = { en: string; bn: string; detailEn: string; detailBn: string; page: string };

const guides: Record<Role, GuideStep[]> = {
  citizen: [
    { en: 'Report a problem', bn: 'সমস্যা জানান', detailEn: 'Describe the issue, confirm its ward and pin, then check everything before sending.', detailBn: 'সমস্যা লিখুন, ওয়ার্ড ও পিন নিশ্চিত করুন, তারপর সব তথ্য দেখে জমা দিন।', page: 'report' },
    { en: 'Follow your reports', bn: 'অভিযোগের অগ্রগতি দেখুন', detailEn: 'Open My reports to see the next step, target date and private messages.', detailBn: 'আমার অভিযোগ খুলে পরবর্তী ধাপ, লক্ষ্য সময় ও ব্যক্তিগত বার্তা দেখুন।', page: 'complaints' },
    { en: 'Confirm completed work', bn: 'সম্পন্ন কাজ যাচাই করুন', detailEn: 'When the team marks work complete, review the photos and give your confirmation and rating.', detailBn: 'কাজ শেষ হলে ছবি দেখে নিশ্চিত করুন এবং রেটিং দিন।', page: 'notifications' }
  ],
  staff: [
    { en: 'Find your cases', bn: 'আপনার কাজ দেখুন', detailEn: 'The work queue shows unaccepted, assigned, blocked and overdue cases.', detailBn: 'কাজের তালিকায় নতুন, দায়িত্বপ্রাপ্ত, আটকে থাকা ও সময় পেরোনো অভিযোগ দেখুন।', page: 'work' },
    { en: 'Update the citizen', bn: 'নাগরিককে অগ্রগতি জানান', detailEn: 'Open a case, select a quick update, edit it and post it to the timeline.', detailBn: 'অভিযোগ খুলে দ্রুত বার্তা বাছুন, সম্পাদনা করুন ও কার্যক্রমে যোগ করুন।', page: 'complaints' },
    { en: 'Finish with evidence', bn: 'প্রমাণসহ কাজ শেষ করুন', detailEn: 'Attach a completion photo so the reporter can compare and verify the work.', detailBn: 'কাজ শেষে ছবি দিন, যেন অভিযোগকারী তুলনা করে যাচাই করতে পারেন।', page: 'work' }
  ],
  admin: [
    { en: 'Review incoming cases', bn: 'নতুন অভিযোগ যাচাই করুন', detailEn: 'Check new reports and route them to the right department.', detailBn: 'নতুন অভিযোগ দেখে সঠিক বিভাগে দায়িত্ব দিন।', page: 'complaints' },
    { en: 'Watch the work queue', bn: 'কাজের তালিকা দেখুন', detailEn: 'Assign staff and check blocked or overdue work.', detailBn: 'কর্মীকে কাজ দিন এবং আটকে থাকা বা সময় পেরোনো কাজ দেখুন।', page: 'work' },
    { en: 'Keep cases moving', bn: 'অগ্রগতি বজায় রাখুন', detailEn: 'Use the activity timeline and private conversation to resolve questions.', detailBn: 'কার্যক্রমের বিবরণ ও ব্যক্তিগত বার্তায় প্রশ্নের সমাধান করুন।', page: 'complaints' }
  ],
  superadmin: [
    { en: 'Review the service', bn: 'সেবার অবস্থা দেখুন', detailEn: 'Service health shows workload, backup reminders and recovery checks.', detailBn: 'সেবার স্বাস্থ্য পাতায় কাজের চাপ, ব্যাকআপ ও পুনরুদ্ধার পরীক্ষা দেখুন।', page: 'health' },
    { en: 'Manage teams', bn: 'দল পরিচালনা করুন', detailEn: 'Create departments, categories and administrator or staff accounts.', detailBn: 'বিভাগ, ধরন এবং প্রশাসক বা কর্মীর অ্যাকাউন্ট তৈরি করুন।', page: 'manage' },
    { en: 'Close verified work', bn: 'যাচাইকৃত কাজ সমাপ্ত করুন', detailEn: 'After a citizen confirms a repair, review it and file it as Finished work.', detailBn: 'নাগরিক কাজ নিশ্চিত করলে পর্যালোচনা করে সমাপ্ত হিসেবে নথিভুক্ত করুন।', page: 'performance' }
  ]
};

export default function RoleGuide({ role, onNavigate, onDismiss }: { role: Role; onNavigate: (page: string) => void; onDismiss: () => void }) {
  const { language } = useLocale();
  const [index, setIndex] = useState(0);
  const steps = guides[role];
  const step = steps[index];
  return <section className="card role-guide" aria-label={language === 'bn' ? 'দ্রুত ব্যবহার নির্দেশনা' : 'Quick start guide'}>
    <div className="role-guide-heading"><span className="eyebrow">{language === 'bn' ? 'দ্রুত শুরু' : 'QUICK START'}</span><button type="button" className="icon-button" onClick={onDismiss} aria-label={language === 'bn' ? 'নির্দেশনা বন্ধ করুন' : 'Close guide'}><X size={18} /></button></div>
    <div className="role-guide-progress" aria-label={language === 'bn' ? `ধাপ ${index + 1} / ${steps.length}` : `Step ${index + 1} of ${steps.length}`}>{steps.map((_, position) => <span key={position} className={position <= index ? 'active' : ''} />)}</div>
    <h3>{language === 'bn' ? step.bn : step.en}</h3>
    <p>{language === 'bn' ? step.detailBn : step.detailEn}</p>
    <div className="role-guide-actions"><button type="button" className="secondary" onClick={() => { onNavigate(step.page); onDismiss(); }}>{language === 'bn' ? 'এই অংশ খুলুন' : 'Open this section'} <ArrowRight size={15} /></button>{index < steps.length - 1 ? <button type="button" className="primary" onClick={() => setIndex(value => value + 1)}>{language === 'bn' ? 'পরের ধাপ' : 'Next tip'}</button> : <button type="button" className="primary" onClick={onDismiss}>{language === 'bn' ? 'শুরু করি' : 'Get started'}</button>}</div>
  </section>;
}
