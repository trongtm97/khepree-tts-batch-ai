/**
 * Electron smoke: EngineService against real generic IPC.
 * Run: electron scripts/test-engine-service.cjs
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { app } = require('electron');

const paths = require('../electron/paths.cjs');
const { EnginePoolManager } = require('../electron/engine-pool-manager.cjs');
const { createEngineIpc } = require('../electron/engine-ipc.cjs');

function createMockIpc() {
    const handlers = new Map();
    return {
        handlers,
        handle(channel, fn) {
            handlers.set(channel, fn);
        },
        async invoke(channel, payload) {
            const fn = handlers.get(channel);
            if (!fn) throw new Error(`No handler: ${channel}`);
            return fn(null, payload);
        },
    };
}

app.whenReady().then(async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'khepree-svc-'));
    const tempDir = path.join(tmp, 'tts-temp');
    fs.mkdirSync(tempDir, { recursive: true });

    const settings = {
        model: 'v3turbo',
        pythonPath: '',
        device: 'cpu',
        threads: 4,
        batchWorkers: 1,
        speed: 1,
        edgeVoiceMode: 'vietnamese',
        edgeRate: 0,
        edgePitch: 0,
        edgeVolume: 0,
        stripHash: true,
        useSeaG2p: true,
        silenceLinePunct: 0.1,
        silenceLineNoPunct: 0.1,
        silenceParagraph: 0.1,
        silenceChunk: 0.05,
        splitByLine: true,
        volume: 1,
    };

    const ipc = createMockIpc();
    const poolManager = new EnginePoolManager({ defaultMaxSize: 1 });

    createEngineIpc({
        ipcMain: ipc,
        poolManager,
        getSettings: () => settings,
        getEngineOptions: (s) => ({ device: s.device || 'cpu', threads: s.threads ?? 4 }),
        getSynthOptions: (s) => ({
            speed: s.speed,
            silenceLinePunct: s.silenceLinePunct,
            silenceLineNoPunct: s.silenceLineNoPunct,
            silenceParagraph: s.silenceParagraph,
            silenceChunk: s.silenceChunk,
            splitByLine: s.splitByLine,
            stripHash: s.stripHash,
            useSeaG2p: s.useSeaG2p,
            volume: s.volume,
        }),
        getEdgeSynthOptions: (s) => ({
            edgeVoiceMode: s.edgeVoiceMode,
            edgeRate: s.edgeRate,
            edgePitch: s.edgePitch,
            edgeVolume: s.edgeVolume,
            stripHash: s.stripHash,
            useSeaG2p: s.useSeaG2p,
        }),
        batchWorkerCount: () => 1,
        requireKhepreeAccess: () => null,
        sendLog: () => {},
        tempDir,
    });

    globalThis.window = {
        api: {
            listEngines: () => ipc.invoke('engine:list'),
            engineInit: (d) => ipc.invoke('engine:init', d),
            engineSynthesize: (d) => ipc.invoke('engine:synthesize', d),
            engineReload: (id) => ipc.invoke('engine:reload', id),
            engineUnload: (id) => ipc.invoke('engine:unload', id),
            engineStatus: (id) => ipc.invoke('engine:status', id),
        },
    };

    try {
        const mod = await import(pathToFileURL(
            path.join(__dirname, '..', 'src', 'batch', 'engine-service.js')
        ).href);
        const { EngineService } = mod;

        const expect = {
            vieneu: 'wav',
            v3nano: 'wav',
            edge: 'mp3',
        };

        for (const engineId of ['vieneu', 'v3nano', 'edge']) {
            const svc = new EngineService(engineId);
            assert.strictEqual(svc.engineId, engineId);

            const voices = await svc.init({}, settings);
            assert.ok(Array.isArray(voices), `${engineId} voices`);
            assert.ok(svc.ready);

            const st = await svc.status();
            assert.ok(!st.error, `${engineId} status: ${st.error}`);
            assert.strictEqual(st.engineId, engineId);

            const voice = voices[0]?.id || voices[0]?.name || null;
            const blob = await svc.synthesize('Xin chào service.', voice, settings, {});
            assert.ok(blob && typeof blob.size === 'number', `${engineId} blob`);
            assert.ok(blob.size > 100, `${engineId} blob size`);
            assert.strictEqual(svc.outputFormat, expect[engineId], `${engineId} format`);
            const mime = expect[engineId] === 'mp3' ? 'audio/mpeg' : 'audio/wav';
            assert.strictEqual(blob.type, mime, `${engineId} mime`);

            await svc.unload();
            assert.strictEqual(svc.ready, false);
            console.log(`EngineService ${engineId} OK`, expect[engineId], blob.size, 'bytes');
        }

        poolManager.shutdownAll();
        fs.rmSync(tmp, { recursive: true, force: true });
        console.log('test-engine-service: ALL OK');
        app.quit();
    } catch (e) {
        console.error('FAIL:', e);
        poolManager.shutdownAll();
        try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* ignore */ }
        app.quit();
        process.exit(1);
    }
});
