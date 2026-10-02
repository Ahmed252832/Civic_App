import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export type Language = 'en' | 'bn';
const translations: Record<string, string> = {
  'Overview': 'সারসংক্ষেপ', 'Complaints': 'অভিযোগ', 'Report an issue': 'সমস্যা জানান', 'Notifications': 'বিজ্ঞপ্তি',
  'Issue map': 'সমস্যার মানচিত্র', 'Community feedback': 'নাগরিক মতামত', 'Analytics': 'বিশ্লেষণ',
  'Finished work': 'সমাপ্ত কাজ', 'Administration': 'প্রশাসন', 'Account security': 'অ্যাকাউন্ট নিরাপত্তা',
  'Citizen': 'নাগরিক', 'Department staff': 'বিভাগীয় কর্মী', 'Administrator': 'প্রশাসক', 'Super administrator': 'প্রধান প্রশাসক',
  'Submitted': 'জমা হয়েছে', 'Under Review': 'যাচাই চলছে', 'Verified': 'যাচাই হয়েছে', 'Assigned': 'দায়িত্ব দেওয়া হয়েছে',
  'In Progress': 'কাজ চলছে', 'Awaiting Feedback': 'মতামতের অপেক্ষায়', 'Citizen Verified': 'নাগরিক নিশ্চিত করেছেন',
  'Finished': 'সমাপ্ত', 'Closed': 'বন্ধ', 'Reopened': 'পুনরায় খোলা', 'Rejected': 'বাতিল', 'Duplicate': 'পুনরাবৃত্ত অভিযোগ',
  'Low': 'কম', 'Medium': 'মাঝারি', 'High': 'উচ্চ', 'Critical': 'জরুরি', 'Normal': 'স্বাভাবিক', 'Urgent': 'অতিজরুরি',
  'Welcome back': 'আবার স্বাগতম', 'Join your community': 'আপনার এলাকায় যোগ দিন', 'Recover your account': 'অ্যাকাউন্ট ফিরে পান',
  'Full name': 'পুরো নাম', 'Email address': 'ইমেইল ঠিকানা', 'Password': 'পাসওয়ার্ড', 'Sign in': 'প্রবেশ করুন',
  'Create citizen account': 'নাগরিক অ্যাকাউন্ট তৈরি করুন', 'Back to sign in': 'প্রবেশ পাতায় ফিরুন',
  'New citizen? Create an account': 'নতুন নাগরিক? অ্যাকাউন্ট খুলুন', 'Your ward': 'আপনার ওয়ার্ড',
  'Choose city corporation': 'সিটি কর্পোরেশন বাছুন', 'Choose ward': 'ওয়ার্ড বাছুন', 'Dhaka North': 'ঢাকা উত্তর', 'Dhaka South': 'ঢাকা দক্ষিণ',
  'Report an issue.': 'সমস্যা জানান।', 'Tell us what happened': 'কী ঘটেছে জানান', 'Issue title': 'সমস্যার শিরোনাম',
  'Description': 'বিবরণ', 'Category': 'ধরন', 'Severity': 'গুরুত্ব', 'Choose category': 'ধরন বাছুন',
  'Pin the exact location': 'সঠিক স্থান চিহ্নিত করুন', 'Exact place name or nearby landmark': 'সঠিক স্থান বা কাছের পরিচিত স্থানের নাম',
  'Latitude': 'অক্ষাংশ', 'Longitude': 'দ্রাঘিমাংশ', 'Add evidence': 'প্রমাণ যুক্ত করুন', 'Choose a photo': 'ছবি বাছুন',
  'Photo attached': 'ছবি যুক্ত হয়েছে', 'Submit complaint': 'অভিযোগ জমা দিন', 'Submitting…': 'জমা হচ্ছে…',
  'Save draft': 'খসড়া সংরক্ষণ', 'Delete draft': 'খসড়া মুছুন', 'Draft saved on this device': 'এই ডিভাইসে খসড়া সংরক্ষিত',
  'Offline — your draft is saved. Submit when connected.': 'ইন্টারনেট নেই — খসড়া সংরক্ষিত আছে। সংযোগ এলে জমা দিন।',
  'Explore Dhaka': 'ঢাকা দেখুন', 'Issue map view': 'সমস্যার মানচিত্র', 'Density view': 'ঘনত্ব দেখুন',
  'Mark a new issue': 'নতুন সমস্যা চিহ্নিত করুন', 'Use my location': 'আমার অবস্থান ব্যবহার করুন',
  'Place pin': 'স্থান চিহ্নিত করুন',
  'Finding location…': 'অবস্থান খোঁজা হচ্ছে…', 'New report pin selected': 'নতুন অভিযোগের স্থান বাছা হয়েছে',
  'Select a point on the map': 'মানচিত্রে স্থান বাছুন', 'Continue to report': 'অভিযোগের ফর্মে যান',
  'All categories': 'সব ধরন', 'All statuses': 'সব অবস্থা', 'All wards': 'সব ওয়ার্ড',
  'Search by title, ID, ward, category…': 'শিরোনাম, আইডি, ওয়ার্ড বা ধরন খুঁজুন…',
  'My reports': 'আমার অভিযোগ', 'Assigned to my department': 'আমার বিভাগের অভিযোগ', 'All issues': 'সব অভিযোগ',
  'Needs verification': 'যাচাই প্রয়োজন', 'Awaiting feedback': 'মতামতের অপেক্ষায়', 'Overdue closure': 'সময়সীমা পেরিয়েছে',
  'Recurring issues': 'পুনরাবৃত্ত সমস্যা', 'Citizen verified': 'নাগরিক নিশ্চিত করেছেন',
  'Issue details': 'অভিযোগের বিবরণ', 'AREA': 'এলাকা', 'WARD': 'ওয়ার্ড', 'CATEGORY': 'ধরন', 'DEPARTMENT': 'বিভাগ',
  'PRIORITY': 'অগ্রাধিকার', 'REPORTED': 'জমার সময়', 'PLACE': 'স্থান', 'LOCATION': 'অবস্থান',
  'Closure target': 'সমাধানের সময়সীমা', 'Possible recurring issue': 'সম্ভাব্য পুনরাবৃত্ত সমস্যা',
  'Report evidence': 'অভিযোগের ছবি', 'Completion evidence': 'কাজ শেষের ছবি', 'Repair evidence by cycle': 'প্রতিবারের কাজের প্রমাণ',
  'Citizen review': 'নাগরিকের পর্যালোচনা', 'Verify the completed work': 'সম্পন্ন কাজ যাচাই করুন',
  'Was it resolved?': 'সমস্যা কি সমাধান হয়েছে?', 'Yes': 'হ্যাঁ', 'Partially': 'আংশিক', 'No': 'না',
  'Comment': 'মন্তব্য', 'Send verification and rating': 'যাচাই ও রেটিং পাঠান',
  'Private case conversation': 'ব্যক্তিগত অভিযোগ কথোপকথন', 'Write a message': 'বার্তা লিখুন',
  'Add a photo': 'ছবি যুক্ত করুন', 'Send message': 'বার্তা পাঠান', 'Sending…': 'পাঠানো হচ্ছে…',
  'Only you, administrators and the assigned department can read this conversation.': 'শুধু আপনি, প্রশাসক এবং দায়িত্বপ্রাপ্ত বিভাগ এই কথোপকথন পড়তে পারবেন।',
  'No messages yet. Ask a question or request another photo.': 'এখনও কোনো বার্তা নেই। প্রশ্ন করুন বা আরেকটি ছবি চাইতে পারেন।',
  'New case message': 'অভিযোগে নতুন বার্তা', 'Please review completed work': 'সম্পন্ন কাজ যাচাই করুন',
  'Due soon': 'সময়সীমা কাছাকাছি', 'Overdue': 'সময়সীমা পেরিয়েছে', 'Rework review needed': 'পুনরায় কাজের আবেদন দেখুন',
  'Rework approved': 'পুনরায় কাজ অনুমোদিত', 'Rework declined': 'পুনরায় কাজের আবেদন বাতিল',
  'No notifications yet': 'এখনও কোনো বিজ্ঞপ্তি নেই', 'unread': 'অপঠিত', 'Refresh': 'নতুন তথ্য আনুন',
  'Refresh case': 'অভিযোগের নতুন তথ্য আনুন', 'Close details': 'বিবরণ বন্ধ করুন',
  'Choose on map or enter coordinates using a keyboard.': 'মানচিত্রে বাছুন অথবা কিবোর্ড দিয়ে স্থানাঙ্ক লিখুন।',
  'Place name not recorded': 'স্থানের নাম সংরক্ষিত নেই', 'Approximate location': 'আনুমানিক অবস্থান',
  'Legacy area (ward not assigned)': 'পুরোনো এলাকা (ওয়ার্ড নির্ধারিত নয়)', 'Ward workload': 'ওয়ার্ডভিত্তিক কাজ',
  'Open issues': 'চলমান অভিযোগ', 'Waiting for verification': 'যাচাইয়ের অপেক্ষায়', 'Open ward queue': 'ওয়ার্ডের অভিযোগ দেখুন',
  'Activity timeline': 'কার্যক্রমের বিবরণ', 'New case message received': 'অভিযোগে নতুন বার্তা এসেছে',
  'No issues here yet': 'এখানে এখনো কোনো অভিযোগ নেই', 'Reports will appear as soon as they are submitted.': 'অভিযোগ জমা হলে এখানে দেখা যাবে।',
  'Your reports': 'আপনার অভিযোগ', 'Latest complaints': 'সাম্প্রতিক অভিযোগ', 'Review complaints': 'অভিযোগ দেখুন',
  'My report map': 'আমার অভিযোগের মানচিত্র', 'Explore map': 'মানচিত্র দেখুন', 'View all': 'সব দেখুন',
  'Total reports': 'মোট অভিযোগ', 'Critical alerts': 'জরুরি সতর্কতা', 'Completed': 'সম্পন্ন',
  'Not assigned': 'দায়িত্ব দেওয়া হয়নি',
  'Not applicable to this case status': 'এই অবস্থায় প্রযোজ্য নয়',
  'Administrator actions': 'প্রশাসকের কাজ', 'Department work': 'বিভাগের কাজ',
  'Note': 'নোট', 'Verify': 'যাচাই করুন', 'Reject': 'বাতিল করুন', 'Assign department': 'বিভাগে পাঠান',
  'Select department': 'বিভাগ বাছুন', 'Priority': 'অগ্রাধিকার', 'Update priority': 'অগ্রাধিকার বদলান',
  'Start work': 'কাজ শুরু করুন', 'Work note': 'কাজের নোট', 'Add progress note': 'অগ্রগতির নোট দিন',
  'Completion photo required': 'কাজ শেষের ছবি আবশ্যক', 'Photo ready to attach': 'ছবি যুক্ত করার জন্য প্রস্তুত',
  'Mark work completed': 'কাজ শেষ চিহ্নিত করুন', 'Move to Finished work': 'সমাপ্ত কাজে সরান',
  'Reopen case': 'আবার খুলুন', 'Reopen finished case': 'সমাপ্ত অভিযোগ আবার খুলুন',
  'Rework requests': 'পুনরায় কাজের আবেদন', 'Approve rework': 'পুনরায় কাজ অনুমোদন', 'Decline': 'বাতিল করুন',
  'Repair failed again?': 'সমস্যা আবার দেখা দিয়েছে?', 'What failed again?': 'কোন সমস্যা আবার হয়েছে?',
  'Request rework review': 'পুনরায় কাজের আবেদন করুন', 'No feedback yet': 'এখনো মতামত নেই',
  'Show all wards': 'সব ওয়ার্ড দেখুন', 'Show fewer wards': 'কম ওয়ার্ড দেখুন',
  'CASE MANAGEMENT': 'অভিযোগ ব্যবস্থাপনা', 'GEOGRAPHIC INTELLIGENCE': 'অবস্থানভিত্তিক তথ্য',
  'RECENT ACTIVITY': 'সাম্প্রতিক কার্যক্রম', 'DHAKA SNAPSHOT': 'ঢাকার সংক্ষিপ্ত চিত্র',
  'Issues by category': 'ধরন অনুযায়ী সমস্যা', 'DHAKA WARDS': 'ঢাকার ওয়ার্ড',
  'Your own reports': 'আপনার অভিযোগ', 'All reports': 'সব অভিযোগ',
  'Marked duplicate': 'একই অভিযোগ হিসেবে চিহ্নিত', 'Priority changed': 'অগ্রাধিকার বদলেছে',
  'Recurrence dismissed': 'পুনরাবৃত্তির সতর্কতা বাদ দেওয়া হয়েছে', 'Work started': 'কাজ শুরু হয়েছে',
  'Progress update': 'অগ্রগতি জানানো হয়েছে', 'Work completed': 'কাজ শেষ হয়েছে',
  'Moved to finished work': 'সমাপ্ত কাজে সরানো হয়েছে',
  'Citizen confirmed resolution': 'নাগরিক সমাধান নিশ্চিত করেছেন', 'Rework requested': 'পুনরায় কাজের আবেদন হয়েছে',
  'Deadline due soon': 'সমাধানের সময়সীমা কাছাকাছি', 'Deadline overdue': 'সমাধানের সময়সীমা পেরিয়েছে',
  'YOUR UPDATES': 'আপনার খবর', 'Road Damage': 'রাস্তার ক্ষতি', 'Potholes': 'রাস্তার গর্ত',
  'Garbage / Waste': 'আবর্জনা', 'Drainage Problems': 'ড্রেনের সমস্যা', 'Water Leakage': 'পানির লিক',
  'Flooding / Waterlogging': 'জলাবদ্ধতা', 'Streetlight Failure': 'সড়কবাতি নষ্ট',
  'Public Safety': 'জননিরাপত্তা', 'Other': 'অন্যান্য',
  'Road Maintenance': 'সড়ক রক্ষণাবেক্ষণ', 'Waste Management': 'বর্জ্য ব্যবস্থাপনা',
  'Drainage & Water': 'ড্রেন ও পানি', 'Electrical Services': 'বিদ্যুৎ সেবা',
  'Citizen confirmed': 'নাগরিক নিশ্চিত করেছেন', 'Feedback open': 'মতামত দেওয়া যাবে',
  'Needs administrative review': 'প্রশাসকের পর্যালোচনা প্রয়োজন',
  'Ready for super admin review': 'প্রধান প্রশাসকের পর্যালোচনার অপেক্ষায়',
  'Filed as Finished work': 'সমাপ্ত কাজ হিসেবে নথিভুক্ত', 'Awaiting confirmation': 'নিশ্চিতকরণের অপেক্ষায়',
  'What changed on site?': 'স্থানে কী পরিবর্তন হয়েছে?', 'Owner decision': 'প্রধান প্রশাসকের সিদ্ধান্ত',
  'Nearby report in the same category': 'কাছাকাছি একই ধরনের অভিযোগ',
  'Choose an original report': 'মূল অভিযোগ বাছুন', 'Mark as duplicate': 'একই অভিযোগ হিসেবে চিহ্নিত করুন',
  'Dismiss recurrence flag': 'পুনরাবৃত্তির চিহ্ন বাদ দিন',
  'Reason or instruction for the timeline': 'কারণ বা নির্দেশনা লিখুন',
  'What has been done?': 'কী কাজ হয়েছে?',
};

