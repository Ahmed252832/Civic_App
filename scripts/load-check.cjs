const { performance } = require('node:perf_hooks');
const { createDatabase } = require('../electron/database.cjs');

const sample = { description: 'Synthetic load-check report', categoryId: 2, area: 'Dhanmondi', latitude: 23.7469, longitude: 90.3754, severity: 'Medium' };
const percentile = (values, p) => values.slice().sort((a, b) => a - b)[Math.ceil(values.length * p) - 1].toFixed(1);

async function main() {
  const db = await createDatabase(':memory:');
  try {
    const owner = db.bootstrapAdmin({ name: 'Load Check Owner', email: 'owner@load.test', password: 'load-test-owner-password' });
    const citizen = db.register({ name: 'Load Check Citizen', email: 'citizen@load.test', area: 'Dhanmondi', password: 'load-test-citizen-password' });
    for (let i = 1; i <= 3000; i++) db.createComplaint(citizen, { ...sample, title: `Synthetic road issue ${i}` });
    const durations = [];
    for (let i = 0; i < 60; i++) {
      const start = performance.now();
      const page = db.listComplaints(owner, { limit: 25, query: i % 3 ? '' : 'Synthetic road issue 1' });
      if (page.complaints.length > 25) throw new Error('Page limit exceeded.');
      durations.push(performance.now() - start);
    }
    console.log(`3,000 synthetic reports, 60 local sequential list reads: p50 ${percentile(durations, 0.5)} ms, p95 ${percentile(durations, 0.95)} ms; no live data or network involved.`);
  } finally { db.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
