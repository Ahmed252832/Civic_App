import test from 'node:test';
import assert from 'node:assert/strict';
import nodeCrypto from 'node:crypto';
import worker from './worker.mjs';
import restore from '../scripts/restore-backup.cjs';

test('scheduled backup encrypts a restorable offsite archive', async () => {
  const key = nodeCrypto.randomBytes(32).toString('base64');
  const tables = Object.fromEntries(['departments','categories','users','complaints','updates','cycles','feedback','audit'].map(name => [name, []]));
  tables.users.push({ id: 1, email: 'private@example.test' });
  let saved;
  await worker.scheduled({}, {
    BACKUP_ENCRYPTION_KEY: key,
    BACKUP_BUCKET: { put: async (name, bytes) => { saved = { name, bytes: Buffer.from(bytes) }; } },
    CIVIC_STATE: { idFromName: () => 'test', get: () => ({ fetch: async () => Response.json({ ok: true, data: { format: 'civicpulse-offsite-v1', tables } }) }) }
  });
  assert.match(saved.name, /^civicpulse-dhaka\/\d{4}-\d\d-\d\d\.cpr2$/);
  assert.equal(saved.bytes.includes(Buffer.from('private@example.test')), false);
  assert.deepEqual(restore.decryptOffsiteBackup(saved.bytes, key).tables, tables);
  assert.throws(() => restore.decryptOffsiteBackup(saved.bytes, nodeCrypto.randomBytes(32).toString('base64')));
});

test('scheduled backup stays inactive without a configured bucket and key', async () => {
  await assert.doesNotReject(worker.scheduled({}, { CIVIC_STATE: { get: () => { throw new Error('should not run'); } } }));
});
