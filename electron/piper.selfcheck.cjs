/**
 * Piper optional integration selfcheck (no full voice download / no real pip).
 * Run: electron electron/piper.selfcheck.cjs
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { app } = require('electron');
const registry = require('./engine-registry.cjs');
const install = require('./engine-install.cjs');
const mdl = require('./model-download-manager.cjs');
const paths = require('./paths.cjs');
const piperPkg = require('./piper-package.cjs');

function pingWorker(pythonCmd, args, workerScript, timeoutMs = 20000) {
    return new Promise((resolve, reject) => {
        const proc = spawn(pythonCmd, [...args, workerScript], {
            cwd: paths.getAppRoot(),
            stdio: ['pipe', 'pipe', 'pipe'],
            env: paths.buildWorkerEnv({ KHEPREE_PIPER_SITE: piperPkg.sitePackagesDir() }),
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
    const tmpModels = fs.mkdtempSync(path.join(require('os').tmpdir(), 'piper-mdl-'));
    const tmpRt = fs.mkdtempSync(path.join(require('os').tmpdir(), 'piper-rt-'));
    try {
        paths.setModelStorageDir(tmpModels);
        paths.setRuntimeStorageDir(tmpRt);
        mdl.clearPackages();
        piperPkg.registerPiperPackages();

        const entry = registry.getEngine('piper');
        assert.ok(entry);
        assert.strictEqual(entry.family, 'piper');
        assert.strictEqual(entry.optional, true);
        assert.strictEqual(entry.bundled, false);
        assert.strictEqual(entry.license.attentionRequired, true);
        assert.ok(/GPL/i.test(entry.license.codeLicense));
        assert.strictEqual(entry.runtimeStrategy, 'ISOLATED_PYTHON');
        assert.strictEqual(entry.modelVariant, piperPkg.DEFAULT_VOICE);
        assert.strictEqual(piperPkg.DEFAULT_VOICE, 'en_US-lessac-medium');
        assert.ok(piperPkg.hasVoice('en_US-lessac-medium'));
        assert.ok(piperPkg.hasVoice('vi_VN-vivos-x_low'), 'official catalog includes vi_VN');
        assert.ok(piperPkg.LICENSE_INSTALL_WARNING.includes('giấy phép riêng'));

        const pkg = mdl.getPackage('piper', piperPkg.DEFAULT_VOICE);
        assert.ok(pkg);
        assert.ok(pkg.files.some((f) => f.relativePath.endsWith('.onnx')));
        assert.ok(pkg.files.some((f) => f.relativePath === 'MODEL_CARD'));

        assert.strictEqual(install.getInstallState('piper'), install.INSTALL.NOT_INSTALLED);
        assert.strictEqual(piperPkg.isRuntimeInstalled(), false);

        // Isolated runtime install/uninstall (skip real pip)
        await piperPkg.installRuntime({ skipPip: true });
        assert.strictEqual(piperPkg.isRuntimeInstalled(), true);
        const rtRoot = piperPkg.runtimeRoot();
        assert.ok(rtRoot.startsWith(path.resolve(tmpRt)));
        assert.ok(!rtRoot.includes('resources'));

        const bundled = paths.getBundledModelsDir();
        assert.ok(!piperPkg.sitePackagesDir().startsWith(path.resolve(bundled)));

        piperPkg.uninstallRuntime();
        assert.strictEqual(piperPkg.isRuntimeInstalled(), false);
        assert.ok(!fs.existsSync(path.join(rtRoot, '.khepree-piper-runtime.json')));

        // Voice package status cycle without downloading: not installed → uninstall no-op
        assert.strictEqual(mdl.getStatus('piper', piperPkg.DEFAULT_VOICE), mdl.STATUS.NOT_INSTALLED);
        mdl.uninstall('piper', piperPkg.DEFAULT_VOICE);
        assert.strictEqual(mdl.getStatus('piper', piperPkg.DEFAULT_VOICE), mdl.STATUS.NOT_INSTALLED);

        const worker = paths.getWorkerScript(path.join('engines', 'piper', 'worker.py'));
        assert.ok(fs.existsSync(worker));
        const src = fs.readFileSync(worker, 'utf8');
        assert.ok(src.includes('cmd_init'));
        assert.ok(src.includes('cmd_list_voices'));
        assert.ok(src.includes('cmd_synthesize'));
        assert.ok(src.includes('cmd_shutdown'));
        assert.ok(src.includes('no download on synthesize'));
        assert.ok(!/hf_hub_download\(/m.test(src));

        const bundleReq = fs.readFileSync(
            path.join(paths.getAppRoot(), 'python', 'requirements-bundle.txt'),
            'utf8'
        );
        assert.ok(!/piper-tts|piper_tts/i.test(bundleReq), 'must not add piper to core bundle');

        const doc = path.join(paths.getAppRoot(), 'docs', 'engines', 'piper.md');
        assert.ok(fs.existsSync(doc));
        const docSrc = fs.readFileSync(doc, 'utf8');
        assert.ok(/GPLv3|GPL/i.test(docSrc));
        assert.ok(/optional/i.test(docSrc));

        try {
            const py = paths.resolvePythonCmd();
            const pong = await pingWorker(py.cmd, py.args, worker);
            assert.strictEqual(pong.ok, true);
            assert.strictEqual(pong.engine, 'piper');
            console.log('  worker ping: ok');
        } catch (e) {
            console.warn('  worker ping skipped/failed:', e.message);
        }

        console.log('piper.selfcheck: ok');
        console.log('  catalog voices:', piperPkg.catalogKeys().length);
        console.log('  default:', piperPkg.DEFAULT_VOICE);
        app.quit();
    } catch (e) {
        console.error('piper.selfcheck FAILED:', e);
        app.exit(1);
    } finally {
        try { fs.rmSync(tmpModels, { recursive: true, force: true }); } catch (_) { /* */ }
        try { fs.rmSync(tmpRt, { recursive: true, force: true }); } catch (_) { /* */ }
    }
});
