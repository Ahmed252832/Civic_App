const fs = require('node:fs');
const path = require('node:path');
const initSqlJs = require('sql.js');
const { createStore, haversineMeters } = require('../shared/store.cjs');

async function createDatabase(filePath, options = {}) {
  const wasmPath = require.resolve('sql.js/dist/sql-wasm.wasm').replace('app.asar', 'app.asar.unpacked');
  const SQL = await initSqlJs({ locateFile: () => wasmPath });
  const db = fs.existsSync(filePath) ? new SQL.Database(fs.readFileSync(filePath)) : new SQL.Database();
  db.run('PRAGMA foreign_keys = ON');
  const all = (sql, params = []) => {
    const statement = db.prepare(sql);
    try { statement.bind(params); const rows = []; while (statement.step()) rows.push(statement.getAsObject()); return rows; }
    finally { statement.free(); }
  };
  const one = (sql, params = []) => all(sql, params)[0] || null;
  const run = (sql, params = []) => db.run(sql, params);
  const id = () => one('SELECT last_insert_rowid() AS id').id;
  const persist = () => {
    if (filePath === ':memory:') return;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const temp = `${filePath}.tmp`;
    fs.writeFileSync(temp, Buffer.from(db.export()));
    fs.renameSync(temp, filePath);
    db.run('PRAGMA foreign_keys = ON');
  };
  const transact = fn => {
    db.run('BEGIN TRANSACTION');
    try { const result = fn(); db.run('COMMIT'); persist(); return result; }
    catch (error) { db.run('ROLLBACK'); throw error; }
  };
  return createStore({ all, one, run, id, persist, transact, close: () => db.close() }, options);
}
module.exports = { createDatabase, haversineMeters };
