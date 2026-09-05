/**
 * Local TTS benchmark runner — times init + synth via existing engine IPC.
 * Does not modify inference engines. No quality scores.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { loadCorpus } = require('./benchmark-corpus.cjs');
const { hardwareFingerprint } = require('./benchmark-fingerprint.cjs');
const store = require('./benchmark-store.cjs');
const {
    wavDurationSec,
    probeDurationSec,
    computeTiming,
    vramSnapshotMb,
    ramSnapshotTrusted,
} = require('./benchmark-metrics.cjs');
const registry = require('./engine-registry.cjs');
const install = require('./engine-install.cjs');
const mdl = require('./model-download-manager.cjs');
const { getProfile } = require('./hardware-ipc.cjs');

function bufferFromResult(raw) {
    if (!raw) return null;
    if (Buffer.isBuffer(raw)) return raw;
    if (raw?.type === 'Buffer' && Array.isArray(raw.data)) return Buffer.from(raw.data);
    if (raw?.data) return Buffer.from(raw.data);
    try {
        return Buffer.from(raw);
    } catch (_) {
        return null;
    }
}

function resolveModelVersion(engineId, variant) {
    try {
        const man = mdl.readManifest(engineId, variant);
        if (man?.version) return String(man.version);
    } catch (_) { /* */ }
    const entry = registry.getEngine(engineId);
    if (entry?.bundled) return 'bundled';
    return entry?.modelVariant || variant || 'unknown';
}

function resolveRuntimeVersion(engineId) {
    const entry = registry.getEngine(engineId);
    const strategy = entry?.runtimeStrategy || 'CORE_PYTHON';
    const rid = entry?.runtimeId || 'core';
    return `${strategy}:${rid}`;
}

function defaultVariant(entry, settings = {}) {
    if (!entry) return 'default';
    const es = settings.engineSettings?.[entry.id] || {};
    if (es.variant) return es.variant;
    if (entry.id === 'chatterbox') return settings.chatterboxVariant || entry.modelVariant || 'nano';
    if (entry.id === 'kitten') return settings.kittenVariant || 'mini';
    if (entry.id === 'kokoro') return settings.kokoroVariant || 'int8';
    if (entry.id === 'piper') return settings.piperVariant || entry.modelVariant;
    if (entry.id === 'qwen3') return settings.qwen3Variant || '0.6b-custom';
    if (entry.id === 'spark') return '0.5b';
    return entry.modelVariant || (entry.modelVariants && entry.modelVariants[0]) || 'default';
}

function isRunnable(entry) {
    if (!entry?.EngineClass) return false;
    if (entry.category === 'voice-lab') return false; // Voice Lab needs custom ckpts — skip default bench
    const st = install.getInstallState(entry);
    return entry.bundled || st === install.INSTALL.INSTALLED;
}

