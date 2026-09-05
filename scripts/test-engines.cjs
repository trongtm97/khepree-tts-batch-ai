const { app } = require('electron');
const paths = require('../electron/paths.cjs');
const registry = require('../electron/engine-registry.cjs');
const install = require('../electron/engine-install.cjs');
const { EnginePoolManager } = require('../electron/engine-pool-manager.cjs');

app.whenReady().then(async () => {
    try {
        console.log('Python:', paths.resolvePythonCmd(''));
        console.log('App root:', paths.getAppRoot());
        console.log('Registry:', registry.listEngines().map((e) => e.id).join(', '));

        const mgr = new EnginePoolManager();

        for (const id of ['edge', 'vieneu', 'v3nano']) {
            const entry = registry.getEngine(id);
            console.log(`Install ${id}:`, install.getInstallState(entry));
            const pool = mgr.getPool(id, 1);
            const result = await pool.withEngine(async (engine) => {
                if (entry.family === 'edge') {
                    return engine.init('vietnamese', '');
                }
                return engine.init(entry.workerMode, '', { device: 'cpu', threads: 4 });
            });
            const n = result.voices?.length ?? 0;
            console.log(`${entry.displayName} OK:`, result.mode || result.voiceMode, n, 'voices');
            mgr.unload(id);
        }

        console.log('ALL ENGINES OK (via EnginePoolManager)');
        app.quit();
    } catch (e) {
        console.error('FAIL:', e.message);
        app.quit();
        process.exit(1);
    }
});
