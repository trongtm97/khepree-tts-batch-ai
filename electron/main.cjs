const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const Store = require('electron-store');
const Importer = require('./io/importer.cjs');
const TextChunker = require('./io/text-chunker.cjs');
const { createStaticServer } = require('./static-server.cjs');
const paths = require('./paths.cjs');
const { EnginePoolManager } = require('./engine-pool-manager.cjs');
const { createJobsStore } = require('./jobs-store.cjs');
const {
    migrateSettingsOnLoad,
    migrateSettingsOnSave,
    SETTINGS_SCHEMA_VERSION,
    DEFAULT_ENGINE_SETTINGS,
} = require('./settings-migrate.cjs');
const { createEngineIpc } = require('./engine-ipc.cjs');
const { createModelDownloadIpc } = require('./model-download-ipc.cjs');
const { createHardwareIpc } = require('./hardware-ipc.cjs');
const { createBenchmarkIpc } = require('./benchmark-ipc.cjs');
const { registerSupertonicPackage } = require('./supertonic-package.cjs');
const { registerKittenPackages } = require('./kitten-package.cjs');
const { registerKokoroPackages } = require('./kokoro-package.cjs');
const { registerPiperPackages } = require('./piper-package.cjs');
const { registerChatterboxPackages } = require('./chatterbox-package.cjs');
const { registerQwen3Packages } = require('./qwen3-package.cjs');
const { registerSparkPackages } = require('./spark-package.cjs');
const { registerGptSovitsPackages } = require('./gpt-sovits-package.cjs');
const { KhepreeAccessService } = require('./khepree/access-service.cjs');

registerSupertonicPackage();
registerKittenPackages();
registerKokoroPackages();
registerPiperPackages();
registerChatterboxPackages();
registerQwen3Packages();
registerSparkPackages();
registerGptSovitsPackages();
const { KhepreeHeartbeatService } = require('./khepree/heartbeat.cjs');
const {
    PROTOCOL,
    registerAuthProtocolClient,
    extractAuthCallbackUrl,
} = require('./khepree/auth-protocol.cjs');

let khepree = null;
let khepreeHeartbeat = null;
let queuedAuthCallbackUrl = null;

function focusMainWindow() {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
}

async function routeAuthCallback(rawUrl) {
    if (!khepree) {
        queuedAuthCallbackUrl = rawUrl;
        return;
    }
    try {
        await khepree.handleCallback(rawUrl);
        queuedAuthCallbackUrl = null;
    } catch (error) {
        console.warn('Khepree auth callback failed', error);
    }
    focusMainWindow();
}

function requireKhepreeAccess() {
    try {
        khepree.assertProductAccess();
        return null;
    } catch (e) {
        return { error: e.message || 'KHEPREE_ACCESS_REQUIRED' };
    }
}

const store = new Store({
    defaults: {
        settings: {
            settingsSchemaVersion: SETTINGS_SCHEMA_VERSION,
            outputDir: '',
            model: 'v3turbo',
            voice: '',
            voiceNano: '',
            speed: 1.0,
            delayMin: 0,
            delayMax: 1,
            pythonPath: '',
            device: 'cpu',
            threads: 6,
            hfToken: '',
            silenceLinePunct: 0.35,
            silenceLineNoPunct: 0.55,
            silenceParagraph: 0.75,
            silenceChunk: 0.15,
            splitByLine: true,
            stripHash: true,
            useSeaG2p: true,
            volume: 1.0,
            pauseScale: 1.0,
            edgeVoiceMode: 'vietnamese',
            edgeVoice: 'vi-VN-HoaiMyNeural',
            edgeRate: 0,
            edgePitch: 0,
            edgeVolume: 0,
            batchWorkers: 2,
            chunkMaxChars: 1200,
            chunkAutoOnImport: false,
            selectedBatchEngine: 'vieneu',
            modelStorageDir: '',
            engineSettings: {
                vieneu: { ...DEFAULT_ENGINE_SETTINGS.vieneu },
                v3nano: { ...DEFAULT_ENGINE_SETTINGS.v3nano },
                edge: { ...DEFAULT_ENGINE_SETTINGS.edge },
            },
        },
    },
});

