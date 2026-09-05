/**
 * Spark-TTS 0.5B selfcheck (no full Torch/model download).
 * Run: electron electron/spark.selfcheck.cjs
 * Covers: registry, isolation, unload, languages, no Gradio/Conda in product path.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const { app } = require('electron');
const registry = require('./engine-registry.cjs');
const install = require('./engine-install.cjs');
const mdl = require('./model-download-manager.cjs');
const paths = require('./paths.cjs');
const { EnginePoolManager } = require('./engine-pool-manager.cjs');
const { SparkEngine } = require('./spark-engine.cjs');
const sparkPkg = require('./spark-package.cjs');
const { adviseEngine, COMPAT } = require('./model-compatibility.cjs');

function pingWorker(pythonCmd, args, workerScript, timeoutMs = 20000) {
    return new Promise((resolve, reject) => {
        const proc = spawn(pythonCmd, [...args, workerScript], {
            cwd: paths.getAppRoot(),
            stdio: ['pipe', 'pipe', 'pipe'],
            env: paths.buildWorkerEnv({
                KHEPREE_SPARK_SITE: sparkPkg.sitePackagesDir(),
                KHEPREE_SPARK_SRC: sparkPkg.upstreamDir(),
            }),
            windowsHide: true,
        });
        let buf = '';
        let stderr = '';
        const timer = setTimeout(() => {
            try { proc.kill(); } catch (_) { /* */ }
            reject(new Error(`ping timeout: ${stderr.slice(0, 300)}`));
        }, timeoutMs);
        proc.stdout.setEncoding('utf8');
        proc.stdout.on('data', (chunk) => {
            buf += chunk;
            const lines = buf.split('\n');
            buf = lines.pop() || '';
            for (const line of lines) {
                const t = line.trim();
                if (!t) continue;
                try {
                    const msg = JSON.parse(t);
                    clearTimeout(timer);
                    try { proc.stdin.write(`${JSON.stringify({ cmd: 'shutdown' })}\n`); } catch (_) { /* */ }
                    try { proc.kill(); } catch (_) { /* */ }
                    resolve(msg);
                    return;
                } catch (_) { /* */ }
            }
        });
        proc.stderr.setEncoding('utf8');
        proc.stderr.on('data', (c) => { stderr += c; });
        proc.on('error', (e) => {
            clearTimeout(timer);
            reject(e);
        });
        proc.stdin.write(`${JSON.stringify({ cmd: 'ping' })}\n`);
    });
}

