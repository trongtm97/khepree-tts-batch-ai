/**
 * Optional-model install state.
 * Bundled → getBundledModelsDir(); optional → getUserModelsDir() / getEngineModelDir().
 */
const fs = require('fs');
const path = require('path');
const registry = require('./engine-registry.cjs');
const paths = require('./paths.cjs');

const { INSTALL } = registry;

/** In-memory overlay for INSTALLING (see model-download-manager). */
const transient = new Map();

function setTransient(engineId, state) {
    const id = registry.resolveId(engineId);
    if (!id) return;
    if (!state) transient.delete(id);
    else transient.set(id, state);
}

function markerPath(entry) {
    if (!entry?.modelsSubdir || !entry.installMarker) return null;
    const dir = paths.getEngineModelDir(entry.id);
    return path.join(dir, entry.installMarker);
}

function engineModelsDir(engineId) {
    const entry = registry.getEngine(engineId);
    if (!entry?.modelsSubdir) return null;
    return paths.getEngineModelDir(entry.id);
}

/**
 * @param {string|object} engineIdOrEntry
 * @returns {import('./engine-registry.cjs').InstallState}
 */
function getInstallState(engineIdOrEntry) {
    const entry = typeof engineIdOrEntry === 'string'
        ? registry.getEngine(engineIdOrEntry)
        : engineIdOrEntry;
    if (!entry) return INSTALL.NOT_INSTALLED;

    const transientState = transient.get(entry.id);
    if (transientState) return transientState;

    // Optional download packages → Model Download Manager is source of truth
    try {
        const mdl = require('./model-download-manager.cjs');
        const variants = Array.isArray(entry.modelVariants) && entry.modelVariants.length
            ? entry.modelVariants
            : [entry.modelVariant || 'default'];
        const known = variants.filter((v) => mdl.getPackage(entry.id, v));
        if (known.length) {
            let installing = false;
            let installed = false;
            let broken = false;
            for (const v of known) {
                const st = mdl.getStatus(entry.id, v);
                if (st === mdl.STATUS.INSTALLING) installing = true;
                else if (st === mdl.STATUS.INSTALLED) installed = true;
                else if (st === mdl.STATUS.BROKEN) broken = true;
            }
            if (installing) return INSTALL.INSTALLING;
            if (installed) return INSTALL.INSTALLED;
            if (broken) return INSTALL.BROKEN;
            return INSTALL.NOT_INSTALLED;
        }
    } catch (_) { /* manager optional during early boot */ }

    // Online engines with no local model tree are always "installed" if EngineClass exists.
    if (!entry.modelsSubdir) {
        return entry.EngineClass ? INSTALL.INSTALLED : INSTALL.NOT_INSTALLED;
    }

    const marker = markerPath(entry);
    if (!marker) {
        return entry.EngineClass ? INSTALL.INSTALLED : INSTALL.NOT_INSTALLED;
    }

    if (!fs.existsSync(marker)) return INSTALL.NOT_INSTALLED;

    if (marker.endsWith('.json')) {
        try {
            JSON.parse(fs.readFileSync(marker, 'utf8'));
        } catch (_) {
            return INSTALL.BROKEN;
        }
    }
    return INSTALL.INSTALLED;
}

function isInstalled(engineId) {
    return getInstallState(engineId) === INSTALL.INSTALLED;
}

module.exports = {
    INSTALL,
    getInstallState,
    isInstalled,
    setTransient,
    engineModelsDir,
    markerPath,
};