const PUBLIC_DIR = paths.getPublicDir();
const DIST_DIR = paths.getDistDir();
const DATA_DIR = path.join(app.getPath('userData'), 'data');
const HISTORY_FILE = path.join(DATA_DIR, 'tts-history.json');
const TEMP_DIR = path.join(app.getPath('userData'), 'tts-temp');

const ICON_PATH = path.join(PUBLIC_DIR, 'khepree-logo.png');

let mainWindow;
let staticServer = null;
const enginePools = new EnginePoolManager();
const isDev = !app.isPackaged;

function batchWorkerCount(settings) {
    return Math.max(1, Math.min(8, Math.round(Number(settings?.batchWorkers) || 1)));
}

function readJsonFile(filePath, fallback) {
    try {
        if (!fs.existsSync(filePath)) return fallback;
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (_) {
        return fallback;
    }
}

function writeJsonFile(filePath, value) {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = `${filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(value || [], null, 2), 'utf8');
    fs.renameSync(tmp, filePath);
}

function sanitizeFileName(name) {
    return String(name || 'output')
        .replace(/[\\/:*?"<>|]/g, '_')
        .replace(/\s+/g, '_')
        .slice(0, 120) || 'output';
}

function getSettings() {
    let settings = migrateSettingsOnLoad({ ...store.get('settings') });
    if (settings.model && settings.model !== 'v3turbo' && settings.model !== 'v3nano') {
        settings.model = 'v3turbo';
    }
    paths.setModelStorageDir(settings.modelStorageDir || '');
    // Persist one-time seed of engineSettings without thrashing every read:
    // only write back when schema/engineSettings were missing before migrate.
    const raw = store.get('settings') || {};
    const needsPersist = !raw.engineSettings
        || Number(raw.settingsSchemaVersion) < SETTINGS_SCHEMA_VERSION;
    if (needsPersist) {
        store.set('settings', settings);
    }
    return settings;
}

function getEngineOptions(settings) {
    return {
        device: settings.device || 'cpu',
        threads: settings.threads ?? 6,
        hfToken: settings.hfToken || undefined,
    };
}

function getSynthOptions(settings) {
    return {
        speed: settings.speed,
        silenceLinePunct: settings.silenceLinePunct,
        silenceLineNoPunct: settings.silenceLineNoPunct,
        silenceParagraph: settings.silenceParagraph,
        silenceChunk: settings.silenceChunk,
        splitByLine: settings.splitByLine,
        stripHash: settings.stripHash,
        useSeaG2p: settings.useSeaG2p !== false,
        volume: settings.volume,
    };
}

function getEdgeSynthOptions(settings) {
    return {
        edgeVoiceMode: settings.edgeVoiceMode || 'vietnamese',
        edgeRate: settings.edgeRate ?? 0,
        edgePitch: settings.edgePitch ?? 0,
        edgeVolume: settings.edgeVolume ?? 0,
        stripHash: settings.stripHash !== false,
        useSeaG2p: settings.useSeaG2p !== false,
    };
}

const jobsStore = createJobsStore(DATA_DIR, { readJsonFile, writeJsonFile });

function getChunkOptions(settings) {
    const s = settings || getSettings();
    return {
        chunkMaxChars: Math.max(400, Math.min(5000, Number(s.chunkMaxChars) || 1200)),
        chunkAutoOnImport: s.chunkAutoOnImport !== false,
    };
}

function applyImportChunking(rows) {
    return { rows, chunkMeta: null };
}

async function resolveAppUrl() {
    if (isDev) {
        return process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173/batch.html';
    }
    staticServer = await createStaticServer({ rootDir: DIST_DIR, publicDir: PUBLIC_DIR, port: 0 });
    return staticServer.url;
}

async function createWindow() {
    const winIcon = fs.existsSync(ICON_PATH) ? ICON_PATH : undefined;
    mainWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        minWidth: 1100,
        minHeight: 700,
        title: 'Khepree TTS Batch AI',
        icon: winIcon,
        webPreferences: {
            preload: path.join(__dirname, 'preload.cjs'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false,
        },
    });

    const url = await resolveAppUrl();
    await mainWindow.loadURL(url);
    if (process.argv.includes('--dev')) mainWindow.webContents.openDevTools();
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
    app.quit();
} else {
    app.on('second-instance', (_event, argv) => {
        const deepLink = extractAuthCallbackUrl(argv);
        if (deepLink) void routeAuthCallback(deepLink);
        else focusMainWindow();
    });

    app.on('open-url', (event, url) => {
        event.preventDefault();
        if (url.startsWith(`${PROTOCOL}://`)) void routeAuthCallback(url);
    });

    app.whenReady().then(async () => {
        Menu.setApplicationMenu(null);
        registerAuthProtocolClient();
        khepree = new KhepreeAccessService();
        khepreeHeartbeat = new KhepreeHeartbeatService(khepree);
        khepree.onChange((state) => {
            mainWindow?.webContents.send('khepree:state', state);
        });
        await khepree.initialize();
        khepreeHeartbeat.start();
        await createWindow();
        const deepLink = queuedAuthCallbackUrl || extractAuthCallbackUrl(process.argv);
        if (deepLink) await routeAuthCallback(deepLink);
    });

    app.on('window-all-closed', async () => {
        khepreeHeartbeat?.stop();
        enginePools.shutdownAll();
        if (staticServer) await staticServer.close();
        if (process.platform !== 'darwin') app.quit();
    });
    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
}

