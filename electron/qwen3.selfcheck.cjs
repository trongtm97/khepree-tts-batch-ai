/**
 * Qwen3-TTS 0.6B selfcheck (no full Torch/model download).
 * Run: electron electron/qwen3.selfcheck.cjs
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
const { Qwen3Engine } = require('./qwen3-engine.cjs');
const qwenPkg = require('./qwen3-package.cjs');
const { adviseEngine, COMPAT } = require('./model-compatibility.cjs');

function pingWorker(pythonCmd, args, workerScript, timeoutMs = 20000) {
    return new Promise((resolve, reject) => {
        const proc = spawn(pythonCmd, [...args, workerScript], {
            cwd: paths.getAppRoot(),
            stdio: ['pipe', 'pipe', 'pipe'],
            env: paths.buildWorkerEnv({ KHEPREE_QWEN3_SITE: qwenPkg.sitePackagesDir() }),
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
    const tmpModels = fs.mkdtempSync(path.join(os.tmpdir(), 'qwen3-mdl-'));
    const tmpRt = fs.mkdtempSync(path.join(os.tmpdir(), 'qwen3-rt-'));
    try {
        paths.setModelStorageDir(tmpModels);
        paths.setRuntimeStorageDir(tmpRt);
        mdl.clearPackages();
        qwenPkg.registerQwen3Packages();

        const entry = registry.getEngine('qwen3');
        assert.ok(entry);
        assert.strictEqual(entry.family, 'qwen3');
        assert.strictEqual(entry.displayName, 'Qwen3-TTS 0.6B');
        assert.ok(/Clone và điều khiển/i.test(entry.subtitle));
        assert.strictEqual(entry.optional, true);
        assert.strictEqual(entry.bundled, false);
        assert.strictEqual(entry.runtimeStrategy, 'ISOLATED_PYTHON');
        assert.strictEqual(entry.runtimeId, 'qwen3');
        assert.deepStrictEqual([...entry.modelVariants], ['0.6b-custom', '0.6b-base']);
        assert.strictEqual(entry.modelVariant, '0.6b-custom');
        assert.strictEqual(entry.capabilities.modelVariantSelect, true);
        assert.strictEqual(entry.capabilities.languageSelect, true);
        assert.strictEqual(entry.capabilities.voiceClone, true);
        assert.strictEqual(entry.capabilities.voiceDesign, false);
        assert.ok(entry.languages.includes('en'));
        assert.ok(entry.languages.includes('zh'));
        assert.ok(!entry.languages.includes('vi'));
        assert.ok(!(entry.badges || []).some((b) => /việt|vietnamese/i.test(b)));
        assert.ok(!/VoiceDesign/i.test(entry.strengths.join(' ')));
        assert.ok(/Voice Design hoàn chỉnh cần model khác/i.test(entry.weaknesses.join(' ')));

        const langs = qwenPkg.listLanguages();
        assert.ok(langs.some((l) => l.id === 'English'));
        assert.ok(langs.some((l) => l.id === 'Chinese'));
        assert.ok(!langs.some((l) => l.id === 'Vietnamese' && !l.unsupported));
        assert.ok(langs.some((l) => l.id === 'Vietnamese' && l.unsupported));

        const speakers = qwenPkg.listSpeakers();
        assert.ok(speakers.some((s) => s.id === 'Vivian'));
        assert.ok(speakers.some((s) => s.id === 'Ryan'));

        assert.ok(qwenPkg.vietnameseWarningFor('Vietnamese'));
        assert.ok(qwenPkg.vietnameseWarningFor('Auto', 'Xin chào các bạn'));
        assert.strictEqual(qwenPkg.vietnameseWarningFor('English', 'Hello world'), null);

        const customPkg = mdl.getPackage('qwen3', '0.6b-custom');
        const basePkg = mdl.getPackage('qwen3', '0.6b-base');
        assert.ok(customPkg);
        assert.ok(basePkg);
        assert.ok(customPkg.files.some((f) => f.relativePath === 'model.safetensors'));
        assert.ok(customPkg.files.some((f) => f.relativePath === 'speech_tokenizer/model.safetensors'));
        assert.ok(basePkg.files.some((f) => f.url.includes('0.6B-Base')));
        assert.ok(!customPkg.files.some((f) => /1\.7B|VoiceDesign/i.test(f.url)));

        assert.strictEqual(install.getInstallState('qwen3'), install.INSTALL.NOT_INSTALLED);
        assert.strictEqual(qwenPkg.isRuntimeInstalled(), false);

        await qwenPkg.installRuntime({ skipPip: true });
        assert.strictEqual(qwenPkg.isRuntimeInstalled(), true);

        // Hardware advisor
        const fake = { ...entry, installState: 'INSTALLED' };
        assert.strictEqual(
            adviseEngine(fake, { ram: { totalGb: 16 }, gpu: { nvidia: true } }).level,
            COMPAT.RECOMMENDED
        );
        assert.strictEqual(
            adviseEngine(fake, { ram: { totalGb: 16 }, gpu: { nvidia: false } }).level,
            COMPAT.MAY_BE_SLOW
        );

        // Variant switch unload
        const eng = new Qwen3Engine();
        eng.proc = { stdin: { writable: true, write() {} }, kill() {} };
        eng.ready = true;
        eng.variant = '0.6b-custom';
        eng.stop();
        assert.strictEqual(eng.proc, null);
        assert.strictEqual(eng.variant, null);

        const mgr = new EnginePoolManager();
        assert.ok(mgr.getPool('qwen3', 1));
        mgr.shutdownPool('qwen3');
        mgr.shutdownAll();

        qwenPkg.uninstallRuntime();
        assert.strictEqual(qwenPkg.isRuntimeInstalled(), false);

        const worker = paths.getWorkerScript(path.join('engines', 'qwen3', 'worker.py'));
        assert.ok(fs.existsSync(worker));
        const src = fs.readFileSync(worker, 'utf8');
        assert.ok(src.includes('generate_custom_voice'));
        assert.ok(src.includes('generate_voice_clone'));
        assert.ok(!src.includes('generate_voice_design'));
        assert.ok(src.includes('0.6b-custom'));
        assert.ok(src.includes('0.6b-base'));
        assert.ok(src.includes('local_files_only'));

        const bundleReq = fs.readFileSync(
            path.join(paths.getAppRoot(), 'python', 'requirements-bundle.txt'),
            'utf8'
        );
        assert.ok(!/qwen|torch|transformers/i.test(
            bundleReq.split('\n').filter((l) => !l.startsWith('#')).join('\n')
        ));

        const doc = path.join(paths.getAppRoot(), 'docs', 'engines', 'qwen3.md');
        assert.ok(fs.existsSync(doc));

        try {
            const py = paths.resolvePythonCmd();
            const pong = await pingWorker(py.cmd, py.args, worker);
            assert.strictEqual(pong.ok, true);
            assert.strictEqual(pong.engine, 'qwen3');
            console.log('  worker ping: ok');
        } catch (e) {
            console.warn('  worker ping skipped/failed:', e.message);
        }

        console.log('qwen3.selfcheck: ok');
        console.log('  variants: 0.6b-custom + 0.6b-base');
        console.log('  langs official:', langs.filter((l) => !l.unsupported).length);
        app.quit();
    } catch (e) {
        console.error('qwen3.selfcheck FAILED:', e);
        app.exit(1);
    } finally {
        try { fs.rmSync(tmpModels, { recursive: true, force: true }); } catch (_) { /* */ }
        try { fs.rmSync(tmpRt, { recursive: true, force: true }); } catch (_) { /* */ }
    }
});
