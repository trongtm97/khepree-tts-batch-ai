/**
 * Self-check: Model Download Manager (partial → verify → atomic rename → status).
 * Run: electron electron/model-download-manager.selfcheck.cjs
 */
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { app } = require('electron');
const paths = require('./paths.cjs');
const mdl = require('./model-download-manager.cjs');

function sha256(buf) {
    return crypto.createHash('sha256').update(buf).digest('hex');
}

app.whenReady().then(async () => {
    let server;
    const tmp = path.join(os.tmpdir(), `khepree-mdl-${Date.now()}`);
    fs.mkdirSync(tmp, { recursive: true });

    try {
        // Network env must clear offline flags even if process had them set
        process.env.HF_HUB_OFFLINE = '1';
        process.env.TRANSFORMERS_OFFLINE = '1';
        const net = paths.buildNetworkEnv();
        assert.strictEqual(net.HF_HUB_OFFLINE, undefined);
        assert.strictEqual(net.TRANSFORMERS_OFFLINE, undefined);
        assert.strictEqual(net.KHEPREE_NETWORK_CONTEXT, '1');

        // Inference env must keep offline flags when set on process (download env cleared them)
        const infer = paths.buildWorkerEnv({ HF_HUB_OFFLINE: '1' });
        assert.strictEqual(infer.HF_HUB_OFFLINE, '1');
        assert.notStrictEqual(net.HF_HUB_OFFLINE, '1');

        paths.setModelStorageDir(tmp);

        const payload = Buffer.from('khepree-model-download-selfcheck-v1\n');
        const hash = sha256(payload);

        server = http.createServer((req, res) => {
            if (req.url === '/model.bin') {
                res.writeHead(200, {
                    'Content-Type': 'application/octet-stream',
                    'Content-Length': payload.length,
                });
                res.end(payload);
                return;
            }
            res.writeHead(404);
            res.end();
        });

        await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
        const { port } = server.address();
        const url = `http://127.0.0.1:${port}/model.bin`;

        mdl.clearPackages();
        mdl.registerPackage({
            engineId: 'piper-test',
            variant: 'tiny',
            version: '1',
            files: [{
                relativePath: 'model.bin',
                url,
                sha256: hash,
                size: payload.length,
            }],
        });

        assert.strictEqual(mdl.getStatus('piper-test', 'tiny'), mdl.STATUS.NOT_INSTALLED);

        const events = [];
        mdl.setProgressSink((p) => events.push(p));

        const result = await mdl.install('piper-test', 'tiny');
        assert.strictEqual(result.status, mdl.STATUS.INSTALLED);
        assert.strictEqual(mdl.getStatus('piper-test', 'tiny'), mdl.STATUS.INSTALLED);

        const root = mdl.getInstallRoot('piper-test', 'tiny');
        const dest = path.join(root, 'model.bin');
        assert.ok(fs.existsSync(dest));
        assert.ok(!fs.existsSync(`${dest}.partial`), 'no .partial after success');
        assert.strictEqual(fs.readFileSync(dest).toString(), payload.toString());

        const v = mdl.verify('piper-test', 'tiny');
        assert.strictEqual(v.ok, true);
        assert.strictEqual(v.status, mdl.STATUS.INSTALLED);

        assert.ok(events.some((e) => e.phase === 'download' || e.phase === 'start'));
        assert.ok(events.some((e) => e.status === mdl.STATUS.INSTALLED && e.phase === 'done'));

        // Corrupt file → BROKEN
        fs.writeFileSync(dest, 'corrupt');
        assert.strictEqual(mdl.getStatus('piper-test', 'tiny'), mdl.STATUS.BROKEN);

        // Incomplete: INSTALLING manifest without files must not read as INSTALLED
        fs.writeFileSync(dest, payload);
        // simulate crashed install marker
        const manPath = path.join(root, mdl.MANIFEST_NAME);
        const man = JSON.parse(fs.readFileSync(manPath, 'utf8'));
        man.status = mdl.STATUS.INSTALLING;
        fs.writeFileSync(manPath, JSON.stringify(man));
        assert.notStrictEqual(mdl.getStatus('piper-test', 'tiny'), mdl.STATUS.INSTALLED);

        mdl.uninstall('piper-test', 'tiny');
        assert.strictEqual(mdl.getStatus('piper-test', 'tiny'), mdl.STATUS.NOT_INSTALLED);
        assert.ok(!fs.existsSync(root));

        // No package → install fails (no arbitrary internet)
        await assert.rejects(
            () => mdl.install('unknown-engine', 'default'),
            (e) => e.code === 'NO_PACKAGE'
        );

        // Refuse file:// / non-http
        assert.throws(() => mdl.registerPackage({
            engineId: 'x',
            files: [{ relativePath: 'a.bin', url: 'file:///C:/x.bin' }],
        }));

        console.log('model-download-manager.selfcheck: ok');
        paths.setModelStorageDir('');
        mdl.clearPackages();
        mdl.setProgressSink(null);
        server.close();
        fs.rmSync(tmp, { recursive: true, force: true });
        app.quit();
    } catch (e) {
        console.error('model-download-manager.selfcheck FAILED:', e);
        try { server?.close(); } catch (_) { /* */ }
        try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* */ }
        app.exit(1);
    }
});
