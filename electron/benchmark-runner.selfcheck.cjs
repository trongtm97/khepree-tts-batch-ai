/**
 * Local benchmark + AUTO recommender selfcheck (no live synth).
 * Run: electron electron/benchmark-runner.selfcheck.cjs
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { app } = require('electron');
const paths = require('./paths.cjs');
const { loadCorpus, corpusPath } = require('./benchmark-corpus.cjs');
const { hardwareFingerprint } = require('./benchmark-fingerprint.cjs');
const {
    wavDurationSec,
    computeTiming,
    ramSnapshotTrusted,
} = require('./benchmark-metrics.cjs');
const store = require('./benchmark-store.cjs');
const { recommend, TASKS, formatLocalMetrics, DEFAULT_GUIDANCE } = require('./benchmark-recommender.cjs');
const { COMPAT } = require('./model-compatibility.cjs');

app.whenReady().then(() => {
    try {
        assert.ok(fs.existsSync(corpusPath()));
        const corpus = loadCorpus();
        assert.ok(corpus.items.length >= 7);
        assert.ok(corpus.items.some((i) => i.id === 'vi-short'));
        assert.ok(corpus.items.some((i) => i.id === 'vi-numbers'));
        assert.ok(corpus.items.some((i) => i.id === 'en-long'));
        assert.ok(corpus.items.every((i) => i.text && i.lang));

        const hwA = {
            os: { platform: 'win32', arch: 'x64' },
            cpu: { name: 'Test CPU', cores: 8 },
            ram: { totalGb: 32 },
            gpu: { nvidia: true, name: 'RTX', vramMb: 8192, vramTrusted: true },
        };
        const hwB = { ...hwA, ram: { totalGb: 16 } };
        const fpA = hardwareFingerprint(hwA);
        const fpB = hardwareFingerprint(hwB);
        assert.strictEqual(fpA, hardwareFingerprint(hwA));
        assert.notStrictEqual(fpA, fpB);
        assert.strictEqual(fpA.length, 16);

        // Minimal WAV: 1s silence @ 16k mono 16-bit
        const dataSize = 16000 * 2;
        const buf = Buffer.alloc(44 + dataSize);
        buf.write('RIFF', 0);
        buf.writeUInt32LE(36 + dataSize, 4);
        buf.write('WAVE', 8);
        buf.write('fmt ', 12);
        buf.writeUInt32LE(16, 16);
        buf.writeUInt16LE(1, 20);
        buf.writeUInt16LE(1, 22);
        buf.writeUInt32LE(16000, 24);
        buf.writeUInt32LE(32000, 28);
        buf.writeUInt16LE(2, 32);
        buf.writeUInt16LE(16, 34);
        buf.write('data', 36);
        buf.writeUInt32LE(dataSize, 40);
        const dur = wavDurationSec(buf);
        assert.ok(Math.abs(dur - 1) < 0.01);

        const t = computeTiming(250, 1);
        assert.ok(Math.abs(t.rtf - 0.25) < 0.001);
        assert.ok(Math.abs(t.realtimeFactor - 4) < 0.01);
        assert.strictEqual(computeTiming(0, 1).rtf, null);

        const ram = ramSnapshotTrusted();
        assert.strictEqual(ram.trusted, false);
        assert.strictEqual(ram.mb, null);

        paths.setModelStorageDir?.(fs.mkdtempSync(path.join(os.tmpdir(), 'bench-mdl-')));
        // Store uses app.getPath userData — write a fake record via store API
        const record = {
            hardwareFingerprint: fpA,
            engineId: 'vieneu',
            variant: 'default',
            modelVersion: 'bundled',
            runtimeVersion: 'CORE_PYTHON:core',
            ok: true,
            initMs: 2300,
            medianRtf: 0.26,
            medianRealtimeFactor: 3.8,
            successCount: 3,
            errorCount: 0,
            samples: [],
            qualityScore: null,
        };
        const saved = store.writeResult(record);
        assert.ok(saved.ok);
        assert.strictEqual(saved.record.qualityScore, null);
        const listed = store.latestByEngine(fpA);
        assert.ok(listed.some((r) => r.engineId === 'vieneu'));
        const text = formatLocalMetrics({
            initSec: 2.3,
            realtimeFactor: 3.8,
        });
        assert.ok(/Đo trên máy của bạn/.test(text));
        assert.ok(/Khởi động: 2\.3 giây/.test(text));
        assert.ok(/Tốc độ: 3\.8× realtime/.test(text));

        assert.ok(TASKS.length >= 6);
        assert.ok(DEFAULT_GUIDANCE['vi-general']);
        assert.ok(DEFAULT_GUIDANCE['en-clone']);

        const engines = [
            {
                id: 'vieneu',
                bundled: true,
                installState: 'INSTALLED',
                capabilities: { cpu: true, gpu: true },
                optional: false,
            },
            {
                id: 'kokoro',
                bundled: false,
                installState: 'NOT_INSTALLED',
                optional: true,
                capabilities: { cpu: true, gpu: false },
            },
            {
                id: 'chatterbox',
                bundled: false,
                installState: 'INSTALLED',
                optional: true,
                modelVariant: 'turbo',
                capabilities: { cpu: true, gpu: true },
            },
        ];

        const recVi = recommend({
            task: 'vi-general',
            engines,
            hardware: hwA,
            benchResults: listed,
            userPreference: 'vieneu',
        });
        assert.strictEqual(recVi.autoDownload, false);
        assert.strictEqual(recVi.pick?.engineId, 'vieneu');
        assert.ok(recVi.pick.localMetricsText);

        const recEn = recommend({
            task: 'en-light',
            engines,
            hardware: hwA,
            benchResults: [],
        });
        assert.strictEqual(recEn.pick, null);
        assert.ok(recEn.suggestInstall);
        assert.strictEqual(recEn.suggestInstall.engineId, 'kokoro');
        assert.ok(/không tự download/i.test(recEn.suggestInstall.reason));

        const recClone = recommend({
            task: 'en-clone',
            engines,
            hardware: hwA,
            benchResults: [],
        });
        assert.strictEqual(recClone.pick?.engineId, 'chatterbox');
        assert.strictEqual(recClone.pick?.variant, 'turbo');

        // Unavailable GPU-only should not be pick when cpu:false and no nvidia
        const gpuOnly = recommend({
            task: 'advanced',
            engines: [{
                id: 'qwen3',
                optional: true,
                installState: 'INSTALLED',
                capabilities: { cpu: false, gpu: true },
            }],
            hardware: { ...hwA, gpu: { nvidia: false } },
            benchResults: [],
        });
        assert.ok(!gpuOnly.pick || gpuOnly.candidates[0].compatLevel === COMPAT.UNAVAILABLE);

        const selectorSrc = fs.readFileSync(
            path.join(paths.getAppRoot(), 'src', 'batch', 'engine-selector.js'),
            'utf8'
        );
        assert.ok(selectorSrc.includes('Đo trên máy của bạn') || selectorSrc.includes('benchmarkRun'));
        assert.ok(selectorSrc.includes('AUTO không tự download'));
        assert.ok(!/qualityScore\s*[:=]\s*[1-9]/.test(selectorSrc));

        const html = fs.readFileSync(path.join(paths.getAppRoot(), 'batch.html'), 'utf8');
        assert.ok(html.includes('btn-benchmark-run'));
        assert.ok(html.includes('btn-benchmark-auto'));

        console.log('benchmark-runner.selfcheck: ok');
        console.log('  corpus + fingerprint + RTF + AUTO (no download): ok');
        app.exit(0);
    } catch (e) {
        console.error('benchmark-runner.selfcheck FAILED:', e);
        app.exit(1);
    }
});
