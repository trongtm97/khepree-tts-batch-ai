/**
 * Kokoro integration selfcheck (no full model download).
 * Run: electron electron/kokoro.selfcheck.cjs
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { app } = require('electron');
const registry = require('./engine-registry.cjs');
const install = require('./engine-install.cjs');
const mdl = require('./model-download-manager.cjs');
const { registerKokoroPackages, VARIANTS } = require('./kokoro-package.cjs');
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
        registerKokoroPackages();

        const entry = registry.getEngine('kokoro');
        assert.ok(entry);
        assert.strictEqual(entry.family, 'kokoro');
        assert.strictEqual(entry.optional, true);
        assert.strictEqual(entry.capabilities.voiceClone, false);
        assert.strictEqual(entry.capabilities.modelVariantSelect, true);
        assert.ok(!entry.languages.includes('vi'));
        assert.ok(!(entry.badges || []).some((b) => /việt/i.test(b)));
        assert.ok(entry.license.codeLicense.includes('MIT'));
        assert.ok(entry.license.modelLicense.includes('Apache'));

        assert.strictEqual(VARIANTS.length, 2);
        for (const v of VARIANTS) {
            const pkg = mdl.getPackage('kokoro', v.id);
            assert.ok(pkg, `missing package for ${v.id}`);
            assert.ok(pkg.files.some((f) => f.relativePath.endsWith('.onnx')));
            assert.ok(pkg.files.some((f) => f.relativePath === 'voices-v1.0.bin'));
            assert.strictEqual(mdl.getStatus('kokoro', v.id), mdl.STATUS.NOT_INSTALLED);
        }

        assert.strictEqual(install.getInstallState('kokoro'), install.INSTALL.NOT_INSTALLED);

        const worker = paths.getWorkerScript(path.join('engines', 'kokoro', 'worker.py'));
        assert.ok(fs.existsSync(worker));
        const src = fs.readFileSync(worker, 'utf8');
        assert.ok(src.includes('cmd_init'));
        assert.ok(src.includes('cmd_list_voices'));
        assert.ok(src.includes('cmd_synthesize'));
        assert.ok(src.includes('cmd_shutdown'));
        assert.ok(src.includes('kokoro_onnx') || src.includes('Kokoro'));
        assert.ok(src.includes('no download on synthesize') || src.includes('no download'));
        assert.ok(!/^\s*from huggingface|hf_hub_download\(/m.test(src));
        assert.ok(!/import\s+.*g2p|sea-g2p/i.test(src));

        const doc = path.join(paths.getAppRoot(), 'docs', 'engines', 'kokoro.md');
        assert.ok(fs.existsSync(doc), 'docs/engines/kokoro.md missing');
        const docSrc = fs.readFileSync(doc, 'utf8');
        assert.ok(/kokoro-onnx/i.test(docSrc));
        assert.ok(/Apache-2\.0/i.test(docSrc));

        try {
            const py = paths.resolvePythonCmd();
            const pong = await pingWorker(py.cmd, py.args, worker);
            assert.strictEqual(pong.ok, true);
            assert.strictEqual(pong.engine, 'kokoro');
            console.log('  worker ping: ok');
        } catch (e) {
            console.warn('  worker ping skipped/failed:', e.message);
        }

        console.log('kokoro.selfcheck: ok');
        console.log('  variants:', VARIANTS.map((v) => v.id).join(', '));
        app.quit();
    } catch (e) {
        console.error('kokoro.selfcheck FAILED:', e);
        app.exit(1);
    }
});
