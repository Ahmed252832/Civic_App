const { app, BrowserWindow, ipcMain, dialog, Notification, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { createDatabase } = require('./database.cjs');
const { nearbyPlaces } = require('../shared/nearby-places.cjs');

let window;
let database;
let currentUserId = null;
const legacyLocalMode = process.env.CIVICPULSE_LEGACY_LOCAL === '1' || process.argv.includes('--dev') || (process.env.CIVICPULSE_TEST_MODE === '1' && !process.env.CIVICPULSE_TEST_REMOTE_URL);
const cloudUrl = process.env.CIVICPULSE_TEST_MODE === '1' && process.env.CIVICPULSE_TEST_REMOTE_URL
  ? process.env.CIVICPULSE_TEST_REMOTE_URL
  : 'https://civicpulse-dhaka.civicpulse-desktop.workers.dev/';
app.setName('CivicPulse');
if (process.platform === 'win32') app.setAppUserModelId('org.civicpulse.desktop');

const user = () => currentUserId ? database.userById(currentUserId) : null;
const requireUser = () => {
  const value = user();
  if (!value) throw new Error('Please sign in again.');
  return value;
};
const notify = body => {
  window?.webContents.send('civic:notice', body);
  if (app.isPackaged && process.env.CIVICPULSE_TEST_MODE !== '1' && Notification.isSupported()) {
    new Notification({ title: 'CivicPulse', body }).show();
  }
};

function createWindow() {
  window = new BrowserWindow({
    width: 1450, height: 920, minWidth: 1020, minHeight: 680,
    backgroundColor: '#0c1422', title: 'CivicPulse',
    webPreferences: {
      ...(legacyLocalMode ? { preload: path.join(__dirname, 'preload.cjs') } : {}),
      contextIsolation: true, nodeIntegration: false, sandbox: true
    }
  });
  if (legacyLocalMode) {
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', event => event.preventDefault());
    const developmentUrl = process.env.VITE_DEV_SERVER_URL || (process.argv.includes('--dev') && 'http://127.0.0.1:5173');
    if (developmentUrl) window.loadURL(developmentUrl);
    else window.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  } else {
    const trustedOrigin = new URL(cloudUrl).origin;
    window.webContents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith('https://')) void shell.openExternal(url);
      return { action: 'deny' };
    });
    window.webContents.on('will-navigate', (event, url) => { if (new URL(url).origin !== trustedOrigin) event.preventDefault(); });
    void window.loadURL(cloudUrl);
  }
}

