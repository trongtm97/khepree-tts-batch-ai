/**
 * Self-check: Turbo/Nano jobs storage must stay isolated.
 * Run: node scripts/jobs-isolation.selfcheck.cjs
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jobs-iso-'));
const JOBS_VIENEU = path.join(tmp, 'tts-jobs-vieneu.json');
const JOBS_NANO = path.join(tmp, 'tts-jobs-v3nano.json');
const JOBS_LEGACY = path.join(tmp, 'tts-jobs.json');

function jobsFileForEngine(engine) {
    if (engine === 'edge') return path.join(tmp, 'tts-jobs-edge.json');
    if (engine === 'v3nano') return JOBS_NANO;
    return JOBS_VIENEU;
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
    fs.writeFileSync(filePath, JSON.stringify(value || [], null, 2), 'utf8');
}

/** Current (buggy) load: legacy seeds BOTH non-edge engines */
function loadJobsBuggy(engine) {
    const legacy = readJsonFile(JOBS_LEGACY, null);
    const file = jobsFileForEngine(engine);
    if (legacy && !fs.existsSync(file) && engine !== 'edge') {
        writeJsonFile(file, legacy);
        return legacy;
    }
    return readJsonFile(file, []);
}

/** Fixed load: legacy only seeds turbo (vieneu) */
function loadJobsFixed(engine) {
    const file = jobsFileForEngine(engine);
    if (!fs.existsSync(file)) {
        if (engine === 'vieneu') {
            const legacy = readJsonFile(JOBS_LEGACY, null);
            if (legacy) {
                writeJsonFile(file, legacy);
                return JSON.parse(JSON.stringify(legacy));
            }
        }
        return [];
    }
    return readJsonFile(file, []);
}

function saveJobs(engine, jobs) {
    writeJsonFile(jobsFileForEngine(engine), jobs);
}

// --- Test 1: legacy must not seed nano ---
writeJsonFile(JOBS_LEGACY, [{ id: 'L1', text: 'legacy-prompt' }]);
const turbo1 = loadJobsFixed('vieneu');
const nano1 = loadJobsFixed('v3nano');
console.assert(turbo1.length === 1 && turbo1[0].text === 'legacy-prompt', 'turbo gets legacy');
console.assert(nano1.length === 0, 'nano must NOT get legacy');

// --- Test 2: add on turbo must not appear on nano ---
const turboJobs = [...turbo1, { id: 'T2', text: 'turbo-only' }];
saveJobs('vieneu', turboJobs);
const nanoAfter = loadJobsFixed('v3nano');
const turboAfter = loadJobsFixed('vieneu');
console.assert(turboAfter.length === 2, 'turbo has 2');
console.assert(nanoAfter.length === 0, 'nano still empty after turbo save');

// --- Test 3: demonstrate buggy behavior would fail ---
fs.rmSync(JOBS_VIENEU, { force: true });
fs.rmSync(JOBS_NANO, { force: true });
const buggyTurbo = loadJobsBuggy('vieneu');
const buggyNano = loadJobsBuggy('v3nano');
console.assert(buggyTurbo.length === 1 && buggyNano.length === 1, 'buggy path seeds both');
console.assert(buggyTurbo[0].text === buggyNano[0].text, 'buggy path duplicates text');

fs.rmSync(tmp, { recursive: true, force: true });
console.log('jobs-isolation.selfcheck: ok');
