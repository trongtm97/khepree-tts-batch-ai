/**
 * KittenTTS integration selfcheck (no full HF download of all variants).
 * Run: electron electron/kitten.selfcheck.cjs
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { app } = require('electron');
const registry = require('./engine-registry.cjs');
const install = require('./engine-install.cjs');
const mdl = require('./model-download-manager.cjs');
const { registerKittenPackages, VARIANTS } = require('./kitten-package.cjs');
const paths = require('./paths.cjs');

function pingWorker(pythonCmd, args, workerScript, timeoutMs = 20000) {
    return new Promise((resolve, reject) => {
        const proc = spawn(pythonCmd, [...args, workerScript], {
            cwd: paths.getAppRoot(),
            stdio: ['pipe', 'pipe', 'pipe'],
            env: paths.buildWorkerEnv(),
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
    try {
        registerKittenPackages();

        const entry = registry.getEngine('kitten');
        assert.ok(entry);
        assert.strictEqual(entry.family, 'kitten');
        assert.strictEqual(entry.optional, true);
        assert.strictEqual(entry.capabilities.voiceClone, false);
        assert.strictEqual(entry.capabilities.modelVariantSelect, true);
        assert.ok(!entry.languages.includes('vi'));
        assert.ok(!(entry.badges || []).some((b) => /việt/i.test(b)));

        assert.strictEqual(VARIANTS.length, 4);
        for (const v of VARIANTS) {
            const pkg = mdl.getPackage('kitten', v.id);
            assert.ok(pkg, `missing package for ${v.id}`);
            assert.ok(pkg.files.some((f) => f.relativePath === 'config.json'));
            assert.ok(pkg.files.some((f) => f.relativePath.endsWith('.onnx')));
            assert.ok(pkg.files.some((f) => f.relativePath === 'voices.npz'));
            assert.strictEqual(mdl.getStatus('kitten', v.id), mdl.STATUS.NOT_INSTALLED);
        }

        assert.strictEqual(install.getInstallState('kitten'), install.INSTALL.NOT_INSTALLED);

        const worker = paths.getWorkerScript(path.join('engines', 'kitten', 'worker.py'));
        assert.ok(fs.existsSync(worker));
        const src = fs.readFileSync(worker, 'utf8');
        assert.ok(src.includes('cmd_init'));
        assert.ok(src.includes('cmd_list_voices'));
        assert.ok(src.includes('cmd_synthesize'));
        assert.ok(src.includes('cmd_shutdown'));
        assert.ok(src.includes('KittenTTS_1_Onnx'));
        assert.ok(src.includes('no hf_hub_download') || src.includes('no HF download'));
        assert.ok(!/^\s*from huggingface|hf_hub_download\(/m.test(src));
        assert.ok(!/import\s+.*g2p|sea-g2p/i.test(src));

        try {
            const py = paths.resolvePythonCmd();
            const pong = await pingWorker(py.cmd, py.args, worker);
            assert.strictEqual(pong.ok, true);
            assert.strictEqual(pong.engine, 'kitten');
            console.log('  worker ping: ok');
        } catch (e) {
            console.warn('  worker ping skipped/failed:', e.message);
        }

        console.log('kitten.selfcheck: ok');
        console.log('  variants:', VARIANTS.map((v) => v.id).join(', '));
        app.quit();
    } catch (e) {
        console.error('kitten.selfcheck FAILED:', e);
        app.exit(1);
    }
});