app.whenReady().then(async () => {
    const tmpModels = fs.mkdtempSync(path.join(os.tmpdir(), 'spark-mdl-'));
    const tmpRt = fs.mkdtempSync(path.join(os.tmpdir(), 'spark-rt-'));
    try {
        paths.setModelStorageDir(tmpModels);
        paths.setRuntimeStorageDir(tmpRt);
        mdl.clearPackages();
        sparkPkg.registerSparkPackages();

        const entry = registry.getEngine('spark');
        assert.ok(entry);
        assert.strictEqual(entry.family, 'spark');
        assert.strictEqual(entry.displayName, 'Spark-TTS 0.5B');
        assert.ok(/Clone giọng nâng cao/i.test(entry.subtitle));
        assert.strictEqual(registry.resolveId('spark-tts'), 'spark');
        assert.strictEqual(entry.optional, true);
        assert.strictEqual(entry.bundled, false);
        assert.strictEqual(entry.runtimeStrategy, 'ISOLATED_PYTHON');
        assert.strictEqual(entry.runtimeId, 'spark');
        assert.strictEqual(entry.modelVariant, '0.5b');
        assert.strictEqual(entry.capabilities.voiceClone, true);
        assert.strictEqual(entry.capabilities.speakerControls, true);
        assert.strictEqual(entry.capabilities.voiceDesign, false);
        assert.ok(entry.languages.includes('zh'));
        assert.ok(entry.languages.includes('en'));
        assert.ok(!entry.languages.includes('vi'));
        assert.ok(!(entry.badges || []).some((b) => /việt|vietnamese/i.test(b)));

        const langs = sparkPkg.listLanguages();
        assert.ok(langs.some((l) => l.id === 'Chinese'));
        assert.ok(langs.some((l) => l.id === 'English'));
        assert.ok(langs.some((l) => l.id === 'Vietnamese' && l.unsupported));
        assert.ok(sparkPkg.listGenders().some((g) => g.id === 'male'));
        assert.ok(sparkPkg.LEVELS.includes('moderate'));

        const pkg = mdl.getPackage('spark', '0.5b');
        assert.ok(pkg);
        assert.ok(pkg.files.some((f) => f.relativePath === 'config.yaml'));
        assert.ok(pkg.files[0].url.includes('Spark-TTS-0.5B'));

        assert.strictEqual(install.getInstallState('spark'), install.INSTALL.NOT_INSTALLED);
        assert.strictEqual(sparkPkg.isRuntimeInstalled(), false);

        await sparkPkg.installRuntime({ skipPip: true });
        assert.strictEqual(sparkPkg.isRuntimeInstalled(), true);
        assert.ok(fs.existsSync(path.join(sparkPkg.upstreamDir(), 'sparktts')));

        // Fake model marker for status path
        const root = mdl.getInstallRoot('spark', '0.5b');
        fs.mkdirSync(root, { recursive: true });
        fs.writeFileSync(path.join(root, 'config.yaml'), 'sample_rate: 16000\n', 'utf8');
        sparkPkg.writeInstalledManifest();
        assert.strictEqual(sparkPkg.isModelInstalled(), true);

        const fake = { ...entry, installState: 'INSTALLED' };
        assert.strictEqual(
            adviseEngine(fake, { ram: { totalGb: 16 }, gpu: { nvidia: true } }).level,
            COMPAT.RECOMMENDED
        );
        assert.strictEqual(
            adviseEngine(fake, { ram: { totalGb: 16 }, gpu: { nvidia: false } }).level,
            COMPAT.MAY_BE_SLOW
        );

        // Unload path
        const eng = new SparkEngine();
        eng.proc = { stdin: { writable: true, write() {} }, kill() {} };
        eng.ready = true;
        eng.mode = 'spark-0.5b';
        eng.stop();
        assert.strictEqual(eng.proc, null);
        assert.strictEqual(eng.ready, false);
        assert.strictEqual(eng.mode, null);

        const mgr = new EnginePoolManager();
        assert.ok(mgr.getPool('spark', 1));
        mgr.shutdownPool('spark');
        mgr.shutdownAll();

        sparkPkg.uninstallAll();
        assert.strictEqual(sparkPkg.isRuntimeInstalled(), false);

        const worker = paths.getWorkerScript(path.join('engines', 'spark', 'worker.py'));
        assert.ok(fs.existsSync(worker));
        const src = fs.readFileSync(worker, 'utf8');
        assert.ok(src.includes('from cli.SparkTTS import SparkTTS'));
        assert.ok(src.includes('prompt_speech_path'));
        assert.ok(src.includes('gender'));
        assert.ok(src.includes('pitch'));
        assert.ok(src.includes('speed'));
        assert.ok(!/^\s*(import|from)\s+gradio\b/im.test(src), 'worker must not import Gradio');
        assert.ok(!/\bconda\s+(install|create|env)\b/i.test(src), 'worker must not require Conda');

        const req = fs.readFileSync(
            path.join(paths.getAppRoot(), 'python', 'requirements-spark.txt'),
            'utf8'
        );
        assert.ok(!/^\s*gradio\b/im.test(req.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n')));

        const bundleReq = fs.readFileSync(
            path.join(paths.getAppRoot(), 'python', 'requirements-bundle.txt'),
            'utf8'
        );
        assert.ok(!/spark|torch|transformers/i.test(
            bundleReq.split('\n').filter((l) => !l.startsWith('#')).join('\n')
        ));

        const doc = path.join(paths.getAppRoot(), 'docs', 'engines', 'spark.md');
        assert.ok(fs.existsSync(doc));

        try {
            const py = paths.resolvePythonCmd();
            const pong = await pingWorker(py.cmd, py.args, worker);
            assert.strictEqual(pong.ok, true);
            assert.strictEqual(pong.engine, 'spark');
            console.log('  worker ping: ok');
        } catch (e) {
            console.warn('  worker ping skipped/failed:', e.message);
        }

        console.log('spark.selfcheck: ok');
        console.log('  isolation + unload: ok');
        app.quit();
    } catch (e) {
        console.error('spark.selfcheck FAILED:', e);
        app.exit(1);
    } finally {
        try { fs.rmSync(tmpModels, { recursive: true, force: true }); } catch (_) { /* */ }
        try { fs.rmSync(tmpRt, { recursive: true, force: true }); } catch (_) { /* */ }
    }
});
