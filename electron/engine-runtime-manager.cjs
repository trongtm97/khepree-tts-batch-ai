/**
 * Optional Python runtime isolation for heavy engines.
 * Core (VieNeu/Edge) stays on bundled CORE_PYTHON — never stuff Torch/etc.
 * into requirements-bundle.txt. Isolated runtimes live under userData/runtimes.
 *
 * Engines share a runtime by runtimeId (e.g. chatterbox nano+turbo → "chatterbox").
 * Qwen / Spark / GPT-SoVITS each get their own profile when registered.
 */
const fs = require('fs');
const path = require('path');
const paths = require('./paths.cjs');

const STRATEGY = Object.freeze({
    CORE_PYTHON: 'CORE_PYTHON',
    ISOLATED_PYTHON: 'ISOLATED_PYTHON',
    NATIVE: 'NATIVE',
    ONLINE: 'ONLINE',
});

const STATUS = Object.freeze({
    NOT_INSTALLED: 'NOT_INSTALLED',
    INSTALLING: 'INSTALLING',
    INSTALLED: 'INSTALLED',
    BROKEN: 'BROKEN',
});

const MANIFEST_NAME = '.khepree-runtime-manifest.json';
const CORE_RUNTIME_ID = 'core';

/** @type {Map<string, object>} runtimeId → profile */
const profiles = new Map();

/** @type {Map<string, string>} engineId → runtimeId (for engines not yet in registry) */
const engineBindings = new Map();

/** @type {Map<string, Promise>} runtimeId → in-flight install */
const activeInstalls = new Map();

function sanitizeId(id) {
    return String(id || '')
        .replace(/[^a-zA-Z0-9._-]/g, '_')
        .replace(/_+/g, '_')
        .slice(0, 64);
}

/**
 * @param {{ id: string, strategy: string, label?: string, pythonRelPath?: string }} profile
 */
function registerRuntime(profile) {
    const id = sanitizeId(profile?.id);
    if (!id) throw new Error('registerRuntime requires id');
    const strategy = String(profile.strategy || STRATEGY.ISOLATED_PYTHON);
    if (!Object.values(STRATEGY).includes(strategy)) {
        throw new Error(`Unknown runtime strategy: ${strategy}`);
    }
    const entry = Object.freeze({
        id,
        strategy,
        label: String(profile.label || id),
        // Relative to runtime dir; platform-specific default applied at resolve time
        pythonRelPath: profile.pythonRelPath || null,
    });
    profiles.set(id, entry);
    return entry;
}

function bindEngine(engineId, runtimeId) {
    const eid = String(engineId || '').trim();
    const rid = sanitizeId(runtimeId);
    if (!eid || !rid) throw new Error('bindEngine requires engineId and runtimeId');
    if (!profiles.has(rid) && rid !== CORE_RUNTIME_ID) {
        throw new Error(`Runtime profile not registered: ${rid}`);
    }
    engineBindings.set(eid, rid);
    return rid;
}

function clearRegistrations() {
    profiles.clear();
    engineBindings.clear();
}

function getProfile(runtimeId) {
    const id = sanitizeId(runtimeId);
    if (id === CORE_RUNTIME_ID) {
        return profiles.get(id) || Object.freeze({
            id: CORE_RUNTIME_ID,
            strategy: STRATEGY.CORE_PYTHON,
            label: 'Core Python',
            pythonRelPath: null,
        });
    }
    return profiles.get(id) || null;
}

function listRuntimes() {
    const out = [...profiles.values()];
    if (!profiles.has(CORE_RUNTIME_ID)) {
        out.unshift(getProfile(CORE_RUNTIME_ID));
    }
    return out;
}

/**
 * Resolve which runtime profile an engine uses.
 * Registry wins when the engine is registered; else local bindEngine map.
 */
