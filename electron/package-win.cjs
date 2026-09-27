const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

if (process.platform !== 'win32') throw new Error('Build the Windows installer on Windows.');
const project = path.join(__dirname, '..');
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'civicpulse-build-'));
const cache = path.join(os.tmpdir(), 'civicpulse-builder-cache');
const result = spawnSync(process.execPath, [
  require.resolve('electron-builder/out/cli/cli.js'),
  '--win', 'nsis', `--config.directories.output=${output}`
], { cwd: project, stdio: 'inherit', env: { ...process.env, ELECTRON_BUILDER_CACHE: cache } });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status || 1);
const installer = fs.readdirSync(output).find(name => /^CivicPulse Setup .*\.exe$/.test(name));
if (!installer) throw new Error('Installer was not created.');
const destination = path.join(project, installer);
fs.copyFileSync(path.join(output, installer), destination);
console.log(`Installer ready: ${destination}`);
