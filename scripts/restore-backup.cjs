const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const initSqlJs = require('sql.js');
const { createDatabase } = require('../electron/database.cjs');

const TABLES = ['departments', 'categories', 'users', 'complaints', 'updates', 'cycles', 'feedback', 'notifications', 'escalation_events', 'reopen_requests', 'privacy_requests', 'audit', 'case_messages'];
const REQUIRED_TABLES = TABLES.filter(table => !['notifications','escalation_events','reopen_requests','privacy_requests','case_messages'].includes(table));
const MAX_BACKUP_BYTES = 200 * 1024 * 1024;

function decryptBackup(bytes, passphrase) {
  if (bytes.length < 50 || bytes.subarray(0, 5).toString() !== 'CPBK1') throw new Error('Unrecognized backup format.');
  const salt = bytes.subarray(5, 21), iv = bytes.subarray(21, 33);
  const body = bytes.subarray(33);
  const key = crypto.pbkdf2Sync(passphrase, salt, 310_000, 32, 'sha256');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(body.subarray(body.length - 16));
  const decrypted = Buffer.concat([decipher.update(body.subarray(0, body.length - 16)), decipher.final()]);
  const archive = JSON.parse(decrypted.toString('utf8'));
  if (archive.format !== 'civicpulse-backup-v1' || !archive.tables || REQUIRED_TABLES.some(table => !Array.isArray(archive.tables[table])) || TABLES.some(table => archive.tables[table] !== undefined && !Array.isArray(archive.tables[table]))) throw new Error('Backup contents are incomplete.');
  return archive;
}
function decryptOffsiteBackup(bytes, keyBase64) {
  if (bytes.length < 35 || bytes.subarray(0, 6).toString() !== 'CPR2V1') throw new Error('Unrecognized offsite backup format.');
  const key = Buffer.from(keyBase64 || '', 'base64');
  if (key.length !== 32) throw new Error('CIVICPULSE_BACKUP_KEY must be the original 32-byte base64 backup key.');
  const body = bytes.subarray(18);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, bytes.subarray(6, 18));
  decipher.setAuthTag(body.subarray(body.length - 16));
  const archive = JSON.parse(Buffer.concat([decipher.update(body.subarray(0, body.length - 16)), decipher.final()]).toString('utf8'));
  if (archive.format !== 'civicpulse-offsite-v1' || !archive.tables || REQUIRED_TABLES.some(table => !Array.isArray(archive.tables[table])) || TABLES.some(table => archive.tables[table] !== undefined && !Array.isArray(archive.tables[table]))) throw new Error('Offsite backup contents are incomplete.');
  return archive;
}

async function restoreNew(archive, output) {
  const target = path.resolve(output);
  if (fs.existsSync(target)) throw new Error('Restore target already exists. Choose a new file.');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.restoring-${process.pid}`;
  try {
    const starter = await createDatabase(temporary);
    starter.close();
    const SQL = await initSqlJs({ locateFile: () => require.resolve('sql.js/dist/sql-wasm.wasm') });
    const db = new SQL.Database(fs.readFileSync(temporary));
    try {
      db.run('PRAGMA foreign_keys=OFF');
      db.run('BEGIN TRANSACTION');
      for (const table of TABLES.slice().reverse()) db.run(`DELETE FROM ${table}`);
      for (const table of TABLES) {
        for (const row of archive.tables[table] || []) {
          const columns = Object.keys(row);
          if (!columns.length || columns.some(column => !/^[a-z_]+$/.test(column))) throw new Error(`Invalid ${table} row.`);
          db.run(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`, columns.map(column => row[column]));
        }
      }
      db.run('COMMIT');
      db.run('PRAGMA foreign_keys=ON');
      const integrity = db.exec('PRAGMA integrity_check')[0]?.values[0]?.[0];
      if (integrity !== 'ok' || db.exec('PRAGMA foreign_key_check')[0]?.values.length) throw new Error('Restored database failed integrity checks.');
      fs.writeFileSync(temporary, Buffer.from(db.export()), { flag: 'w' });
    } finally { db.close(); }
    fs.renameSync(temporary, target);
    return target;
  } catch (error) { if (fs.existsSync(temporary)) fs.rmSync(temporary); throw error; }
}

function secretPrompt(question) {
  if (!process.stdin.isTTY) throw new Error('Use an interactive terminal to enter the backup passphrase.');
  return new Promise(resolve => {
    let value = '';
    process.stdout.write(question);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    const onData = chunk => {
      const char = chunk.toString('utf8');
      if (char === '\r' || char === '\n') { process.stdin.off('data', onData); process.stdin.setRawMode(false); process.stdin.pause(); process.stdout.write('\n'); resolve(value); }
      else if (char === '\u0003') process.exit(130);
      else if (char === '\u007f' || char === '\b') value = value.slice(0, -1);
      else value += char;
    };
    process.stdin.on('data', onData);
  });
}

async function main() {
  const [input, output] = process.argv.slice(2);
  if (!input) throw new Error('Usage: node scripts/restore-backup.cjs <backup.cpbk|backup.cpr2> [new-database.sqlite]');
  const stat = fs.statSync(input);
  if (stat.size > MAX_BACKUP_BYTES) throw new Error('Backup exceeds the 200 MB restore limit.');
  const bytes = fs.readFileSync(input);
  const archive = bytes.subarray(0, 6).toString() === 'CPR2V1'
    ? decryptOffsiteBackup(bytes, process.env.CIVICPULSE_BACKUP_KEY)
    : decryptBackup(bytes, await secretPrompt('Backup passphrase: '));
  const counts = Object.fromEntries(TABLES.map(table => [table, (archive.tables[table] || []).length]));
  if (output) console.log(`Restored and checked: ${await restoreNew(archive, output)}`);
  else console.log('Backup decrypted and validated. Pass a new SQLite filename to restore.');
  console.log('Records:', counts);
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { decryptBackup, decryptOffsiteBackup, restoreNew };
