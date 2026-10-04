import { useState } from 'react';
import { useLocale } from './i18n';

export default function BeforeAfter({ before, after }: { before: string; after: string }) {
  const { language } = useLocale();
  const [overlay, setOverlay] = useState(false);
  const [split, setSplit] = useState(50);
  return <section className="detail-section comparison" aria-label={language === 'bn' ? 'কাজের আগে ও পরে' : 'Before and after repair'}>
    <div className="comparison-heading"><h4>{language === 'bn' ? 'কাজের আগে ও পরে' : 'Before and after'}</h4><button type="button" className="secondary" aria-pressed={overlay} onClick={() => setOverlay(value => !value)}>{overlay ? (language === 'bn' ? 'পাশাপাশি দেখুন' : 'Side by side') : (language === 'bn' ? 'একটির ওপর আরেকটি দেখুন' : 'Overlay view')}</button></div>
    {overlay ? <><div className="comparison-overlay"><img src={after} alt={language === 'bn' ? 'মেরামতের পরের ছবি' : 'After repair'} /><img className="comparison-before" src={before} alt={language === 'bn' ? 'অভিযোগের প্রথম ছবি' : 'Before repair'} style={{ clipPath: 'inset(0 ' + (100 - split) + '% 0 0)' }} /><span className="comparison-divider" style={{ left: `${split}%` }} /></div><label className="comparison-slider">{language === 'bn' ? 'আগের ছবির পরিমাণ' : 'Show more of the original photo'}<input type="range" min="0" max="100" value={split} onChange={event => setSplit(Number(event.target.value))} /></label></> : <div className="comparison-grid"><figure><img src={before} alt={language === 'bn' ? 'অভিযোগের প্রথম ছবি' : 'Before repair'} /><figcaption>{language === 'bn' ? 'অভিযোগের সময়' : 'When reported'}</figcaption></figure><figure><img src={after} alt={language === 'bn' ? 'মেরামতের পরের ছবি' : 'After repair'} /><figcaption>{language === 'bn' ? 'কাজ শেষ হওয়ার পর' : 'After the work'}</figcaption></figure></div>}
    <p className="method-note">{language === 'bn' ? 'ছবিগুলো ভিন্ন কোণ থেকে তোলা হতে পারে। স্থানটি নিজে যাচাই করে নিশ্চিত করুন।' : 'Photos may use different angles. Check the actual location before confirming the repair.'}</p>
  </section>;
}
