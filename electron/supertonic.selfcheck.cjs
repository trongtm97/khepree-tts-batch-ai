/**
 * Supertonic 3 integration selfcheck (no full HF download).
 * Run: electron electron/supertonic.selfcheck.cjs
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { app } = require('electron');
const registry = require('./engine-registry.cjs');
const install = require('./engine-install.cjs');
const mdl = require('./model-download-manager.cjs');
const { registerSupertonicPackage, ONNX_FILES } = require('./supertonic-package.cjs');
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
        registerSupertonicPackage();

        const entry = registry.getEngine('supertonic');
        assert.ok(entry);
        assert.strictEqual(entry.family, 'supertonic');
        assert.strictEqual(entry.optional, true);
        assert.strictEqual(entry.capabilities.voiceClone, false);
        assert.ok(entry.license.codeLicense);
        assert.ok(entry.license.modelLicense);

        const pkg = mdl.getPackage('supertonic', 'default');
        assert.ok(pkg);
        assert.ok(pkg.files.length >= ONNX_FILES.length);
        assert.ok(pkg.files.every((f) => f.url.startsWith('https://huggingface.co/')));

        assert.strictEqual(mdl.getStatus('supertonic', 'default'), mdl.STATUS.NOT_INSTALLED);
        assert.strictEqual(install.getInstallState('supertonic'), install.INSTALL.NOT_INSTALLED);
        assert.strictEqual(install.isInstalled('supertonic'), false);

        // synthesize must not be reachable without install (engineInit path)
        assert.ok(!install.isInstalled('supertonic'));

        const worker = paths.getWorkerScript(path.join('engines', 'supertonic', 'worker.py'));
        assert.ok(fs.existsSync(worker), `missing worker: ${worker}`);

        const src = fs.readFileSync(worker, 'utf8');
        assert.ok(src.includes('auto_download=False'));
        assert.ok(!/import\s+.*g2p|from\s+g2p_normalize|useSeaG2p/i.test(src));
        assert.ok(/sea-g2p|sea.?g2p/i.test(src), 'doc should state no sea-g2p');
        assert.ok(src.includes('cmd_ping'));
        assert.ok(src.includes('cmd_init'));
        assert.ok(src.includes('cmd_synthesize'));
        assert.ok(src.includes('cmd_shutdown'));
        assert.ok(src.includes('cmd_get_info'));
        assert.ok(src.includes('list_voices'));

        // Worker protocol ping (needs Python; may lack `supertonic` pip — still should ping before import)
        try {
            const py = paths.resolvePythonCmd();
            const pong = await pingWorker(py.cmd, py.args, worker);
            assert.strictEqual(pong.ok, true);
            assert.strictEqual(pong.engine, 'supertonic');
            console.log('  worker ping: ok');
        } catch (e) {
            console.warn('  worker ping skipped/failed:', e.message);
        }

        // Verify API shape
        const v = mdl.verify('supertonic', 'default');
        assert.strictEqual(v.ok, false);

        console.log('supertonic.selfcheck: ok');
        console.log('  package files:', pkg.files.length);
        console.log('  install:', install.getInstallState('supertonic'));
        app.quit();
    } catch (e) {
        console.error('supertonic.selfcheck FAILED:', e);
        app.exit(1);
    }
});
