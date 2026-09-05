/**
 * Per-engine job files with legacy compatibility.
 *
 * Canonical: tts-jobs-<sanitizeEngineId(engineId)>.json
 * Shipping engines already use safe ids matching historical files:
 *   vieneu  → tts-jobs-vieneu.json
 *   v3nano  → tts-jobs-v3nano.json
 *   edge    → tts-jobs-edge.json
 *
 * Extra legacy candidates (interim rename / ultra-old) are read when
 * canonical is missing. Legacy files are never deleted.
 * Load does not invent duplicate in-memory job lists.
 */
const fs = require('fs');
const path = require('path');
const registry = require('./engine-registry.cjs');

function sanitizeEngineId(engineId) {
    return String(engineId || 'engine')
        .replace(/[^a-zA-Z0-9_-]/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_|_$/g, '')
        .slice(0, 64) || 'engine';
}

/**
 * Additional files to try when the canonical path is absent.
 * Do not list the canonical filename here (avoids no-op / confusion).
 */
const LEGACY_JOB_FILES = Object.freeze({
    vieneu: ['tts-jobs-vieneu-turbo.json', 'tts-jobs.json'],
    v3nano: ['tts-jobs-vieneu-nano.json'],
    edge: [],
});

function createJobsStore(dataDir, { readJsonFile, writeJsonFile }) {
    function resolveEngineKey(engineId) {
        const entry = registry.getEngine(engineId);
        return entry?.id || sanitizeEngineId(engineId);
    }

    function canonicalFile(engineId) {
        return path.join(dataDir, `tts-jobs-${sanitizeEngineId(resolveEngineKey(engineId))}.json`);
    }

    function legacyCandidates(engineId) {
        const id = resolveEngineKey(engineId);
        const names = LEGACY_JOB_FILES[id] || [];
        const canon = path.basename(canonicalFile(engineId));
        return names
            .filter((name) => name !== canon)
            .map((name) => path.join(dataDir, name));
    }

    function jobsFileForEngine(engineId) {
        return canonicalFile(engineId);
    }

    function safeReadJobs(filePath) {
        if (!fs.existsSync(filePath)) return null;
        const data = readJsonFile(filePath, null);
        if (data === null || data === undefined) return [];
        if (!Array.isArray(data)) return [];
        return data;
    }

    /**
     * Load jobs for engineId.
     * Prefer canonical file. If missing, read first existing legacy candidate
     * and copy once into canonical (legacy file kept on disk).
     */
    function loadJobs(engineId) {
        const file = canonicalFile(engineId);
        const fromCanon = safeReadJobs(file);
        if (fromCanon !== null && fs.existsSync(file)) {
            return fromCanon;
        }

        for (const legacy of legacyCandidates(engineId)) {
            if (!fs.existsSync(legacy)) continue;
            const data = safeReadJobs(legacy);
            if (data === null) continue;
            // One-time materialize into canonical; do not delete legacy.
            try {
                writeJsonFile(file, data);
            } catch (_) {
                return data;
            }
            return safeReadJobs(file) || data;
        }

        return [];
    }

    function saveJobs(engineId, jobs) {
        const list = Array.isArray(jobs) ? jobs : [];
        writeJsonFile(canonicalFile(engineId), list);
        return true;
    }

    return {
        sanitizeEngineId,
        resolveEngineKey,
        jobsFileForEngine,
        loadJobs,
        saveJobs,
        legacyCandidates,
        LEGACY_JOB_FILES,
    };
}

module.exports = { createJobsStore, sanitizeEngineId, LEGACY_JOB_FILES };
