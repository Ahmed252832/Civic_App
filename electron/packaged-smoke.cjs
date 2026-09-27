const { _electron } = require('playwright-core');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

(async () => {
  const executablePath = process.argv[2];
  if (!executablePath || !fs.existsSync(executablePath)) throw new Error('Pass the packaged CivicPulse.exe path.');
  const testData = fs.mkdtempSync(path.join(os.tmpdir(), 'civicpulse-package-'));
  const application = await _electron.launch({ executablePath, env: { ...process.env, CIVICPULSE_DATA_DIR: testData, CIVICPULSE_SETUP_KEY: 'package-setup-key', CIVICPULSE_TEST_MODE: '1' } });
  try {
    const window = await application.firstWindow();
    await window.getByText('Set up the Dhaka workspace').waitFor({ timeout: 30000 });
    await window.getByLabel('Setup key').fill('package-setup-key');
    await window.getByLabel('Your name').fill('Packaged Owner');
    await window.getByLabel('Your email').fill('packaged@example.test');
    await window.getByLabel('Password').fill('packaged-password-123');
    await window.getByRole('button', { name: 'Create owner account' }).click();
    await window.locator('.hero h1').waitFor();
    const screenshot = path.join(__dirname, '..', 'artifacts', 'packaged.png');
    await window.screenshot({ path: screenshot });
    console.log(`Packaged app opened and owner setup succeeded. Screenshot: ${screenshot}`);
  } finally { await application.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
