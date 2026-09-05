/**
 * Self-check: optional isolated Python runtime manager (fake provision).
 * Run: electron electron/engine-runtime-manager.selfcheck.cjs
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { app } = require('electron');
const paths = require('./paths.cjs');
const rt = require('./engine-runtime-manager.cjs');

app.whenReady().then(async () => {
    const tmp = path.join(os.tmpdir(), `khepree-rt-${Date.now()}`);
    fs.mkdirSync(tmp, { recursive: true });

    try {
        paths.setRuntimeStorageDir(tmp);
        assert.strictEqual(paths.getUserRuntimesDir(), path.resolve(tmp));

        // Forbidden: no repo / resources for runtimes
        assert.strictEqual(
            paths.resolveSafeOptionalModelsRoot(path.join(__dirname, '..')),
            null
        );

        rt.clearRegistrations();

        // Shared Chatterbox + separate Qwen / Spark / GPT-SoVITS
        rt.registerRuntime({ id: 'chatterbox', strategy: rt.STRATEGY.ISOLATED_PYTHON, label: 'Chatterbox' });
        rt.registerRuntime({ id: 'qwen', strategy: rt.STRATEGY.ISOLATED_PYTHON, label: 'Qwen' });
        rt.registerRuntime({ id: 'spark', strategy: rt.STRATEGY.ISOLATED_PYTHON, label: 'Spark' });
        rt.registerRuntime({ id: 'gpt-sovits', strategy: rt.STRATEGY.ISOLATED_PYTHON, label: 'GPT-SoVITS' });
        rt.registerRuntime({ id: 'core', strategy: rt.STRATEGY.CORE_PYTHON });
        rt.registerRuntime({ id: 'online', strategy: rt.STRATEGY.ONLINE });

        rt.bindEngine('chatterbox-nano', 'chatterbox');
        rt.bindEngine('chatterbox-turbo', 'chatterbox');
        rt.bindEngine('qwen-tts', 'qwen');
        rt.bindEngine('spark-tts', 'spark');
        rt.bindEngine('gpt-sovits', 'gpt-sovits');
        rt.bindEngine('edge-fake', 'online');

        assert.strictEqual(rt.resolveRuntimeId('chatterbox-nano'), 'chatterbox');
        assert.strictEqual(rt.resolveRuntimeId('chatterbox-turbo'), 'chatterbox');
        assert.strictEqual(rt.resolveRuntimeId('qwen-tts'), 'qwen');

        assert.strictEqual(rt.isInstalled('chatterbox-nano'), false);
        assert.strictEqual(rt.getStatus('chatterbox-nano'), rt.STATUS.NOT_INSTALLED);

        // Install via nano → shared tree; turbo sees INSTALLED
        const inst = await rt.install('chatterbox-nano');
        assert.strictEqual(inst.status, rt.STATUS.INSTALLED);
        assert.strictEqual(rt.isInstalled('chatterbox-nano'), true);
        assert.strictEqual(rt.isInstalled('chatterbox-turbo'), true);
        assert.strictEqual(rt.isInstalled('qwen-tts'), false);

        const nanoPy = rt.resolvePython('chatterbox-nano');
        const turboPy = rt.resolvePython('chatterbox-turbo');
        assert.strictEqual(nanoPy.cmd, turboPy.cmd);
        assert.strictEqual(nanoPy.runtimeId, 'chatterbox');
        assert.strictEqual(nanoPy.strategy, rt.STRATEGY.ISOLATED_PYTHON);
        assert.ok(fs.existsSync(nanoPy.cmd));
        assert.ok(nanoPy.cmd.startsWith(path.resolve(tmp)));

        // Separate runtimes
        await rt.install('qwen-tts');
        await rt.install('spark-tts');
        const qwenPy = rt.resolvePython('qwen-tts');
        const sparkPy = rt.resolvePython('spark-tts');
        assert.notStrictEqual(qwenPy.cmd, sparkPy.cmd);
        assert.notStrictEqual(qwenPy.runtimeId, sparkPy.runtimeId);

        const v = rt.verify('chatterbox-turbo');
        assert.strictEqual(v.ok, true);

        // Corrupt → BROKEN; must not resolve
        fs.unlinkSync(nanoPy.cmd);
        assert.strictEqual(rt.getStatus('chatterbox-nano'), rt.STATUS.BROKEN);
        assert.throws(
            () => rt.resolvePython('chatterbox-nano'),
            (e) => e.code === 'RUNTIME_BROKEN'
        );

        // Reinstall shared
        await rt.install('chatterbox-turbo');
        assert.strictEqual(rt.isInstalled('chatterbox-nano'), true);

        // Uninstall shared via one engine → both gone
        rt.uninstall('chatterbox-nano');
        assert.strictEqual(rt.isInstalled('chatterbox-nano'), false);
        assert.strictEqual(rt.isInstalled('chatterbox-turbo'), false);
        assert.strictEqual(rt.isInstalled('qwen-tts'), true);

        // Core engines from registry — no PATH mutation, uses resolvePythonCmd
        assert.strictEqual(rt.resolveRuntimeId('vieneu'), 'core');
        assert.strictEqual(rt.resolveRuntimeId('edge'), 'core');
        const core = rt.resolvePython('vieneu');
        assert.strictEqual(core.strategy, rt.STRATEGY.CORE_PYTHON);
        assert.ok(core.cmd);
        assert.strictEqual(rt.uninstall('vieneu').code, 'CORE_PROTECTED');

        // ONLINE — no python
        assert.strictEqual(rt.isInstalled('edge-fake'), true);
        const online = rt.resolvePython('edge-fake');
        assert.strictEqual(online.cmd, null);
        assert.strictEqual(online.strategy, rt.STRATEGY.ONLINE);

        // No system PATH requirement for isolated: PATH unchanged by install
        const pathBefore = process.env.PATH;
        await rt.install('gpt-sovits');
        assert.strictEqual(process.env.PATH, pathBefore);

        console.log('engine-runtime-manager.selfcheck: ok');
        console.log('  runtimes root:', tmp);
        paths.setRuntimeStorageDir('');
        rt.clearRegistrations();
        fs.rmSync(tmp, { recursive: true, force: true });
        app.quit();
    } catch (e) {
        console.error('engine-runtime-manager.selfcheck FAILED:', e);
        try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* */ }
        app.exit(1);
    }
});
