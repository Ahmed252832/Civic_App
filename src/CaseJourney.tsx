import type { Role, Complaint } from './types';
import { useLocale } from './i18n';

type Step = { en: string; bn: string; actorEn: string; actorBn: string };

function nextStep(complaint: Complaint): Step {
  switch (complaint.status) {
    case 'Submitted':
    case 'Under Review':
      return { en: 'An administrator will check the report.', bn: 'প্রশাসক অভিযোগটি যাচাই করবেন।', actorEn: 'Administrator', actorBn: 'প্রশাসক' };
    case 'Verified':
      return { en: 'An administrator will assign the responsible department.', bn: 'প্রশাসক দায়িত্বপ্রাপ্ত বিভাগ নির্ধারণ করবেন।', actorEn: 'Administrator', actorBn: 'প্রশাসক' };
    case 'Assigned':
    case 'Reopened':
      return { en: 'The department will start work and post an update.', bn: 'বিভাগ কাজ শুরু করে অগ্রগতি জানাবে।', actorEn: complaint.department || 'Department team', actorBn: complaint.department || 'বিভাগীয় দল' };
    case 'In Progress':
      return { en: 'The department will complete the repair and add evidence.', bn: 'বিভাগ কাজ শেষ করে প্রমাণের ছবি দেবে।', actorEn: complaint.department || 'Department team', actorBn: complaint.department || 'বিভাগীয় দল' };
    case 'Awaiting Feedback':
      return { en: 'Check the completed work, then confirm and rate it.', bn: 'সম্পন্ন কাজ দেখে নিশ্চিত করুন এবং রেটিং দিন।', actorEn: 'You, the reporter', actorBn: 'আপনি, অভিযোগকারী' };
    case 'Citizen Verified':
      return { en: 'The super administrator will file this as Finished work.', bn: 'প্রধান প্রশাসক কাজটি সমাপ্ত হিসেবে নথিভুক্ত করবেন।', actorEn: 'Super administrator', actorBn: 'প্রধান প্রশাসক' };
    case 'Finished':
      return { en: 'This case is complete. A rework request is available for 14 days if the problem returns.', bn: 'কাজটি সমাপ্ত। সমস্যা ফিরে এলে ১৪ দিনের মধ্যে পুনরায় কাজের আবেদন করতে পারবেন।', actorEn: 'No action due', actorBn: 'এখন কোনো কাজ বাকি নেই' };
    default:
      return { en: 'Check the activity timeline for the final decision.', bn: 'চূড়ান্ত সিদ্ধান্ত জানতে কার্যক্রমের বিবরণ দেখুন।', actorEn: 'No action due', actorBn: 'এখন কোনো কাজ বাকি নেই' };
  }
}

export function nextStepLabel(complaint: Complaint, language: 'en' | 'bn') {
  const step = nextStep(complaint);
  return language === 'bn' ? step.bn : step.en;
}

export default function CaseJourney({ complaint, role }: { complaint: Complaint; role: Role }) {
  const { language, t } = useLocale();
  const step = nextStep(complaint);
  const citizen = role === 'citizen';
  const due = complaint.resolution_due_at && !['Rejected', 'Duplicate', 'Closed', 'Citizen Verified', 'Finished'].includes(complaint.status)
    ? new Date(complaint.resolution_due_at.replace(' ', 'T') + (complaint.resolution_due_at.includes('Z') ? '' : 'Z')) : null;
  const nextAction = !citizen && complaint.next_action_at ? new Date(complaint.next_action_at.replace(' ', 'T') + (complaint.next_action_at.includes('Z') ? '' : 'Z')) : null;
  const format = (value: Date) => value.toLocaleString(language === 'bn' ? 'bn-BD' : 'en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const awaitingCitizen = complaint.status === 'Awaiting Feedback';
  return <section className={`detail-section case-journey ${awaitingCitizen ? 'case-journey-action' : ''}`} aria-label={language === 'bn' ? 'এরপর কী হবে' : 'What happens next'}>
    <span className="eyebrow">{language === 'bn' ? 'পরবর্তী ধাপ' : 'NEXT STEP'}</span>
    <h4>{language === 'bn' ? step.bn : step.en}</h4>
    <div className="journey-facts">
      <div><small>{language === 'bn' ? 'কার দায়িত্ব' : 'Who acts next'}</small><strong>{language === 'bn' ? t(step.actorBn) : step.actorEn}</strong></div>
      {due && <div><small>{language === 'bn' ? 'সমাধানের লক্ষ্য সময়' : 'Target resolution date'}</small><strong>{format(due)}</strong></div>}
      {nextAction && <div><small>{language === 'bn' ? 'কর্মীদের পরবর্তী কাজ' : 'Team next action'}</small><strong>{format(nextAction)}</strong></div>}
    </div>
    {due && <p>{language === 'bn' ? 'লক্ষ্য সময় একটি পরিকল্পনা; কাজ শেষ হওয়ার নিশ্চয়তা নয়। নতুন তথ্য এলে কার্যক্রমের বিবরণে দেখবেন।' : 'The target is a planning date, not a promise of completion. New updates appear in the activity timeline.'}</p>}
    {awaitingCitizen && citizen && <p className="journey-callout">{t('Verify the completed work')} ↓</p>}
  </section>;
}
