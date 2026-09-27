const { app, BrowserWindow, ipcMain, dialog, Notification } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { createDatabase } = require('./database.cjs');

let window;
let database;
let currentUserId = null;
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
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true, nodeIntegration: false, sandbox: true
    }
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  const developmentUrl = process.env.VITE_DEV_SERVER_URL || (process.argv.includes('--dev') && 'http://127.0.0.1:5173');
  if (developmentUrl) window.loadURL(developmentUrl);
  else window.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
}

app.whenReady().then(async () => {
  const dataDirectory = process.env.CIVICPULSE_DATA_DIR || app.getPath('userData');
  database = await createDatabase(path.join(dataDirectory, 'civicpulse.sqlite'));
  ipcMain.handle('civic:request', async (_event, method, payload = {}) => {
    try {
      if (method === 'config') return { ok: true, data: { demoMode: false, browserMode: false, setupRequired: database.setupRequired() } };
      if (method === 'publicSnapshot') return { ok: true, data: database.publicSnapshot(payload) };
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
        const account = database.login(payload.email, payload.password);
        currentUserId = account.id;
        return { ok: true, data: account };
      }
      if (method === 'logout') { currentUserId = null; return { ok: true, data: true }; }
      if (method === 'session') return { ok: true, data: user() };
      const actor = requireUser();
      let result;
      switch (method) {
        case 'snapshot': result = database.snapshot(actor); break;
        case 'listComplaints': result = database.listComplaints(actor, payload); break;
        case 'complaintDetail': result = database.complaintDetail(actor, payload); break;
        case 'nearby': result = database.nearby(payload); break;
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
        case 'beginBackup': result = database.beginBackup(actor, payload); break;
        case 'backupPage': result = database.backupPage(actor, payload); break;
        case 'endBackup': result = database.endBackup(actor, payload); break;
        case 'exportCsv': {
          if (!['admin','superadmin'].includes(actor.role)) throw new Error('Only administrators can export reports.');
          const lines = [['Code','Title','Category','Area','Severity','Priority','Status','Department','Reported'],
            ...database.exportRows(actor).map(c => [c.code,c.title,c.category,c.area,c.severity,c.priority,c.status,c.department || '',c.created_at])];
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
