/**
 * IPC: hardware profile + engine compatibility advice.
 */
const { detectHardware } = require('./hardware-detector.cjs');
const { adviseEngine, adviseAll, COMPAT } = require('./model-compatibility.cjs');
const registry = require('./engine-registry.cjs');
const install = require('./engine-install.cjs');

let cachedProfile = null;

function getProfile(opts = {}) {
    if (opts.force || !cachedProfile) {
        cachedProfile = detectHardware({
            probeOnnx: Boolean(opts.probeOnnx),
        });
    }
    return cachedProfile;
}

function publicEngine(engineId) {
    const list = registry.listPublic((e) => install.getInstallState(e));
    return list.find((e) => e.id === registry.resolveId(engineId) || e.id === engineId) || null;
}

function createHardwareIpc({ ipcMain }) {
    ipcMain.handle('hardware:getProfile', (_e, opts = {}) => {
        try {
            return { ok: true, profile: getProfile(opts) };
        } catch (e) {
            return { ok: false, error: e.message };
        }
    });

    ipcMain.handle('hardware:advise', (_e, { engineId, variant } = {}) => {
        try {
            const profile = getProfile();
            const engine = publicEngine(engineId);
            const advice = adviseEngine(engine, profile, { variant });
            return { ok: true, engineId, variant: variant || null, ...advice, profileSummary: {
                ramGb: profile.ram?.totalGb,
                nvidia: profile.gpu?.nvidia,
                gpuName: profile.gpu?.name,
            } };
        } catch (e) {
            return { ok: false, error: e.message };
        }
    });

    ipcMain.handle('hardware:adviseAll', () => {
        try {
            const profile = getProfile();
            const engines = registry.listPublic((e) => install.getInstallState(e));
            return { ok: true, profile, advice: adviseAll(engines, profile) };
        } catch (e) {
            return { ok: false, error: e.message };
        }
    });
}

module.exports = {
    createHardwareIpc,
    getProfile,
    COMPAT,
};
