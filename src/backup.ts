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

type Archive = { format: string; createdAt: string; tables: Record<string, Record<string, unknown>[]> };

async function decodeEncryptedBackup(file: File, passphrase: string): Promise<Archive> {
  if (file.size > 200 * 1024 * 1024) throw new Error('Backup file is too large to check in this browser.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length < 50 || new TextDecoder().decode(bytes.slice(0, 5)) !== 'CPBK1') throw new Error('This is not a CivicPulse encrypted backup.');
  try {
    const salt = bytes.slice(5, 21), iv = bytes.slice(21, 33), body = bytes.slice(33);
    const material = await crypto.subtle.importKey('raw', encoder.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
    const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 310_000, hash: 'SHA-256' }, material, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, body);
    const archive = JSON.parse(new TextDecoder().decode(plain)) as Partial<Archive>;
    const required = ['departments','categories','users','complaints','updates','cycles','feedback','audit'];
    if (archive.format !== 'civicpulse-backup-v1' || !archive.tables || required.some(table => !Array.isArray(archive.tables?.[table])) || !archive.createdAt || !Number.isFinite(Date.parse(archive.createdAt))) throw new Error('Backup contents are incomplete.');
    return archive as Archive;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'OperationError') throw new Error('Could not decrypt the backup. Check the passphrase and file.');
    throw error;
  }
}

export async function verifyEncryptedBackup(file: File, passphrase: string): Promise<{ createdAt: string; accounts: number; complaints: number }> {
  const archive = await decodeEncryptedBackup(file, passphrase);
  return { createdAt: archive.createdAt, accounts: archive.tables.users.length, complaints: archive.tables.complaints.length };
}

export async function testRestoreEncryptedBackup(file: File, passphrase: string): Promise<{ createdAt: string; accounts: number; complaints: number }> {
  const archive = await decodeEncryptedBackup(file, passphrase);
  const tables = ['departments','categories','users','complaints','updates','cycles','feedback','notifications','escalation_events','reopen_requests','privacy_requests','audit','case_messages','ward_boundaries','recovery_checks','operational_events'];
  for (const table of tables) if (archive.tables[table] !== undefined && !Array.isArray(archive.tables[table])) throw new Error(`Invalid ${table} backup table.`);
  const relation: Record<string, Record<string,string>> = {
    categories: { department_id: 'departments' }, users: { department_id: 'departments' },
    complaints: { reporter_id: 'users', category_id: 'categories', department_id: 'departments', duplicate_of: 'complaints', recurrence_of: 'complaints', assignee_id: 'users' },
    updates: { complaint_id: 'complaints', actor_id: 'users' }, cycles: { complaint_id: 'complaints' },
    feedback: { complaint_id: 'complaints', cycle_id: 'cycles', user_id: 'users' },
    notifications: { user_id: 'users', complaint_id: 'complaints' }, escalation_events: { complaint_id: 'complaints' },
    reopen_requests: { complaint_id: 'complaints', user_id: 'users' }, privacy_requests: { user_id: 'users' },
    audit: { actor_id: 'users' }, case_messages: { complaint_id: 'complaints', sender_id: 'users' }, recovery_checks: { actor_id: 'users' }
  };
  const ids = Object.fromEntries(tables.map(table => [table, new Set((archive.tables[table] || []).map(row => Number(row.id))) ])) as Record<string, Set<number>>;
  for (const table of tables) for (const row of archive.tables[table] || []) for (const [column, target] of Object.entries(relation[table] || {})) {
    if (row[column] !== null && row[column] !== undefined && !ids[target].has(Number(row[column]))) throw new Error(`Backup has a broken ${table}.${column} reference.`);
  }
  const [{ default: initSqlJs }, { default: wasmUrl }] = await Promise.all([import('sql.js'), import('sql.js/dist/sql-wasm.wasm?url')]);
  const SQL = await initSqlJs({ locateFile: () => wasmUrl });
  const db = new SQL.Database();
  try {
    db.run('BEGIN TRANSACTION');
    for (const table of tables) {
      const rows = archive.tables[table] || [];
      const columns = [...new Set(rows.flatMap(row => Object.keys(row)))];
      if (columns.some(column => !/^[a-z_]+$/.test(column))) throw new Error(`Invalid column in ${table} backup table.`);
      db.run(`CREATE TABLE "${table}" ("id" INTEGER PRIMARY KEY${columns.filter(column => column !== 'id').map(column => `,"${column}" TEXT`).join('')})`);
      for (const row of rows) {
        if (!Number.isSafeInteger(Number(row.id))) throw new Error(`Invalid row ID in ${table}.`);
        const names = Object.keys(row);
        db.run(`INSERT INTO "${table}" (${names.map(name => `"${name}"`).join(',')}) VALUES (${names.map(() => '?').join(',')})`, names.map(name => row[name] as string | number | null));
      }
      if (db.exec(`SELECT COUNT(*) FROM "${table}"`)[0]?.values[0]?.[0] !== rows.length) throw new Error(`Restore count mismatch in ${table}.`);
    }
    db.run('COMMIT');
    if (db.exec('PRAGMA integrity_check')[0]?.values[0]?.[0] !== 'ok') throw new Error('Restored database failed integrity check.');
    return { createdAt: archive.createdAt, accounts: archive.tables.users.length, complaints: archive.tables.complaints.length };
  } finally { db.close(); }
}
