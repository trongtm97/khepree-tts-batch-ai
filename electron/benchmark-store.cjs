/**
 * Persist local benchmark results keyed by hardware fingerprint + engine/variant/versions.
 */
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

function benchmarksRoot() {
    return path.join(app.getPath('userData'), 'benchmarks');
}

function sanitizePart(s) {
    return String(s || 'unknown')
        .replace(/[^a-zA-Z0-9._-]+/g, '_')
        .replace(/^_|_$/g, '')
        .slice(0, 80) || 'unknown';
}

function resultFileName({ engineId, variant, modelVersion, runtimeVersion }) {
    return [
        sanitizePart(engineId),
        sanitizePart(variant || 'default'),
        sanitizePart(modelVersion || 'unknown'),
        sanitizePart(runtimeVersion || 'unknown'),
    ].join('__') + '.json';
}

function fingerprintDir(fingerprint) {
    return path.join(benchmarksRoot(), sanitizePart(fingerprint));
}

function writeResult(record) {
    const dir = fingerprintDir(record.hardwareFingerprint);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, resultFileName(record));
    const out = {
        ...record,
        savedAt: new Date().toISOString(),
        // Explicit: never invent quality
        qualityScore: null,
    };
    fs.writeFileSync(file, JSON.stringify(out, null, 2), 'utf8');
    return { ok: true, path: file, record: out };
}

function listResults(fingerprint) {
    const dir = fingerprintDir(fingerprint);
    if (!fs.existsSync(dir)) return [];
    const out = [];
    for (const name of fs.readdirSync(dir)) {
        if (!name.endsWith('.json')) continue;
        try {
            out.push(JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')));
        } catch (_) { /* skip corrupt */ }
    }
    return out;
}

function getResult(fingerprint, engineId, variant) {
    const all = listResults(fingerprint);
    const id = String(engineId || '');
    const v = String(variant || 'default');
    return all.find((r) => r.engineId === id && String(r.variant || 'default') === v) || null;
}

function latestByEngine(fingerprint) {
    const map = new Map();
    for (const r of listResults(fingerprint)) {
        const key = `${r.engineId}::${r.variant || 'default'}`;
        const prev = map.get(key);
        if (!prev || String(r.savedAt || '') > String(prev.savedAt || '')) {
            map.set(key, r);
        }
    }
    return [...map.values()];
}

module.exports = {
    benchmarksRoot,
    resultFileName,
    writeResult,
    listResults,
    getResult,
    latestByEngine,
};
