/**
 * Electron smoke: generic engine IPC + legacy wrappers.
 * Run: electron scripts/test-engine-ipc.cjs
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { app } = require('electron');

const paths = require('../electron/paths.cjs');
const { EnginePoolManager } = require('../electron/engine-pool-manager.cjs');
const { createEngineIpc } = require('../electron/engine-ipc.cjs');

function createMockIpc() {
    const handlers = new Map();
    return {
        handlers,
        handle(channel, fn) {
            if (handlers.has(channel)) {
                throw new Error(`Duplicate ipc handler: ${channel}`);
            }
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
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'khepree-ipc-'));
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

    try {
        // --- list ---
        const list = await ipc.invoke('engine:list');
        assert.ok(Array.isArray(list), 'engine:list returns array');
        assert.strictEqual(list.length, 3);
        assert.deepStrictEqual(list.map((e) => e.id).sort(), ['edge', 'v3nano', 'vieneu']);
        console.log('engine:list OK', list.map((e) => e.id).join(', '));

        // --- invalid status must not throw ---
        const bad = await ipc.invoke('engine:status', 'nope');
        assert.ok(bad.error);
        assert.strictEqual(bad.ok, false);
        console.log('engine:status invalid OK');

        // --- generic synth: vieneu / v3nano / edge ---
        const envProbe = paths.buildWorkerEnv();
        console.log('FFMPEG_PATH', envProbe.FFMPEG_PATH || '(missing)');
        console.log('FFPROBE_PATH', envProbe.FFPROBE_PATH || '(missing)');

        for (const engineId of ['vieneu', 'v3nano', 'edge']) {
            const init = await ipc.invoke('engine:init', {
                engineId,
                options: engineId === 'edge'
                    ? { voiceMode: 'vietnamese' }
                    : { mode: engineId === 'v3nano' ? 'v3nano' : 'v3turbo' },
            });
            assert.ok(!init.error, `${engineId} init: ${init.error}`);
            const voice = init.voices?.[0]?.id || init.voices?.[0]?.name || null;
            const synth = await ipc.invoke('engine:synthesize', {
                engineId,
                text: 'Xin chào Khepree.',
                voice,
                options: {},
            });
            // Structured error must never throw / crash main
            assert.ok(synth && typeof synth === 'object');
            if (synth.error) {
                assert.strictEqual(synth.ok, false);
                // Edge may fail in bare-dev without ffmpeg on PATH — IPC still structured
                if (engineId === 'edge') {
                    console.warn(`engine:synthesize edge structured error (env): ${synth.error}`);
                } else {
                    assert.fail(`${engineId} synth: ${synth.error}`);
                }
            } else {
                assert.ok(synth.buffer && synth.buffer.length > 100, `${engineId} buffer`);
                const expectFmt = engineId === 'edge' ? 'mp3' : 'wav';
                assert.strictEqual(synth.format, expectFmt);
                console.log(`engine:synthesize ${engineId} OK`, synth.format, synth.buffer.length, 'bytes');
            }
            await ipc.invoke('engine:unload', engineId);
        }

        // --- legacy IPC still works (init + optional synth) ---
        const ttsInit = await ipc.invoke('tts:init', { mode: 'v3turbo' });
        assert.ok(!ttsInit.error, ttsInit.error);
        const ttsSynth = await ipc.invoke('tts:synthesize', {
            text: 'Legacy turbo.',
            voice: ttsInit.voices?.[0]?.id || null,
            mode: 'v3turbo',
            options: { speed: 1 },
        });
        assert.ok(!ttsSynth.error, ttsSynth.error);
        assert.strictEqual(ttsSynth.format, 'wav');
        console.log('tts:* legacy OK');

        const edgeInit = await ipc.invoke('edge:init', { voiceMode: 'vietnamese' });
        assert.ok(!edgeInit.error, edgeInit.error);
        const edgeSynth = await ipc.invoke('edge:synthesize', {
            text: 'Legacy edge.',
            voice: edgeInit.voices?.[0]?.id || null,
            options: {},
        });
        assert.ok(edgeSynth && typeof edgeSynth === 'object');
        if (edgeSynth.error) {
            assert.ok(edgeSynth.error);
            console.warn(`edge:* legacy synth structured error (env): ${edgeSynth.error}`);
        } else {
            assert.strictEqual(edgeSynth.format, 'mp3');
            console.log('edge:* legacy OK');
        }
        console.log('edge:* legacy init OK');

        // preload surface names (documented contract)
        const preloadSrc = fs.readFileSync(path.join(__dirname, '..', 'electron', 'preload.cjs'), 'utf8');
        for (const name of ['listEngines', 'engineInit', 'engineSynthesize', 'engineReload', 'engineUnload', 'engineStatus']) {
            assert.ok(preloadSrc.includes(`${name}:`), `preload missing ${name}`);
        }
        assert.ok(!preloadSrc.includes('exposeInMainWorld(\'ipcRenderer\''));
        assert.ok(!preloadSrc.includes('ipcRenderer:'));

        poolManager.shutdownAll();
        fs.rmSync(tmp, { recursive: true, force: true });
        console.log('test-engine-ipc: ALL OK');
        app.quit();
    } catch (e) {
        console.error('FAIL:', e);
        poolManager.shutdownAll();
        try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* ignore */ }
        app.quit();
        process.exit(1);
    }
});
