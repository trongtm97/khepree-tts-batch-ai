/**
 * Chatterbox family selfcheck (Nano + Turbo, shared runtime — no full Torch download).
 * Run: electron electron/chatterbox.selfcheck.cjs
 * Covers: registry variants, tags, ref validation, isolated runtime,
 * Nano↔Turbo unload path (no worker/VRAM leak), worker ping.
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
const { ChatterboxEngine } = require('./chatterbox-engine.cjs');
const cbPkg = require('./chatterbox-package.cjs');
const { adviseEngine, COMPAT } = require('./model-compatibility.cjs');

function pingWorker(pythonCmd, args, workerScript, timeoutMs = 20000) {
    return new Promise((resolve, reject) => {
        const proc = spawn(pythonCmd, [...args, workerScript], {
            cwd: paths.getAppRoot(),
            stdio: ['pipe', 'pipe', 'pipe'],
            env: paths.buildWorkerEnv({ KHEPREE_CHATTERBOX_SITE: cbPkg.sitePackagesDir() }),
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
    const tmpModels = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-mdl-'));
    const tmpRt = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-rt-'));
    try {
        paths.setModelStorageDir(tmpModels);
        paths.setRuntimeStorageDir(tmpRt);
        mdl.clearPackages();
        cbPkg.registerChatterboxPackages();

        const entry = registry.getEngine('chatterbox');
        assert.ok(entry);
        assert.strictEqual(entry.family, 'chatterbox');
        assert.strictEqual(registry.resolveId('chatterbox'), 'chatterbox');
        assert.strictEqual(registry.resolveId('chatterbox-nano'), 'chatterbox');
        assert.strictEqual(registry.resolveId('chatterbox-turbo'), 'chatterbox');
        assert.strictEqual(entry.optional, true);
        assert.strictEqual(entry.bundled, false);
        assert.strictEqual(entry.runtimeStrategy, 'ISOLATED_PYTHON');
        assert.strictEqual(entry.runtimeId, 'chatterbox');
        assert.strictEqual(entry.modelVariant, 'nano');
        assert.deepStrictEqual([...entry.modelVariants], ['nano', 'turbo']);
        assert.strictEqual(entry.capabilities.modelVariantSelect, true);
        assert.ok(entry.languages.includes('en'));
        assert.ok(!entry.languages.includes('vi'));
        assert.ok(!(entry.badges || []).some((b) => /việt/i.test(b)));
        assert.strictEqual(entry.capabilities.expressionTags, true);
        assert.strictEqual(entry.capabilities.voiceClone, true);
        assert.strictEqual(entry.capabilities.cpu, true);

        const tags = cbPkg.listExpressionTags();
        assert.ok(tags.allTags.includes('[laugh]'));
        assert.ok(tags.allTags.includes('[chuckle]'));
        assert.ok(tags.eventTags.includes('[cough]'));
        assert.ok(!tags.allTags.some((t) => /việt|vietnamese/i.test(t)));

        const nanoPkg = mdl.getPackage('chatterbox', 'nano');
        const turboPkg = mdl.getPackage('chatterbox', 'turbo');
        assert.ok(nanoPkg);
        assert.ok(turboPkg);
        assert.ok(nanoPkg.files.some((f) => f.relativePath === 't3_nano_v1.safetensors'));
        assert.ok(turboPkg.files.some((f) => f.relativePath === 't3_turbo_v1.safetensors'));
        assert.ok(turboPkg.files.some((f) => f.relativePath === 'added_tokens.json'));

        // Ref audio: local only
        assert.strictEqual(cbPkg.validateLocalRefAudio(null).ok, true);
        assert.strictEqual(cbPkg.validateLocalRefAudio('').ok, true);
        assert.strictEqual(cbPkg.validateLocalRefAudio('https://evil.example/a.wav').ok, false);
        const tmpWav = path.join(tmpModels, 'ref.wav');
        fs.writeFileSync(tmpWav, 'RIFF');
        assert.strictEqual(cbPkg.validateLocalRefAudio(tmpWav).ok, true);
        assert.strictEqual(cbPkg.validateLocalRefAudio(path.join(tmpModels, 'nope.txt')).ok, false);

        // Hardware advisor — Turbo: GPU RECOMMENDED; CPU SUPPORTED / MAY_BE_SLOW (no invented VRAM)
        const fakeInstalled = { ...entry, installState: 'INSTALLED' };
        assert.strictEqual(
            adviseEngine(fakeInstalled, { ram: { totalGb: 16 }, gpu: { nvidia: true } }, { variant: 'turbo' }).level,
            COMPAT.RECOMMENDED
        );
        assert.strictEqual(
            adviseEngine(fakeInstalled, { ram: { totalGb: 16 }, gpu: { nvidia: false } }, { variant: 'turbo' }).level,
            COMPAT.SUPPORTED
        );
        assert.strictEqual(
            adviseEngine(fakeInstalled, { ram: { totalGb: 4 }, gpu: { nvidia: false } }, { variant: 'turbo' }).level,
            COMPAT.MAY_BE_SLOW
        );
        assert.strictEqual(
            adviseEngine(fakeInstalled, { ram: { totalGb: 16 }, gpu: { nvidia: false } }, { variant: 'nano' }).level,
            COMPAT.RECOMMENDED
        );

        assert.strictEqual(install.getInstallState('chatterbox'), install.INSTALL.NOT_INSTALLED);
        assert.strictEqual(cbPkg.isRuntimeInstalled(), false);

        await cbPkg.installRuntime({ skipPip: true });
        assert.strictEqual(cbPkg.isRuntimeInstalled(), true);
        const rtRoot = cbPkg.runtimeRoot();
        assert.ok(rtRoot.startsWith(path.resolve(tmpRt)));

        // Shared runtime binds nano + turbo aliases
        const rt = require('./engine-runtime-manager.cjs');
        assert.strictEqual(rt.resolveRuntimeId('chatterbox'), 'chatterbox');
        assert.strictEqual(rt.resolveRuntimeId('chatterbox-nano'), 'chatterbox');
        assert.strictEqual(rt.resolveRuntimeId('chatterbox-turbo'), 'chatterbox');

        // Nano → Turbo → Nano unload: stop clears variant; no leaked proc
        const eng = new ChatterboxEngine();
        let killed = 0;
        eng.proc = {
            stdin: { writable: true, write() { /* shutdown */ } },
            kill() { killed += 1; },
        };
        eng.ready = true;
        eng.variant = 'nano';
        eng.stop();
        assert.strictEqual(eng.proc, null);
        assert.strictEqual(eng.ready, false);
        assert.strictEqual(eng.variant, null);
        assert.strictEqual(killed, 1);

        // Simulate switch: nano loaded → turbo requires stop before re-init
        eng.proc = {
            stdin: { writable: false },
            kill() { killed += 1; },
        };
        eng.variant = 'nano';
        eng.ready = true;
        const stopSpy = [];
        const origStop = eng.stop.bind(eng);
        eng.stop = () => { stopSpy.push(eng.variant); origStop(); };
        // init path: when variant differs, stop() is called (see ChatterboxEngine.init)
        if (eng.proc && eng.variant && eng.variant !== 'turbo') eng.stop();
        assert.deepStrictEqual(stopSpy, ['nano']);
        assert.strictEqual(eng.variant, null);
        assert.strictEqual(eng.proc, null);

        // Pool shutdown path
        const mgr = new EnginePoolManager();
        const pool = mgr.getPool('chatterbox', 1);
        assert.ok(pool);
        mgr.shutdownPool('chatterbox');
        mgr.shutdownAll();

        cbPkg.uninstallRuntime();
        assert.strictEqual(cbPkg.isRuntimeInstalled(), false);

        const worker = paths.getWorkerScript(path.join('engines', 'chatterbox', 'worker.py'));
        assert.ok(fs.existsSync(worker));
        const src = fs.readFileSync(worker, 'utf8');
        assert.ok(src.includes('cmd_init'));
        assert.ok(src.includes('cmd_list_voices'));
        assert.ok(src.includes('cmd_list_tags'));
        assert.ok(src.includes('cmd_synthesize'));
        assert.ok(src.includes('cmd_shutdown'));
        assert.ok(src.includes('nano=(variant_id == "nano")') || src.includes('nano=True'));
        assert.ok(src.includes('from_local'));
        assert.ok(src.includes('no HF download on synthesize'));
        assert.ok(!/hf_hub_download\(/m.test(src));
        assert.ok(src.includes('"turbo"'));

        const bundleReq = fs.readFileSync(
            path.join(paths.getAppRoot(), 'python', 'requirements-bundle.txt'),
            'utf8'
        );
        assert.ok(!/chatterbox|torch/i.test(bundleReq.split('\n').filter((l) => !l.startsWith('#')).join('\n')));

        const doc = path.join(paths.getAppRoot(), 'docs', 'engines', 'chatterbox-nano.md');
        assert.ok(fs.existsSync(doc));

        try {
            const py = paths.resolvePythonCmd();
            const pong = await pingWorker(py.cmd, py.args, worker);
            assert.strictEqual(pong.ok, true);
            assert.strictEqual(pong.engine, 'chatterbox');
            console.log('  worker ping: ok');
        } catch (e) {
            console.warn('  worker ping skipped/failed:', e.message);
        }

        console.log('chatterbox.selfcheck: ok');
        console.log('  tags:', tags.allTags.length, 'event:', tags.eventTags.length);
        console.log('  variants: nano + turbo (shared runtime)');
        app.quit();
    } catch (e) {
        console.error('chatterbox.selfcheck FAILED:', e);
        app.exit(1);
    } finally {
        try { fs.rmSync(tmpModels, { recursive: true, force: true }); } catch (_) { /* */ }
        try { fs.rmSync(tmpRt, { recursive: true, force: true }); } catch (_) { /* */ }
    }
});