function sendLog(msg, type = 'info') {
    mainWindow?.webContents.send('log:message', { msg, type, time: new Date().toLocaleTimeString('vi-VN') });
}

ipcMain.handle('settings:load', () => getSettings());
ipcMain.handle('app:info', () => ({
    isPackaged: paths.isPackaged(),
    hasBundledPython: Boolean(paths.getBundledPythonExe()),
    hasBundledFfmpeg: Boolean(paths.resolveFfmpegBinary('ffmpeg')),
}));
ipcMain.handle('settings:save', (_, settings) => {
    const next = migrateSettingsOnSave(settings || {});
    // Reject unsafe modelStorageDir before persist
    if (next.modelStorageDir) {
        const safe = paths.resolveSafeOptionalModelsRoot(next.modelStorageDir);
        next.modelStorageDir = safe || '';
    }
    paths.setModelStorageDir(next.modelStorageDir || '');
    store.set('settings', next);
    enginePools.resizeAll(batchWorkerCount(next));
    return true;
});

ipcMain.handle('dialog:selectFolder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
    return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('dialog:selectFiles', async (_, filters) => {
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openFile', 'multiSelections'],
        filters: filters || [{ name: 'All Files', extensions: ['*'] }],
    });
    return result.canceled ? [] : result.filePaths;
});

ipcMain.handle('import:folder', async (_, folderPath) => {
    try {
        const rows = await Importer.importFromFolder(folderPath);
        return applyImportChunking(rows);
    } catch (e) {
        return { error: e.message };
    }
});

ipcMain.handle('import:excel', async (_, filePath) => {
    try {
        const rows = await Importer.importFromExcel(filePath);
        return applyImportChunking(rows);
    } catch (e) {
        return { error: e.message };
    }
});

ipcMain.handle('import:txt', async (_, filePaths) => {
    try {
        const rows = await Importer.importFromTxt(filePaths);
        return applyImportChunking(rows);
    } catch (e) {
        return { error: e.message };
    }
});

ipcMain.handle('chunk:text', (_, { text, maxChars }) => {
    try {
        const opts = getChunkOptions();
        const chunks = TextChunker.chunkText(text, {
            maxChars: maxChars || opts.chunkMaxChars,
        });
        return { chunks };
    } catch (e) {
        return { error: e.message };
    }
});

ipcMain.handle('import:downloadTemplate', async () => {
    const result = await dialog.showSaveDialog(mainWindow, {
        defaultPath: 'khepree-mau.xlsx',
        filters: [{ name: 'Excel', extensions: ['xlsx'] }],
    });
    if (!result.canceled) {
        await Importer.createExcelTemplate(result.filePath);
        return result.filePath;
    }
    return null;
});

ipcMain.handle('import:openBundledTemplate', async () => {
    try {
        const bundled = Importer.bundledTemplatePath(paths.getContentRoot());
        if (!fs.existsSync(bundled)) {
            await fs.promises.mkdir(path.dirname(bundled), { recursive: true });
            await Importer.createExcelTemplate(bundled);
        }
        await shell.openPath(bundled);
        return { path: bundled };
    } catch (e) {
        return { error: e.message };
    }
});

