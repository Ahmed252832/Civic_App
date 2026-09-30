import { subscribe, unsubscribe, getCurrentSubscription } from '@mmmike/web-push/client';
import { request } from './api';

export const pushAvailable = () => location.protocol === 'https:' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

export async function enablePush(publicKey: string): Promise<'enabled' | 'denied' | 'unsupported'> {
  if (!pushAvailable()) return 'unsupported';
  await navigator.serviceWorker.register('/sw.js');
  const result = await subscribe(publicKey);
  if (result.status !== 'subscribed') return result.status;
  await request('pushSubscribe', { subscription: result.subscription });
  return 'enabled';
}

export async function disablePush(): Promise<void> {
  if (!pushAvailable()) return;
  const current = await getCurrentSubscription();
  if (current) await request('pushUnsubscribe', { endpoint: current.endpoint });
  await unsubscribe();
}