app.whenReady().then(async () => {
  if (!legacyLocalMode) {
    createWindow();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
    return;
  }
  const dataDirectory = process.env.CIVICPULSE_DATA_DIR || app.getPath('userData');
  database = await createDatabase(path.join(dataDirectory, 'civicpulse.sqlite'));
  ipcMain.handle('civic:request', async (_event, method, payload = {}) => {
    try {
      if (method === 'config') return { ok: true, data: { demoMode: false, browserMode: false, setupRequired: database.setupRequired(), emailEnabled: false, offsiteBackupEnabled: false } };
      if (method === 'forgotPassword') throw new Error('Email recovery is not configured. Use a saved recovery code.');
      if (method === 'recoverWithCode') { database.consumeAccountToken(payload.code, 'recovery', payload.newPassword); currentUserId = null; return { ok: true, data: true }; }
      if (method === 'verifyEmail') { database.consumeAccountToken(payload.token, 'verify'); return { ok: true, data: true }; }
      if (method === 'resetPassword') { database.consumeAccountToken(payload.token, 'reset', payload.newPassword); currentUserId = null; return { ok: true, data: true }; }
      if (method === 'bootstrap') {
        if (process.env.CIVICPULSE_SETUP_KEY && payload.key !== process.env.CIVICPULSE_SETUP_KEY) throw new Error('Invalid setup key.');
        const account = database.bootstrapAdmin(payload);
        currentUserId = account.id;
        return { ok: true, data: account };
      }
      if (method === 'register') {
        if (database.setupRequired()) throw new Error('The platform owner must finish setup first.');
        const account = database.register(payload);
        currentUserId = account.id;
        return { ok: true, data: account };
      }
      if (method === 'login') {
        const account = database.login(payload.email, payload.password, payload.code);
        currentUserId = account.id;
        return { ok: true, data: account };
      }
      if (method === 'logout') { currentUserId = null; return { ok: true, data: true }; }
      if (method === 'session') return { ok: true, data: user() };
      if (method === 'publicReplay') return { ok: true, data: database.publicReplay(payload) };
      if (method === 'publicStreetPulse') return { ok: true, data: database.publicStreetPulse(payload) };
      const actor = requireUser();
      let result;
      switch (method) {
        case 'nearbyPlaces':
          if (actor.role !== 'citizen') throw new Error('Only citizens can search nearby places.');
          result = await nearbyPlaces(payload);
          break;
        case 'snapshot': result = database.snapshot(actor); break;
        case 'performance': result = database.performance(actor); break;
          case 'requestReopen': result = database.requestReopen(actor, payload); break;
          case 'decideReopen': result = database.decideReopen(actor, payload); break;
        case 'readNotification': result = database.readNotification(actor, payload); break;
        case 'areaSummary': result = database.areaSummary(actor, payload); break;
        case 'wardSummary': result = database.wardSummary(actor); break;
        case 'setLanguage': result = database.setLanguage(actor, payload); break;
        case 'listComplaints': result = database.listComplaints(actor, payload); break;
        case 'complaintDetail': result = database.complaintDetail(actor, payload); break;
        case 'streetAlertForComplaint': result = database.streetAlertForComplaint(actor, payload); break;
        case 'streetAlertAction': result = database.streetAlertAction(actor, payload); break;
        case 'streetAlertVote': result = database.streetAlertVote(actor, payload); break;
        case 'caseMessage': result = database.postCaseMessage(actor, payload); break;
        case 'nearby': result = database.nearby(actor, payload); break;
        case 'nearbyIssues': result = database.nearbyIssues(actor, payload); break;
        case 'wardBoundaryStatus': result = database.wardBoundaryStatus(actor); break;
        case 'wardBoundaryMap': result = database.wardBoundaryMap(actor, payload); break;
        case 'wardSuggestion': result = database.wardSuggestion(actor, payload); break;
        case 'importWardBoundaries': result = database.importWardBoundaries(actor, payload); break;
        case 'workQueue': result = database.workQueue(actor, payload); break;
        case 'missionCandidates': result = database.missionCandidates(actor, payload); break;
        case 'listMissions': result = database.listMissions(actor, payload); break;
        case 'missionDetail': result = database.missionDetail(actor, payload); break;
        case 'createMission': result = database.createMission(actor, payload); break;
        case 'missionAction': result = database.missionAction(actor, payload); break;
        case 'assignWork': result = database.assignWork(actor, payload); break;
        case 'setWorkPlan': result = database.setWorkPlan(actor, payload); break;
        case 'operationsHealth': result = database.operationsHealth(actor); break;
        case 'recordRecoveryCheck': result = database.recordRecoveryCheck(actor, payload); break;
        case 'recordManualBackup': result = database.recordManualBackup(actor); break;
        case 'create':
          result = database.createComplaint(actor, payload);
          notify(`Your report C-${1000 + result} was submitted.`);
          break;
        case 'action':
          result = database.act(actor, payload);
          notify(`Complaint C-${1000 + Number(payload.id)}: ${String(payload.action).replace(/^./, letter => letter.toUpperCase())} recorded.`);
          break;
        case 'feedback': result = database.submitFeedback(actor, payload); break;
        case 'manage': result = database.manage(actor, payload); break;
        case 'changePassword': result = database.changePassword(actor, payload); break;
        case 'issueRecoveryCode': result = database.issueRecoveryCode(actor, payload.password); break;
        case 'beginMfa': result = database.beginMfa(actor, payload.password); break;
        case 'confirmMfa': result = database.confirmMfa(actor, payload); break;
        case 'disableMfa': result = database.disableMfa(actor, payload); break;
        case 'requestPrivacyRemoval': result = database.requestPrivacyRemoval(actor, payload); break;
        case 'decidePrivacyRemoval': result = database.decidePrivacyRemoval(actor, payload); if (result.approved && currentUserId === result.userId) currentUserId = null; break;
        case 'retentionPreview': result = database.retentionPreview(actor, payload); break;
        case 'applyRetention': result = database.applyRetention(actor, payload); break;
        case 'complaintPurgePreview': result = database.complaintPurgePreview(actor); break;
        case 'purgeComplaints': result = database.purgeComplaints(actor, payload); break;
        case 'requestVerification': throw new Error('Email verification is available only on the hosted site when a mail provider is configured.');
        case 'beginBackup': result = database.beginBackup(actor, payload); break;
        case 'backupPage': result = database.backupPage(actor, payload); break;
        case 'endBackup': result = database.endBackup(actor, payload); break;
        case 'exportCsv': {
          if (!['admin','superadmin'].includes(actor.role)) throw new Error('Only administrators can export reports.');
          const lines = [['Code','Title','Category','Area','Severity','Priority','Status','Department','Reported','Closure target','Closed','Possible recurrence'],
            ...database.exportRows(actor).map(c => [c.code,c.title,c.category,c.area,c.severity,c.priority,c.status,c.department || '',c.created_at,c.resolution_due_at || '',c.closed_at || '',c.recurring])];
          const csvCell = value => {
            let text = String(value ?? '');
            if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
            return `"${text.replaceAll('"', '""')}"`;
          };
          const csv = '\uFEFF' + lines.map(row => row.map(csvCell).join(',')).join('\r\n');
          const selection = await dialog.showSaveDialog(window, { title: 'Export complaint report', defaultPath: 'civicpulse-complaints.csv', filters: [{ name: 'CSV', extensions: ['csv'] }] });
          if (!selection.canceled && selection.filePath) fs.writeFileSync(selection.filePath, csv, 'utf8');
          result = !selection.canceled;
          break;
        }
        case 'exportPdf': {
          if (!['admin','superadmin'].includes(actor.role)) throw new Error('Only administrators can export reports.');
          const selection = await dialog.showSaveDialog(window, { title: 'Save current view as PDF', defaultPath: 'civicpulse-report.pdf', filters: [{ name: 'PDF', extensions: ['pdf'] }] });
          if (!selection.canceled && selection.filePath) {
            const pdf = await window.webContents.printToPDF({ printBackground: true, pageSize: 'A4', landscape: true });
            fs.writeFileSync(selection.filePath, pdf);
          }
          result = !selection.canceled;
          break;
        }
        default: throw new Error('Unknown request.');
      }
      return { ok: true, data: result };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => database?.close());