function resolveRuntimeId(engineId) {
    const raw = String(engineId || '').trim();
    if (!raw) return null;

    try {
        const registry = require('./engine-registry.cjs');
        const entry = registry.getEngine(raw);
        if (entry) {
            if (entry.runtimeStrategy === STRATEGY.ONLINE) {
                return entry.runtimeId && entry.runtimeId !== 'core'
                    ? entry.runtimeId
                    : 'online';
            }
            if (entry.runtimeStrategy === STRATEGY.NATIVE) {
                return entry.runtimeId || 'native';
            }
            if (entry.runtimeStrategy === STRATEGY.CORE_PYTHON || !entry.runtimeStrategy) {
                return CORE_RUNTIME_ID;
            }
            return sanitizeId(entry.runtimeId || entry.id);
        }
    } catch (_) { /* registry optional */ }

    if (engineBindings.has(raw)) return engineBindings.get(raw);
    return null;
}

function resolveProfileForEngine(engineId) {
    const rid = resolveRuntimeId(engineId);
    if (!rid) return null;

    let profile = getProfile(rid);
    if (profile) return profile;

    // Registry-only engines with ISOLATED / ONLINE / NATIVE before profile registered
    try {
        const registry = require('./engine-registry.cjs');
        const entry = registry.getEngine(engineId);
        if (entry?.runtimeStrategy) {
            return Object.freeze({
                id: rid,
                strategy: entry.runtimeStrategy,
                label: entry.displayName || rid,
                pythonRelPath: null,
            });
        }
    } catch (_) { /* */ }

    return null;
}

function defaultPythonRelPath() {
    return process.platform === 'win32'
        ? path.join('python', 'python.exe')
        : path.join('python', 'bin', 'python3');
}

function runtimeRoot(runtimeId) {
    return paths.getRuntimeDir(runtimeId);
}

function manifestPath(runtimeId) {
    return path.join(runtimeRoot(runtimeId), MANIFEST_NAME);
}

