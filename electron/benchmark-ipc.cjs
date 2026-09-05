/**
 * IPC: local benchmark + AUTO recommender.
 * Never auto-downloads models.
 */
const { getProfile } = require('./hardware-ipc.cjs');
const { hardwareFingerprint } = require('./benchmark-fingerprint.cjs');
const store = require('./benchmark-store.cjs');
const { loadCorpus } = require('./benchmark-corpus.cjs');
const { runBenchmark } = require('./benchmark-runner.cjs');
const { recommend, TASKS, formatLocalMetrics, benchSummary } = require('./benchmark-recommender.cjs');
const registry = require('./engine-registry.cjs');
const install = require('./engine-install.cjs');

function createBenchmarkIpc({
    ipcMain,
    BrowserWindow,
    getMainWindow,
    engineInit,
    engineSynthesize,
    engineUnload,
    getSettings,
}) {
    function broadcast(channel, payload) {
        const win = getMainWindow?.();
        if (win && !win.isDestroyed()) {
            win.webContents.send(channel, payload);
        }
        for (const w of BrowserWindow?.getAllWindows?.() || []) {
            if (!w.isDestroyed()) w.webContents.send(channel, payload);
        }
    }

    function fail(e, code = 'BENCHMARK_ERROR') {
        return { ok: false, error: e?.message || String(e), code };
    }

    ipcMain.handle('benchmark:listTasks', () => ({ ok: true, tasks: TASKS }));

    ipcMain.handle('benchmark:getCorpus', () => {
        try {
            return { ok: true, ...loadCorpus() };
        } catch (e) {
            return fail(e);
        }
    });

    ipcMain.handle('benchmark:getResults', (_e, opts = {}) => {
        try {
            const profile = getProfile();
            const fp = opts.fingerprint || hardwareFingerprint(profile);
            const results = store.latestByEngine(fp);
            const byEngine = {};
            for (const r of results) {
                const summary = benchSummary(r);
                byEngine[r.engineId] = {
                    ...r,
                    localMetrics: summary,
                    localMetricsText: formatLocalMetrics(summary),
                };
            }
            return {
                ok: true,
                hardwareFingerprint: fp,
                results,
                byEngine,
            };
        } catch (e) {
            return fail(e);
        }
    });

    ipcMain.handle('benchmark:run', async (_e, opts = {}) => {
        try {
            const result = await runBenchmark({
                engineInit,
                engineSynthesize,
                engineUnload,
                getSettings,
                onProgress: (p) => broadcast('benchmark:progress', p),
            }, {
                engineId: opts.engineId,
                variant: opts.variant,
                lang: opts.lang,
                includeOnline: Boolean(opts.includeOnline),
                forceHardware: Boolean(opts.forceHardware),
            });
            broadcast('benchmark:done', {
                hardwareFingerprint: result.hardwareFingerprint,
                count: result.results?.length || 0,
            });
            return result;
        } catch (e) {
            return fail(e, 'BENCHMARK_RUN_FAILED');
        }
    });

    ipcMain.handle('benchmark:recommend', (_e, opts = {}) => {
        try {
            const settings = getSettings?.() || {};
            const profile = getProfile();
            const fp = hardwareFingerprint(profile);
            const engines = registry.listPublic((e) => install.getInstallState(e));
            const benchResults = store.latestByEngine(fp);
            const task = opts.task
                || settings.benchmarkPreferredTask
                || 'vi-general';
            const out = recommend({
                task,
                language: opts.language || settings.benchmarkPreferredLanguage,
                engines,
                hardware: profile,
                benchResults,
                userPreference: opts.userPreference
                    || settings.benchmarkPreferredEngine
                    || settings.selectedBatchEngine,
            });
            return { ...out, hardwareFingerprint: fp, autoDownload: false };
        } catch (e) {
            return fail(e);
        }
    });
}

module.exports = { createBenchmarkIpc };
