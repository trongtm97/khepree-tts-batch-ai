/**
 * IPC for Model Download Manager.
 * Progress: main → renderer via `model:download-progress`.
 * Does not auto-download on synthesize / Generate.
 */
const mdl = require('./model-download-manager.cjs');

function fail(error, code = 'MODEL_DOWNLOAD_ERROR') {
    const message = error instanceof Error ? error.message : String(error || 'Unknown error');
    return { ok: false, error: message, code: error?.code || code };
}

function createModelDownloadIpc({ ipcMain, BrowserWindow, getMainWindow }) {
    mdl.setProgressSink((payload) => {
        const win = typeof getMainWindow === 'function' ? getMainWindow() : null;
        const target = win && !win.isDestroyed()
            ? win
            : BrowserWindow?.getFocusedWindow?.() || BrowserWindow?.getAllWindows?.()?.[0];
        if (target && !target.isDestroyed()) {
            target.webContents.send('model:download-progress', payload);
        }
    });

    ipcMain.handle('model:getStatus', (_e, { engineId, variant } = {}) => {
        try {
            return {
                ok: true,
                engineId,
                variant: variant || 'default',
                status: mdl.getStatus(engineId, variant),
            };
        } catch (e) {
            return fail(e);
        }
    });

    ipcMain.handle('model:install', async (_e, { engineId, variant } = {}) => {
        try {
            const result = await mdl.install(engineId, variant);
            return { ok: true, ...result };
        } catch (e) {
            return fail(e, e.code || 'MODEL_INSTALL_FAILED');
        }
    });

    ipcMain.handle('model:cancel', (_e, { engineId, variant } = {}) => {
        try {
            return { ok: true, ...mdl.cancel(engineId, variant) };
        } catch (e) {
            return fail(e);
        }
    });

    ipcMain.handle('model:verify', (_e, { engineId, variant } = {}) => {
        try {
            return { ok: true, ...mdl.verify(engineId, variant) };
        } catch (e) {
            return fail(e);
        }
    });

    ipcMain.handle('model:uninstall', (_e, { engineId, variant } = {}) => {
        try {
            return { ok: true, ...mdl.uninstall(engineId, variant) };
        } catch (e) {
            return fail(e);
        }
    });

    const piperPkg = require('./piper-package.cjs');

    ipcMain.handle('piper:listCatalog', () => {
        try {
            return {
                ok: true,
                warning: piperPkg.LICENSE_INSTALL_WARNING,
                defaultVoice: piperPkg.DEFAULT_VOICE,
                runtimeInstalled: piperPkg.isRuntimeInstalled(),
                voices: piperPkg.listCatalogVoices(),
                installed: piperPkg.listInstalledVoices(),
            };
        } catch (e) {
            return fail(e);
        }
    });

    ipcMain.handle('piper:voiceLicense', (_e, { variant } = {}) => {
        try {
            return {
                ok: true,
                variant,
                license: piperPkg.readVoiceLicense(variant),
            };
        } catch (e) {
            return fail(e);
        }
    });

    ipcMain.handle('piper:installRuntime', async () => {
        try {
            const result = await piperPkg.installRuntime();
            return { ok: true, ...result };
        } catch (e) {
            return fail(e, e.code || 'PIPER_RUNTIME_INSTALL_FAILED');
        }
    });

    ipcMain.handle('piper:uninstallRuntime', () => {
        try {
            return { ok: true, ...piperPkg.uninstallRuntime() };
        } catch (e) {
            return fail(e);
        }
    });

    ipcMain.handle('piper:installOptional', async (_e, { variant } = {}) => {
        try {
            const result = await piperPkg.installOptional(variant || piperPkg.DEFAULT_VOICE);
            return { ok: true, ...result };
        } catch (e) {
            return fail(e, e.code || 'PIPER_INSTALL_FAILED');
        }
    });

    ipcMain.handle('piper:uninstallAll', () => {
        try {
            return { ok: true, ...piperPkg.uninstallAll() };
        } catch (e) {
            return fail(e);
        }
    });

    const cbPkg = require('./chatterbox-package.cjs');

    ipcMain.handle('chatterbox:listTags', () => {
        try {
            return { ok: true, ...cbPkg.listExpressionTags() };
        } catch (e) {
            return fail(e);
        }
    });

    ipcMain.handle('chatterbox:installOptional', async (_e, opts = {}) => {
        try {
            const variant = opts?.variant || 'nano';
            const result = await cbPkg.installOptional(variant);
            return { ok: true, ...result };
        } catch (e) {
            return fail(e, e.code || 'CHATTERBOX_INSTALL_FAILED');
        }
    });

    ipcMain.handle('chatterbox:uninstallAll', () => {
        try {
            return { ok: true, ...cbPkg.uninstallAll() };
        } catch (e) {
            return fail(e);
        }
    });

    ipcMain.handle('chatterbox:runtimeStatus', () => {
        try {
            return {
                ok: true,
                runtimeInstalled: cbPkg.isRuntimeInstalled(),
                modelInstalled: cbPkg.isModelInstalled('nano') || cbPkg.isModelInstalled('turbo'),
                nanoInstalled: cbPkg.isModelInstalled('nano'),
                turboInstalled: cbPkg.isModelInstalled('turbo'),
                variants: cbPkg.listVariants(),
            };
        } catch (e) {
            return fail(e);
        }
    });

    const qwenPkg = require('./qwen3-package.cjs');

    ipcMain.handle('qwen3:listLanguages', () => {
        try {
            return { ok: true, languages: qwenPkg.listLanguages() };
        } catch (e) {
            return fail(e);
        }
    });

    ipcMain.handle('qwen3:listSpeakers', () => {
        try {
            return { ok: true, speakers: qwenPkg.listSpeakers() };
        } catch (e) {
            return fail(e);
        }
    });

    ipcMain.handle('qwen3:installOptional', async (_e, opts = {}) => {
        try {
            const variant = opts?.variant || '0.6b-custom';
            const result = await qwenPkg.installOptional(variant);
            return { ok: true, ...result };
        } catch (e) {
            return fail(e, e.code || 'QWEN3_INSTALL_FAILED');
        }
    });

    ipcMain.handle('qwen3:uninstallAll', () => {
        try {
            return { ok: true, ...qwenPkg.uninstallAll() };
        } catch (e) {
            return fail(e);
        }
    });

    ipcMain.handle('qwen3:runtimeStatus', () => {
        try {
            return {
                ok: true,
                runtimeInstalled: qwenPkg.isRuntimeInstalled(),
                modelInstalled: qwenPkg.isModelInstalled('0.6b-custom')
                    || qwenPkg.isModelInstalled('0.6b-base'),
                customInstalled: qwenPkg.isModelInstalled('0.6b-custom'),
                baseInstalled: qwenPkg.isModelInstalled('0.6b-base'),
                variants: qwenPkg.listVariants(),
                languages: qwenPkg.listLanguages(),
                speakers: qwenPkg.listSpeakers(),
                viWarn: qwenPkg.VI_WARN,
            };
        } catch (e) {
            return fail(e);
        }
    });

    const sparkPkg = require('./spark-package.cjs');

    ipcMain.handle('spark:listLanguages', () => {
        try {
            return { ok: true, languages: sparkPkg.listLanguages() };
        } catch (e) {
            return fail(e);
        }
    });

    ipcMain.handle('spark:installOptional', async () => {
        try {
            const result = await sparkPkg.installOptional();
            return { ok: true, ...result };
        } catch (e) {
            return fail(e, e.code || 'SPARK_INSTALL_FAILED');
        }
    });

    ipcMain.handle('spark:uninstallAll', () => {
        try {
            return { ok: true, ...sparkPkg.uninstallAll() };
        } catch (e) {
            return fail(e);
        }
    });

    ipcMain.handle('spark:runtimeStatus', () => {
        try {
            return {
                ok: true,
                runtimeInstalled: sparkPkg.isRuntimeInstalled(),
                modelInstalled: sparkPkg.isModelInstalled(),
                languages: sparkPkg.listLanguages(),
                genders: sparkPkg.listGenders(),
                levels: sparkPkg.listLevels(),
                viWarn: sparkPkg.VI_WARN,
            };
        } catch (e) {
            return fail(e);
        }
    });

    const gsvPkg = require('./gpt-sovits-package.cjs');

    ipcMain.handle('gptSovits:listLanguages', () => {
        try {
            return { ok: true, languages: gsvPkg.listLanguages() };
        } catch (e) {
            return fail(e);
        }
    });

    ipcMain.handle('gptSovits:installOptional', async () => {
        try {
            const result = await gsvPkg.installOptional();
            return { ok: true, ...result };
        } catch (e) {
            return fail(e, e.code || 'GPT_SOVITS_INSTALL_FAILED');
        }
    });

    ipcMain.handle('gptSovits:uninstallAll', () => {
        try {
            return { ok: true, ...gsvPkg.uninstallAll() };
        } catch (e) {
            return fail(e);
        }
    });

    ipcMain.handle('gptSovits:runtimeStatus', () => {
        try {
            return {
                ok: true,
                runtimeInstalled: gsvPkg.isRuntimeInstalled(),
                modelInstalled: gsvPkg.isModelInstalled(),
                languages: gsvPkg.listLanguages(),
                profiles: gsvPkg.listVoiceProfiles(),
                voiceProfileAck: gsvPkg.VOICE_PROFILE_ACK,
                viWarn: gsvPkg.VI_WARN,
                training: false,
            };
        } catch (e) {
            return fail(e);
        }
    });

    ipcMain.handle('gptSovits:listProfiles', () => {
        try {
            return { ok: true, profiles: gsvPkg.listVoiceProfiles(), ack: gsvPkg.VOICE_PROFILE_ACK };
        } catch (e) {
            return fail(e);
        }
    });

    ipcMain.handle('gptSovits:createProfile', (_e, payload) => {
        try {
            return gsvPkg.createVoiceProfile(payload || {});
        } catch (e) {
            return fail(e);
        }
    });

    ipcMain.handle('gptSovits:deleteProfile', (_e, payload) => {
        try {
            return gsvPkg.deleteVoiceProfile(payload?.id || payload);
        } catch (e) {
            return fail(e);
        }
    });
}

module.exports = { createModelDownloadIpc };