async function measureEngine({
    entry,
    variant,
    corpusItems,
    engineInit,
    engineSynthesize,
    settings,
    hardware,
    onProgress,
}) {
    const engineId = entry.id;
    const modelVersion = resolveModelVersion(engineId, variant);
    const runtimeVersion = resolveRuntimeVersion(engineId);
    const fingerprint = hardwareFingerprint(hardware);
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `khepree-bench-${engineId}-`));

    const ram = ramSnapshotTrusted();
    const vramBefore = vramSnapshotMb(hardware);

    let initMs = null;
    let initError = null;
    const t0 = Date.now();
    try {
        onProgress?.({ phase: 'init', engineId, variant });
        const initRes = await engineInit(engineId, {
            variant,
            pythonPath: settings.pythonPath,
            device: settings.device,
            engineOptions: { variant },
        });
        initMs = Date.now() - t0;
        if (initRes?.ok === false) {
            initError = initRes.error || 'init failed';
        }
    } catch (e) {
        initMs = Date.now() - t0;
        initError = e.message || String(e);
    }

    const samples = [];
    let successCount = 0;
    let errorCount = 0;

    for (const item of corpusItems) {
        onProgress?.({ phase: 'synth', engineId, variant, itemId: item.id });
        const outPath = path.join(tmpDir, `${item.id}.bin`);
        const tSynth = Date.now();
        let synthMs = null;
        let audioSec = null;
        let error = null;
        let ok = false;
        try {
            if (initError) throw new Error(initError);
            const res = await engineSynthesize(engineId, {
                text: item.text,
                voice: settings.voice || undefined,
                options: {
                    variant,
                    language: item.lang === 'vi' ? (engineId === 'spark' ? 'Chinese' : undefined) : undefined,
                    lang: item.lang,
                },
            });
            synthMs = Date.now() - tSynth;
            if (res?.ok === false) {
                error = res.error || 'synth failed';
                errorCount += 1;
            } else {
                const buf = bufferFromResult(res.buffer);
                const fmt = String(res.format || entry.outputFormat || 'wav').toLowerCase();
                if (buf) {
                    fs.writeFileSync(outPath, buf);
                    if (fmt === 'wav') {
                        audioSec = wavDurationSec(buf);
                    }
                    if (audioSec == null) {
                        audioSec = probeDurationSec(outPath);
                    }
                }
                ok = true;
                successCount += 1;
            }
        } catch (e) {
            synthMs = Date.now() - tSynth;
            error = e.message || String(e);
            errorCount += 1;
        }

        const timing = computeTiming(synthMs, audioSec);
        samples.push({
            itemId: item.id,
            lang: item.lang,
            kind: item.kind,
            ok,
            error: error || null,
            synthMs,
            audioDurationSec: audioSec,
            rtf: timing.rtf,
            realtimeFactor: timing.realtimeFactor,
        });
    }

    const vramAfter = vramSnapshotMb(hardware);
    let vramDeltaMb = null;
    let vramTrusted = false;
    if (vramBefore.trusted && vramAfter.trusted && vramBefore.mb != null && vramAfter.mb != null) {
        vramDeltaMb = Math.max(0, vramAfter.mb - vramBefore.mb);
        vramTrusted = true;
    }

    const okRtfs = samples.map((s) => s.rtf).filter((n) => Number.isFinite(n));
    const okFactors = samples.map((s) => s.realtimeFactor).filter((n) => Number.isFinite(n));
    okRtfs.sort((a, b) => a - b);
    okFactors.sort((a, b) => a - b);
    const mid = (arr) => (arr.length ? arr[Math.floor(arr.length / 2)] : null);

    try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_) { /* */ }

    const record = {
        hardwareFingerprint: fingerprint,
        engineId,
        variant,
        modelVersion,
        runtimeVersion,
        ok: !initError && successCount > 0,
        initMs,
        initError,
        successCount,
        errorCount,
        medianRtf: mid(okRtfs),
        medianRealtimeFactor: mid(okFactors),
        ramMb: ram.mb,
        ramTrusted: ram.trusted,
        vramDeltaMb,
        vramTrusted,
        samples,
        measuredAt: new Date().toISOString(),
        qualityScore: null,
    };

    store.writeResult(record);
    return record;
}

/**
 * @param {object} deps
 * @param {Function} deps.engineInit
 * @param {Function} deps.engineSynthesize
 * @param {Function} deps.getSettings
 */
async function runBenchmark(deps, opts = {}) {
    const settings = deps.getSettings?.() || {};
    const hardware = getProfile({ force: Boolean(opts.forceHardware) });
    const fingerprint = hardwareFingerprint(hardware);
    const corpus = loadCorpus();
    const items = corpus.items.filter((it) => {
        if (opts.lang && it.lang !== opts.lang) return false;
        if (opts.kinds && !opts.kinds.includes(it.kind)) return false;
        return true;
    });

    const catalog = registry.listPublic((e) => install.getInstallState(e));
    let targets = catalog.filter((e) => isRunnable(registry.getEngine(e.id)));
    if (opts.engineId) {
        const id = registry.resolveId(opts.engineId) || opts.engineId;
        targets = targets.filter((e) => e.id === id);
    }
    // Skip online Edge by default (network variance) unless explicitly requested
    if (!opts.includeOnline) {
        targets = targets.filter((e) => !e.online);
    }

    const results = [];
    for (const pub of targets) {
        const entry = registry.getEngine(pub.id);
        const variant = opts.variant || defaultVariant(entry, settings);
        deps.onProgress?.({ phase: 'engine', engineId: pub.id, variant });
        const record = await measureEngine({
            entry,
            variant,
            corpusItems: items,
            engineInit: deps.engineInit,
            engineSynthesize: deps.engineSynthesize,
            settings,
            hardware,
            onProgress: deps.onProgress,
        });
        results.push(record);
        if (opts.unloadAfter !== false && deps.engineUnload) {
            try {
                await deps.engineUnload(pub.id);
            } catch (_) { /* */ }
        }
    }

    return {
        ok: true,
        hardwareFingerprint: fingerprint,
        corpusVersion: corpus.version,
        results,
        autoDownload: false,
    };
}

module.exports = {
    runBenchmark,
    measureEngine,
    resolveModelVersion,
    resolveRuntimeVersion,
    defaultVariant,
    isRunnable,
    hardwareFingerprint,
};