export const currentLanguage = (): Language => { try { return localStorage.getItem('civicpulse-language') === 'bn' ? 'bn' : 'en'; } catch { return 'en'; } };
const LocaleContext = createContext<{ language: Language; setLanguage: (next: Language) => void }>({ language: 'en', setLanguage: () => {} });
export function LocaleProvider({ children }: { children: ReactNode }) {
  const [language, change] = useState<Language>(currentLanguage);
  useEffect(() => { document.documentElement.lang = language; }, [language]);
  const setLanguage = (next: Language) => {
    change(next);
    document.documentElement.lang = next;
    try { localStorage.setItem('civicpulse-language', next); } catch { /* Device storage may be unavailable. */ }
  };
  return <LocaleContext.Provider value={{ language, setLanguage }}>{children}</LocaleContext.Provider>;
}
export const useLocale = () => {
  const { language, setLanguage } = useContext(LocaleContext);
  return { language, setLanguage, t: (english: string) => language === 'bn' ? translations[english] || english : english };
};
export const localizeStatus = (value: string, language: Language) => language === 'bn' ? translations[value] || value : value;
export const localizeNotification = (title: string, message: string, language: Language) => {
  if (language === 'en') return { title, message };
  const code = message.match(/C-\d+/)?.[0] || '';
  const localizedTitle = translations[title] || title;
  if (title === 'New case message') return { title: localizedTitle, message: `${code}: ব্যক্তিগত কথোপকথনে নতুন বার্তা আছে। খুলে পড়ুন ও উত্তর দিন।` };
  if (title === 'Please review completed work') return { title: localizedTitle, message: `${code}: বিভাগ কাজ শেষ করেছে। অভিযোগ খুলে যাচাই ও রেটিং দিন।` };
  if (title === 'Due soon') return { title: localizedTitle, message: `${code}: সমাধানের সময়সীমা কাছাকাছি।` };
  if (title === 'Overdue') return { title: localizedTitle, message: `${code}: সমাধানের সময়সীমা পেরিয়েছে। প্রশাসকের পর্যালোচনা প্রয়োজন।` };
  if (title === 'Rework review needed') return { title: localizedTitle, message: `${code}: নাগরিক জানিয়েছেন সমস্যাটি আবার দেখা দিয়েছে।` };
  if (title === 'Rework approved') return { title: localizedTitle, message: `${code}: পুনরায় কাজের আবেদন অনুমোদিত হয়েছে। অভিযোগ খুলে বিস্তারিত দেখুন।` };
  if (title === 'Rework declined') return { title: localizedTitle, message: `${code}: পুনরায় কাজের আবেদন বাতিল হয়েছে। অভিযোগ খুলে সিদ্ধান্ত দেখুন।` };
  return { title: localizedTitle, message };
};