function readManifest(runtimeId) {
    const p = manifestPath(runtimeId);
    if (!fs.existsSync(p)) return null;
    try {
        return JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch (_) {
        return { status: STATUS.BROKEN, parseError: true };
    }
}

function writeManifest(runtimeId, data) {
    const root = runtimeRoot(runtimeId);
    fs.mkdirSync(root, { recursive: true });
    const tmp = path.join(root, `${MANIFEST_NAME}.partial`);
    const final = path.join(root, MANIFEST_NAME);
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    try {
        if (fs.existsSync(final)) fs.unlinkSync(final);
    } catch (_) { /* */ }
    fs.renameSync(tmp, final);
}

function pythonPathFromManifest(runtimeId, man, profile) {
    const rel = man?.pythonRelPath || profile?.pythonRelPath || defaultPythonRelPath();
    return path.join(runtimeRoot(runtimeId), rel);
}

function getStatus(engineId) {
    const profile = resolveProfileForEngine(engineId);
    if (!profile) return STATUS.NOT_INSTALLED;

    if (profile.strategy === STRATEGY.CORE_PYTHON) {
        try {
            paths.resolvePythonCmd();
            return STATUS.INSTALLED;
        } catch (_) {
            return STATUS.BROKEN;
        }
    }

    if (profile.strategy === STRATEGY.ONLINE || profile.strategy === STRATEGY.NATIVE) {
        return STATUS.INSTALLED;
    }

    // ISOLATED_PYTHON
    if (activeInstalls.has(profile.id)) return STATUS.INSTALLING;

    const man = readManifest(profile.id);
    if (!man) return STATUS.NOT_INSTALLED;
    if (man.parseError || man.status === STATUS.INSTALLING) return STATUS.BROKEN;
    if (man.status !== STATUS.INSTALLED) return STATUS.NOT_INSTALLED;

    const py = pythonPathFromManifest(profile.id, man, profile);
    if (!fs.existsSync(py)) return STATUS.BROKEN;
    return STATUS.INSTALLED;
}

function isInstalled(engineId) {
    return getStatus(engineId) === STATUS.INSTALLED;
}

function verify(engineId) {
    const profile = resolveProfileForEngine(engineId);
    if (!profile) {
        return { ok: false, status: STATUS.NOT_INSTALLED, reason: 'no runtime profile' };
    }

    const status = getStatus(engineId);
    if (profile.strategy === STRATEGY.CORE_PYTHON) {
        try {
            const resolved = paths.resolvePythonCmd();
            return {
                ok: status === STATUS.INSTALLED,
                status,
                strategy: profile.strategy,
                runtimeId: profile.id,
                python: resolved,
                reason: status === STATUS.INSTALLED ? null : 'core python missing',
            };
        } catch (e) {
            return {
                ok: false,
                status: STATUS.BROKEN,
                strategy: profile.strategy,
                runtimeId: profile.id,
                reason: e.message,
            };
        }
    }

    if (profile.strategy === STRATEGY.ONLINE || profile.strategy === STRATEGY.NATIVE) {
        return {
            ok: true,
            status: STATUS.INSTALLED,
            strategy: profile.strategy,
            runtimeId: profile.id,
            python: null,
            reason: null,
        };
    }

    const man = readManifest(profile.id);
    const py = man ? pythonPathFromManifest(profile.id, man, profile) : null;
    const reasons = [];
    if (!man) reasons.push('missing manifest');
    else if (man.status !== STATUS.INSTALLED) reasons.push(`manifest status=${man.status}`);
    if (!py || !fs.existsSync(py)) reasons.push('python binary missing');

    return {
        ok: status === STATUS.INSTALLED && reasons.length === 0,
        status,
        strategy: profile.strategy,
        runtimeId: profile.id,
        python: py,
        runtimeRoot: runtimeRoot(profile.id),
        reason: reasons.length ? reasons.join('; ') : null,
    };
}

/**
 * Resolve Python for an engine. Does not mutate PATH.
 * CORE → bundled/dev resolvePythonCmd; ISOLATED → userData runtime; ONLINE/NATIVE → null cmd.
 */
function resolvePython(engineId, customPath) {
    const profile = resolveProfileForEngine(engineId);
    if (!profile) {
        throw Object.assign(new Error(`No runtime for engine: ${engineId}`), { code: 'NO_RUNTIME' });
    }

    if (profile.strategy === STRATEGY.ONLINE || profile.strategy === STRATEGY.NATIVE) {
        return {
            cmd: null,
            args: [],
            strategy: profile.strategy,
            runtimeId: profile.id,
        };
    }

    if (profile.strategy === STRATEGY.CORE_PYTHON) {
        const resolved = paths.resolvePythonCmd(customPath);
        return {
            ...resolved,
            strategy: STRATEGY.CORE_PYTHON,
            runtimeId: CORE_RUNTIME_ID,
        };
    }

    // ISOLATED — never fall back to system Python
    const status = getStatus(engineId);
    if (status === STATUS.BROKEN) {
        throw Object.assign(
            new Error(`Isolated runtime broken: ${profile.id}`),
            { code: 'RUNTIME_BROKEN' }
        );
    }
    if (status !== STATUS.INSTALLED) {
        throw Object.assign(
            new Error(`Isolated runtime not installed: ${profile.id}`),
            { code: 'RUNTIME_NOT_INSTALLED' }
        );
    }
    const man = readManifest(profile.id);
    const cmd = pythonPathFromManifest(profile.id, man, profile);
    if (!fs.existsSync(cmd)) {
        throw Object.assign(
            new Error(`Isolated python missing: ${cmd}`),
            { code: 'RUNTIME_BROKEN' }
        );
    }
    return {
        cmd,
        args: [],
        strategy: STRATEGY.ISOLATED_PYTHON,
        runtimeId: profile.id,
        runtimeRoot: runtimeRoot(profile.id),
    };
}

/**
 * Install isolated runtime for engine's runtimeId.
 * Shared: install(chatterbox-nano) and install(chatterbox-turbo) share one tree.
 *
 * ponytail: fake layout only — real embeddable-Python + pip profile install later.
 * No Conda, no admin, no PATH edits, no system Python requirement.
 */
async function install(engineId, opts = {}) {
    const profile = resolveProfileForEngine(engineId);
    if (!profile) {
        throw Object.assign(new Error(`No runtime for engine: ${engineId}`), { code: 'NO_RUNTIME' });
    }

    if (profile.strategy === STRATEGY.CORE_PYTHON
        || profile.strategy === STRATEGY.ONLINE
        || profile.strategy === STRATEGY.NATIVE) {
        return {
            ok: true,
            status: STATUS.INSTALLED,
            strategy: profile.strategy,
            runtimeId: profile.id,
            skipped: true,
        };
    }

    if (activeInstalls.has(profile.id)) {
        return activeInstalls.get(profile.id);
    }

    const run = installIsolated(profile, opts);
    activeInstalls.set(profile.id, run);
    try {
        return await run;
    } finally {
        activeInstalls.delete(profile.id);
    }
}

async function installIsolated(profile, opts = {}) {
    const root = runtimeRoot(profile.id);
    const rel = profile.pythonRelPath || defaultPythonRelPath();
    const py = path.join(root, rel);

    writeManifest(profile.id, {
        runtimeId: profile.id,
        strategy: STRATEGY.ISOLATED_PYTHON,
        status: STATUS.INSTALLING,
        pythonRelPath: rel,
        startedAt: new Date().toISOString(),
    });

    try {
        fs.mkdirSync(path.dirname(py), { recursive: true });

        if (typeof opts.provision === 'function') {
            await opts.provision({ runtimeId: profile.id, root, pythonPath: py, profile });
        } else {
            // Default: stub binary so verify/isInstalled work without downloading Python
            if (!fs.existsSync(py)) {
                fs.writeFileSync(py, '');
                if (process.platform !== 'win32') {
                    try { fs.chmodSync(py, 0o755); } catch (_) { /* */ }
                }
            }
        }

        if (!fs.existsSync(py)) {
            throw new Error('Runtime provision did not create python binary');
        }

        writeManifest(profile.id, {
            runtimeId: profile.id,
            strategy: STRATEGY.ISOLATED_PYTHON,
            status: STATUS.INSTALLED,
            pythonRelPath: rel,
            installedAt: new Date().toISOString(),
            fake: typeof opts.provision !== 'function',
        });

        return {
            ok: true,
            status: STATUS.INSTALLED,
            strategy: STRATEGY.ISOLATED_PYTHON,
            runtimeId: profile.id,
            runtimeRoot: root,
            python: py,
        };
    } catch (e) {
        try {
            writeManifest(profile.id, {
                runtimeId: profile.id,
                strategy: STRATEGY.ISOLATED_PYTHON,
                status: STATUS.BROKEN,
                pythonRelPath: rel,
                error: e.message,
                failedAt: new Date().toISOString(),
            });
        } catch (_) { /* */ }
        throw e;
    }
}

/**
 * Remove shared isolated runtime for this engine's runtimeId.
 * Uninstalling one Chatterbox variant removes the shared tree for all bound engines.
 */
function uninstall(engineId) {
    const profile = resolveProfileForEngine(engineId);
    if (!profile) {
        return { ok: true, status: STATUS.NOT_INSTALLED, skipped: true };
    }

    if (profile.strategy === STRATEGY.CORE_PYTHON) {
        return {
            ok: false,
            error: 'Cannot uninstall core Python runtime',
            code: 'CORE_PROTECTED',
            status: STATUS.INSTALLED,
        };
    }

    if (profile.strategy === STRATEGY.ONLINE || profile.strategy === STRATEGY.NATIVE) {
        return { ok: true, status: STATUS.INSTALLED, skipped: true };
    }

    const root = runtimeRoot(profile.id);
    if (fs.existsSync(root)) {
        fs.rmSync(root, { recursive: true, force: true });
    }
    return {
        ok: true,
        status: STATUS.NOT_INSTALLED,
        runtimeId: profile.id,
    };
}

module.exports = {
    STRATEGY,
    STATUS,
    MANIFEST_NAME,
    CORE_RUNTIME_ID,
    registerRuntime,
    bindEngine,
    clearRegistrations,
    getProfile,
    listRuntimes,
    resolveRuntimeId,
    resolveProfileForEngine,
    getStatus,
    isInstalled,
    install,
    verify,
    resolvePython,
    uninstall,
    runtimeRoot,
};
