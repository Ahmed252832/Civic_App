import { useEffect, useRef } from 'react';

declare global { interface Window { turnstile?: { render: (element: HTMLElement, options: Record<string, unknown>) => string; remove: (id: string) => void } } }

let loader: Promise<void> | null = null;
function loadTurnstile(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  if (!loader) loader = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => { loader = null; reject(new Error('Security check could not load. Check your connection.')); };
    document.head.appendChild(script);
  });
  return loader;
}

export function TurnstileChallenge({ siteKey, onToken }: { siteKey: string; onToken: (token: string) => void }) {
  const element = useRef<HTMLDivElement>(null);
  const callback = useRef(onToken);
  callback.current = onToken;
  useEffect(() => {
    let active = true;
    let widget: string | undefined;
    void loadTurnstile().then(() => {
      if (active && element.current && window.turnstile) widget = window.turnstile.render(element.current, {
        sitekey: siteKey,
        theme: 'dark',
        size: window.innerWidth < 500 ? 'compact' : 'flexible',
        callback: (token: string) => callback.current(token),
        'expired-callback': () => callback.current(''),
        'error-callback': () => callback.current('')
      });
    }).catch(() => callback.current(''));
    return () => { active = false; if (widget && window.turnstile) window.turnstile.remove(widget); };
  }, [siteKey]);
  return <div className="turnstile-wrap" ref={element} aria-label="Security check" />;
}
