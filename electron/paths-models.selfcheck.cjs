/**
 * Self-check: optional vs bundled model path logic (P09).
 * Run: electron electron/paths-models.selfcheck.cjs
 */
const assert = require('assert');
const path = require('path');
const os = require('os');
const { app } = require('electron');
const paths = require('./paths.cjs');

app.whenReady().then(() => {
    try {
        const bundled = paths.getBundledModelsDir();
        const compat = paths.getModelsDir();
        assert.strictEqual(bundled, compat, 'getModelsDir must stay bundled for VieNeu');
        assert.ok(bundled.endsWith(`${path.sep}models`) || bundled.endsWith('/models'));

        // Dev: bundled under repo; packaged: under resourcesPath
        if (app.isPackaged) {
            assert.ok(
                bundled.startsWith(path.resolve(process.resourcesPath)),
                'packaged bundled models under resourcesPath'
            );
        } else {
            const repo = path.resolve(path.join(__dirname, '..'));
            assert.ok(bundled.startsWith(repo), 'dev bundled models under repo');
        }

        const userDefault = paths.getUserModelsDir();
        const userDataModels = path.join(app.getPath('userData'), 'models');
        assert.strictEqual(userDefault, userDataModels);

        // Forbidden: resources / app path / repo / Program Files
        assert.strictEqual(paths.resolveSafeOptionalModelsRoot(process.resourcesPath), null);
        assert.strictEqual(paths.resolveSafeOptionalModelsRoot(app.getAppPath()), null);
        assert.strictEqual(paths.resolveSafeOptionalModelsRoot(path.join(__dirname, '..')), null);
        assert.strictEqual(
            paths.resolveSafeOptionalModelsRoot(path.join(__dirname, '..', 'models', 'piper')),
            null,
            'must not use repo models/ for optional'
        );
        if (process.platform === 'win32' && process.env.ProgramFiles) {
            assert.strictEqual(
                paths.resolveSafeOptionalModelsRoot(path.join(process.env.ProgramFiles, 'KhepreeModels')),
                null
            );
        }

        // Safe custom dir under temp/userData
        const custom = path.join(os.tmpdir(), 'khepree-opt-models-test');
        const resolved = paths.resolveSafeOptionalModelsRoot(custom);
        assert.strictEqual(resolved, path.resolve(custom));

        paths.setModelStorageDir(custom);
        assert.strictEqual(paths.getUserModelsDir(), path.resolve(custom));
        assert.strictEqual(paths.getConfiguredModelStorageDir(), path.resolve(custom));

        // Unsafe setting ignored
        paths.setModelStorageDir(process.resourcesPath || path.join(__dirname, '..'));
        assert.strictEqual(paths.getConfiguredModelStorageDir(), '');
        assert.strictEqual(paths.getUserModelsDir(), userDataModels);

        // Engine dirs
        const vieneuDir = paths.getEngineModelDir('vieneu');
        assert.strictEqual(vieneuDir, path.join(paths.getBundledModelsDir(), 'vieneu'));

        paths.setModelStorageDir(custom);
        const piperDir = paths.getEngineModelDir('piper');
        assert.strictEqual(piperDir, path.join(path.resolve(custom), 'piper'));
        assert.ok(!piperDir.startsWith(paths.getBundledModelsDir()));

        // Reset
        paths.setModelStorageDir('');

        console.log('paths-models.selfcheck: ok');
        console.log('  bundled:', bundled);
        console.log('  userData:', userDataModels);
        console.log('  packaged:', app.isPackaged);
        app.quit();
    } catch (e) {
        console.error('FAIL:', e);
        app.quit();
        process.exit(1);
    }
});