const engineApi = createEngineIpc({
    ipcMain,
    poolManager: enginePools,
    getSettings,
    getEngineOptions,
    getSynthOptions,
    getEdgeSynthOptions,
    batchWorkerCount,
    requireKhepreeAccess,
    sendLog,
    tempDir: TEMP_DIR,
});

createModelDownloadIpc({
    ipcMain,
    BrowserWindow,
    getMainWindow: () => mainWindow,
});

createHardwareIpc({ ipcMain });

createBenchmarkIpc({
    ipcMain,
    BrowserWindow,
    getMainWindow: () => mainWindow,
    engineInit: engineApi.engineInit,
    engineSynthesize: engineApi.engineSynthesize,
    engineUnload: engineApi.engineUnload,
    getSettings,
});

ipcMain.handle('khepree:getState', () => khepree?.publicState ?? { status: 'BOOTING', features: {} });
ipcMain.handle('khepree:startLogin', async () => {
    // Heal broken unpackaged protocol registry before opening the browser.
    registerAuthProtocolClient();
    await khepree.startLogin();
    return true;
});
ipcMain.handle('khepree:logout', async () => {
    await khepree.logout();
    return true;
});
ipcMain.handle('khepree:openProductPage', async () => {
    await khepree.openProductPage();
    return true;
});
ipcMain.handle('khepree:refreshOffers', async () => khepree.refreshOffers());
ipcMain.handle('khepree:startCheckout', async (_, { planPublicId, pricePublicId }) => {
    await khepree.startCheckout(planPublicId, pricePublicId);
    return true;
});
ipcMain.handle('khepree:refreshMe', async () => {
    try {
        await khepree.refreshMe();
        return khepree.publicState;
    } catch (e) {
        return { error: e.message };
    }
});

ipcMain.handle('tts:saveAudio', async (_, { buffer, outputDir, fileName, group, format }) => {
    try {
        const baseDir = outputDir || app.getPath('downloads');
        const targetDir = group ? path.join(baseDir, sanitizeFileName(group)) : baseDir;
        if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });

        const ext = (format === 'mp3' || String(fileName || '').toLowerCase().endsWith('.mp3')) ? 'mp3' : 'wav';
        let safeName = sanitizeFileName(fileName);
        if (!safeName.toLowerCase().endsWith(`.${ext}`)) {
            safeName = safeName.replace(/\.(wav|mp3)$/i, '');
            safeName += `.${ext}`;
        }

        let filePath = path.join(targetDir, safeName);
        let counter = 1;
        while (fs.existsSync(filePath)) {
            const stem = safeName.replace(/\.(wav|mp3)$/i, '');
            filePath = path.join(targetDir, `${stem}_${counter}.${ext}`);
            counter += 1;
        }

        fs.writeFileSync(filePath, Buffer.from(buffer));
        return { filePath };
    } catch (e) {
        return { error: e.message };
    }
});

ipcMain.handle('jobs:save', (_, { engine, jobs }) => {
    jobsStore.saveJobs(engine, jobs);
    return true;
});

ipcMain.handle('jobs:load', (_, engine) => jobsStore.loadJobs(engine));

ipcMain.handle('shell:openPath', (_, p) => {
    if (p && !fs.existsSync(p)) {
        const dir = path.dirname(p);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    }
    return shell.openPath(p || app.getPath('downloads'));
});

ipcMain.handle('shell:showItemInFolder', (_, filePath) => {
    if (filePath && fs.existsSync(filePath)) {
        shell.showItemInFolder(filePath);
        return { ok: true };
    }
    const dir = filePath ? path.dirname(filePath) : app.getPath('downloads');
    if (dir && !fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return shell.openPath(dir || app.getPath('downloads'));
});

ipcMain.handle('history:add', (_, entry) => {
    const list = readJsonFile(HISTORY_FILE, []);
    list.unshift({
        ...entry,
        time: entry.time || new Date().toISOString(),
    });
    writeJsonFile(HISTORY_FILE, list.slice(0, 200));
    return true;
});

ipcMain.handle('history:list', () => readJsonFile(HISTORY_FILE, []));

ipcMain.handle('shell:openExternal', (_, url) => shell.openExternal(url));
