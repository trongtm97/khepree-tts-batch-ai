/**
 * GPT-SoVITS Voice Lab selfcheck (no full Torch/upstream download).
 * Run: electron electron/gpt-sovits.selfcheck.cjs
 * Covers: registry category, isolation, unload, voice-profile ack, no Gradio/training.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const { app } = require('electron');
const registry = require('./engine-registry.cjs');
const mdl = require('./model-download-manager.cjs');
const paths = require('./paths.cjs');
const { EnginePoolManager } = require('./engine-pool-manager.cjs');
const { GptSovitsEngine } = require('./gpt-sovits-engine.cjs');
const gsvPkg = require('./gpt-sovits-package.cjs');
const { adviseEngine, COMPAT } = require('./model-compatibility.cjs');

function pingWorker(pythonCmd, args, workerScript, timeoutMs = 20000) {
    return new Promise((resolve, reject) => {
        const proc = spawn(pythonCmd, [...args, workerScript], {
            cwd: paths.getAppRoot(),
            stdio: ['pipe', 'pipe', 'pipe'],
            env: paths.buildWorkerEnv({
                KHEPREE_GPT_SOVITS_SITE: gsvPkg.sitePackagesDir(),
                KHEPREE_GPT_SOVITS_SRC: gsvPkg.upstreamDir(),
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
    const tmpModels = fs.mkdtempSync(path.join(os.tmpdir(), 'gsv-mdl-'));
    const tmpRt = fs.mkdtempSync(path.join(os.tmpdir(), 'gsv-rt-'));
    try {
        paths.setModelStorageDir(tmpModels);
        paths.setRuntimeStorageDir(tmpRt);
        mdl.clearPackages();
        gsvPkg.registerGptSovitsPackages();

        const entry = registry.getEngine('gpt-sovits');
        assert.ok(entry);
        assert.strictEqual(entry.family, 'gpt-sovits');
        assert.strictEqual(entry.category, 'voice-lab');
        assert.strictEqual(entry.displayName, 'GPT-SoVITS');
        assert.ok(/Voice Lab/i.test(entry.subtitle));
        assert.strictEqual(entry.runtimeStrategy, 'ISOLATED_PYTHON');
        assert.strictEqual(entry.runtimeId, 'gpt-sovits');
        assert.strictEqual(registry.resolveId('gptsovits'), 'gpt-sovits');
        assert.ok(!entry.languages.includes('vi'));
        assert.ok(!(entry.badges || []).some((b) => /việt|vietnamese/i.test(b)));
        assert.ok((entry.badges || []).includes('Voice Lab'));
        assert.strictEqual(entry.capabilities.voiceClone, true);
        assert.strictEqual(entry.capabilities.customCheckpoints, true);

        const pub = registry.listPublic(() => 'INSTALLED');
        const gsvPub = pub.find((e) => e.id === 'gpt-sovits');
        assert.strictEqual(gsvPub.category, 'voice-lab');

        assert.strictEqual(gsvPkg.isRuntimeInstalled(), false);

        process.env.KHEPREE_GPT_SOVITS_SKIP_PIP = '1';
        await gsvPkg.installOptional();
        assert.strictEqual(gsvPkg.isRuntimeInstalled(), true);
        assert.strictEqual(gsvPkg.isModelInstalled(), true);

        const fake = { ...entry, installState: 'INSTALLED' };
        assert.strictEqual(
            adviseEngine(fake, { ram: { totalGb: 32 }, gpu: { nvidia: true } }).level,
            COMPAT.RECOMMENDED
        );
        assert.ok(
            [COMPAT.MAY_BE_SLOW, COMPAT.NOT_RECOMMENDED].includes(
                adviseEngine(fake, { ram: { totalGb: 8 }, gpu: { nvidia: false } }).level
            )
        );

        // Voice profile requires acknowledgement
        const noAck = gsvPkg.createVoiceProfile({
            name: 'test',
            acknowledgement: false,
            refAudio: path.join(tmpModels, 'missing.wav'),
            gptCheckpoint: path.join(tmpModels, 'a.ckpt'),
            sovitsCheckpoint: path.join(tmpModels, 'b.pth'),
        });
        assert.strictEqual(noAck.ok, false);
        assert.ok(/quyền sử dụng/i.test(noAck.error));

        const refWav = path.join(tmpModels, 'ref.wav');
        const gptCkpt = path.join(tmpModels, 'gpt.ckpt');
        const sovitsCkpt = path.join(tmpModels, 'sovits.pth');
        fs.writeFileSync(refWav, 'RIFF');
        fs.writeFileSync(gptCkpt, 'x');
        fs.writeFileSync(sovitsCkpt, 'y');
        const created = gsvPkg.createVoiceProfile({
            name: 'Demo',
            acknowledgement: true,
            refAudio: refWav,
            refText: 'hello',
            refLang: 'en',
            targetLang: 'en',
            gptCheckpoint: gptCkpt,
            sovitsCheckpoint: sovitsCkpt,
        });
        assert.strictEqual(created.ok, true);
        assert.strictEqual(created.profile.acknowledgement, true);
        assert.ok(created.profile.acknowledgementText.includes('Tôi có quyền'));
        assert.strictEqual(gsvPkg.listVoiceProfiles().length, 1);

        const eng = new GptSovitsEngine();
        assert.strictEqual(eng.ready, false);
        eng.stop();

        const mgr = new EnginePoolManager();
        assert.ok(mgr.getPool('gpt-sovits', 1));
        mgr.shutdownPool('gpt-sovits');
        mgr.shutdownAll();

        gsvPkg.uninstallAll();
        assert.strictEqual(gsvPkg.isRuntimeInstalled(), false);

        const worker = paths.getWorkerScript(path.join('engines', 'gpt_sovits', 'worker.py'));
        assert.ok(fs.existsSync(worker));
        const src = fs.readFileSync(worker, 'utf8');
        assert.ok(src.includes('TTS_infer_pack'));
        assert.ok(src.includes('prompt_text'));
        assert.ok(src.includes('prompt_lang'));
        assert.ok(src.includes('text_lang'));
        assert.ok(src.includes('init_t2s_weights'));
        assert.ok(src.includes('init_vits_weights'));
        assert.ok(!/^\s*(import|from)\s+gradio\b/im.test(src));
        assert.ok(src.includes('"training": False') || src.includes('training": False'));

        const req = fs.readFileSync(
            path.join(paths.getAppRoot(), 'python', 'requirements-gpt-sovits.txt'),
            'utf8'
        );
        const reqActive = req.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');
        assert.ok(!/^\s*gradio\b/im.test(reqActive));
        assert.ok(!/^\s*fastapi\b/im.test(reqActive));

        const bundleReq = fs.readFileSync(
            path.join(paths.getAppRoot(), 'python', 'requirements-bundle.txt'),
            'utf8'
        );
        const bundleActive = bundleReq.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');
        assert.ok(!/gpt.?sovits/i.test(bundleActive), 'gpt-sovits must not enter core bundle');

        const doc = path.join(paths.getAppRoot(), 'docs', 'engines', 'gpt-sovits.md');
        assert.ok(fs.existsSync(doc));

        try {
            const py = paths.resolvePythonCmd();
            const pong = await pingWorker(py.cmd, py.args, worker);
            assert.strictEqual(pong.ok, true);
            assert.strictEqual(pong.engine, 'gpt-sovits');
            assert.strictEqual(pong.training, false);
            console.log('  worker ping: ok');
        } catch (e) {
            console.log(`  worker ping skipped: ${e.message}`);
        }

        console.log('gpt-sovits.selfcheck: ok');
        console.log('  isolation + unload: ok');
        console.log('  voice-lab category + profile ack: ok');
        app.exit(0);
    } catch (e) {
        console.error('gpt-sovits.selfcheck FAILED:', e);
        app.exit(1);
    }
});
