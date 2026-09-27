import { request } from './api';

type BackupPage = { rows: Record<string, unknown>[]; nextCursor: number | null };
const encoder = new TextEncoder();
const MAX_PLAINTEXT_BYTES = 150 * 1024 * 1024;

export async function downloadEncryptedBackup(password: string, passphrase: string, progress: (message: string) => void): Promise<void> {
  if (passphrase.length < 16) throw new Error('Use a backup passphrase of at least 16 characters.');
  const access = await request<{ token: string; tables: string[] }>('beginBackup', { password });
  try {
    const tables: Record<string, Record<string, unknown>[]> = {};
    for (const table of access.tables) {
      progress(`Collecting ${table}…`);
      const rows: Record<string, unknown>[] = [];
      let cursor: number | null = null;
      do {
        const page: BackupPage = await request('backupPage', { token: access.token, table, cursor });
        rows.push(...page.rows);
        cursor = page.nextCursor;
      } while (cursor !== null);
      tables[table] = rows;
    }
    progress('Encrypting backup…');
    const plaintext = encoder.encode(JSON.stringify({ format: 'civicpulse-backup-v1', createdAt: new Date().toISOString(), tables }));
    if (plaintext.byteLength > MAX_PLAINTEXT_BYTES) throw new Error('Backup exceeds the 150 MB browser export limit. Use Cloudflare recovery tools for this data size.');
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const keyMaterial = await crypto.subtle.importKey('raw', encoder.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
    const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 310_000, hash: 'SHA-256' }, keyMaterial, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
    const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
    const blob = new Blob(['CPBK1', salt, iv, encrypted], { type: 'application/octet-stream' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `civicpulse-${new Date().toISOString().slice(0, 10)}.cpbk`;
    document.body.append(link);
    link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 60_000);
    progress('Encrypted backup downloaded. Store the passphrase separately.');
  } finally {
    await request('endBackup', { token: access.token }).catch(() => {});
  }
}
