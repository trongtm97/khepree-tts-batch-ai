/**
 * Self-check: job storage isolation + legacy + generic + corrupt JSON (P08).
 * Run: node scripts/jobs-isolation.selfcheck.cjs
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createJobsStore, sanitizeEngineId } = require('../electron/jobs-store.cjs');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jobs-iso-'));

function readJsonFile(filePath, fallback) {
    try {
        if (!fs.existsSync(filePath)) return fallback;
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (_) {
        return fallback;
    }
}

function writeJsonFile(filePath, value) {
    fs.writeFileSync(filePath, JSON.stringify(value || [], null, 2), 'utf8');
}

const store = createJobsStore(tmp, { readJsonFile, writeJsonFile });

// sanitize
assert.strictEqual(sanitizeEngineId('vieneu'), 'vieneu');
assert.strictEqual(sanitizeEngineId('My Engine!!'), 'My_Engine');
assert.ok(sanitizeEngineId('../../../etc').indexOf('..') < 0);

// --- legacy tts-jobs.json only seeds vieneu ---
writeJsonFile(path.join(tmp, 'tts-jobs.json'), [{ id: 'L1', text: 'legacy-prompt' }]);
const turbo1 = store.loadJobs('vieneu');
const nano1 = store.loadJobs('v3nano');
assert.strictEqual(turbo1.length, 1);
assert.strictEqual(turbo1[0].text, 'legacy-prompt');
assert.strictEqual(nano1.length, 0);
assert.ok(fs.existsSync(path.join(tmp, 'tts-jobs-vieneu.json')));
assert.ok(fs.existsSync(path.join(tmp, 'tts-jobs.json')), 'legacy file kept');

// --- isolation ---
store.saveJobs('vieneu', [...turbo1, { id: 'T2', text: 'turbo-only' }]);
assert.strictEqual(store.loadJobs('vieneu').length, 2);
assert.strictEqual(store.loadJobs('v3nano').length, 0);

// --- direct legacy filenames ---
writeJsonFile(path.join(tmp, 'tts-jobs-v3nano.json'), [{ id: 'N1', text: 'nano-legacy' }]);
writeJsonFile(path.join(tmp, 'tts-jobs-edge.json'), [{ id: 'E1', text: 'edge-legacy' }]);
assert.strictEqual(store.loadJobs('v3nano')[0].text, 'nano-legacy');
assert.strictEqual(store.loadJobs('edge')[0].text, 'edge-legacy');

// --- restart: reload same store ---
const store2 = createJobsStore(tmp, { readJsonFile, writeJsonFile });
assert.strictEqual(store2.loadJobs('vieneu').length, 2);
assert.strictEqual(store2.loadJobs('edge')[0].text, 'edge-legacy');

// --- fake/new generic engine ---
store.saveJobs('piper-test', [{ id: 'P1', text: 'piper' }]);
assert.ok(fs.existsSync(path.join(tmp, 'tts-jobs-piper-test.json')));
assert.strictEqual(store.loadJobs('piper-test')[0].text, 'piper');
assert.strictEqual(store.loadJobs('vieneu').length, 2, 'no cross-leak');

// --- corrupt JSON → empty, no throw ---
fs.writeFileSync(path.join(tmp, 'tts-jobs-edge.json'), '{not-json', 'utf8');
assert.deepStrictEqual(store.loadJobs('edge'), []);

// --- interim rename file still migrates once ---
fs.rmSync(path.join(tmp, 'tts-jobs-v3nano.json'), { force: true });
writeJsonFile(path.join(tmp, 'tts-jobs-vieneu-nano.json'), [{ id: 'N2', text: 'interim' }]);
assert.strictEqual(store.loadJobs('v3nano')[0].text, 'interim');
assert.ok(fs.existsSync(path.join(tmp, 'tts-jobs-vieneu-nano.json')), 'interim kept');

fs.rmSync(tmp, { recursive: true, force: true });
console.log('jobs-isolation.selfcheck: ok');
