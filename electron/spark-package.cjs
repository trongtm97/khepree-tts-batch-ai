/**
 * Spark-TTS 0.5B optional runtime + model (SparkAudio).
 * Docs: docs/engines/spark.md
 * Official: https://github.com/SparkAudio/Spark-TTS — no Gradio, no Conda for end-user.
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const mdl = require('./model-download-manager.cjs');
const paths = require('./paths.cjs');
const rt = require('./engine-runtime-manager.cjs');

const ENGINE_ID = 'spark';
const RUNTIME_ID = 'spark';
const VARIANT = '0.5b';
const HF_ID = 'SparkAudio/Spark-TTS-0.5B';
const HF_CONFIG = `https://huggingface.co/${HF_ID}/resolve/main/config.yaml`;
const UPSTREAM_GIT = 'https://github.com/SparkAudio/Spark-TTS.git';
const RUNTIME_MARKER = '.khepree-spark-runtime.json';
const LANGS_PATH = path.join(__dirname, 'data', 'spark-languages.json');

const REF_AUDIO_EXTS = Object.freeze(['.wav', '.mp3', '.flac', '.ogg', '.m4a']);
const GENDERS = Object.freeze(['male', 'female']);
const LEVELS = Object.freeze(['very_low', 'low', 'moderate', 'high', 'very_high']);

const VI_WARN =
    'Model này không hỗ trợ tiếng Việt chính thức. Khepree khuyên dùng VieNeu hoặc Supertonic.';

function loadLanguages() {
    return JSON.parse(fs.readFileSync(LANGS_PATH, 'utf8'));
}

function listLanguages({ includeUnsupportedVi = true } = {}) {
    const official = loadLanguages();
    if (!includeUnsupportedVi) return official;
    return [
        ...official,
        {
            id: 'Vietnamese',
            label: 'Vietnamese (Unsupported — thử nghiệm)',
            unsupported: true,
        },
    ];
}

function listGenders() {
    return GENDERS.map((id) => ({ id, label: id }));
}

function listLevels() {
    return LEVELS.map((id) => ({ id, label: id.replace(/_/g, ' ') }));
}

function vietnameseWarningFor(lang, text = '') {
    if (String(lang || '') === 'Vietnamese') return VI_WARN;
    if (/[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/i.test(String(text || ''))) {
        return VI_WARN;
    }
    return null;
}

function validateLocalRefAudio(filePath, { required = false } = {}) {
    if (filePath == null || !String(filePath).trim()) {
        if (required) return { ok: false, error: 'Zero-shot clone cần reference audio local.' };
        return { ok: true, path: null };
    }
    const raw = String(filePath).trim();
    if (/^https?:\/\//i.test(raw) || /^ftp:\/\//i.test(raw)) {
        return { ok: false, error: 'Reference audio chỉ chấp nhận file local — không URL/upload remote.' };
    }
    let resolved;
    try {
        resolved = path.resolve(raw);
    } catch (_) {
        return { ok: false, error: 'Đường dẫn reference không hợp lệ.' };
    }
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
        return { ok: false, error: `Reference audio không tồn tại: ${resolved}` };
    }
    const ext = path.extname(resolved).toLowerCase();
    if (!REF_AUDIO_EXTS.includes(ext)) {
        return {
            ok: false,
            error: `Định dạng không hỗ trợ (${ext || 'không có'}). Dùng: ${REF_AUDIO_EXTS.join(', ')}`,
        };
    }
    return { ok: true, path: resolved };
}

function registerSparkPackages() {
    rt.registerRuntime({
        id: RUNTIME_ID,
        strategy: rt.STRATEGY.ISOLATED_PYTHON,
        label: 'Spark-TTS 0.5B (optional PyTorch)',
    });
    rt.bindEngine(ENGINE_ID, RUNTIME_ID);
    rt.bindEngine('spark-tts', RUNTIME_ID);

    mdl.registerPackage({
        engineId: ENGINE_ID,
        variant: VARIANT,
        version: 'spark-tts-0.5b-hf',
        // Sentinel — full tree via snapshot_download in installOptional
        files: [{ relativePath: 'config.yaml', url: HF_CONFIG }],
    });
}

function runtimeRoot() {
    return paths.getRuntimeDir(RUNTIME_ID);
}

function sitePackagesDir() {
    return path.join(runtimeRoot(), 'site-packages');
}

function upstreamDir() {
    return path.join(runtimeRoot(), 'upstream');
}

function runtimeMarkerPath() {
    return path.join(runtimeRoot(), RUNTIME_MARKER);
}

function isRuntimeInstalled() {
    if (!fs.existsSync(runtimeMarkerPath())) return false;
    const site = sitePackagesDir();
    const up = upstreamDir();
    const hasSparktts = fs.existsSync(path.join(up, 'sparktts'))
        || fs.existsSync(path.join(site, 'sparktts'));
    const hasTorch = [...(fs.existsSync(site) ? fs.readdirSync(site) : [])].some((n) =>
        /^torch(-|\.|$)/i.test(n) || n === 'torch');
    return hasSparktts && (hasTorch || fs.existsSync(path.join(site, 'transformers')));
}

function isModelInstalled() {
    return mdl.getStatus(ENGINE_ID, VARIANT) === mdl.STATUS.INSTALLED;
}

function runCmd(cmd, args, opts = {}) {
    return new Promise((resolve, reject) => {
        const proc = spawn(cmd, args, {
            cwd: opts.cwd || paths.getAppRoot(),
            env: opts.env || paths.buildNetworkEnv(),
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stderr = '';
        const timer = setTimeout(() => {
            try { proc.kill(); } catch (_) { /* */ }
            reject(new Error(`${opts.label || cmd} timeout: ${stderr.slice(0, 400)}`));
        }, opts.timeoutMs || 900000);
        proc.stderr.setEncoding('utf8');
        proc.stderr.on('data', (c) => { stderr += c; });
        proc.on('error', (e) => {
            clearTimeout(timer);
            reject(e);
        });
        proc.on('exit', (code) => {
            clearTimeout(timer);
            if (code === 0) resolve({ ok: true });
            else reject(new Error(`${opts.label || cmd} failed (${code}): ${stderr.slice(0, 500)}`));
        });
    });
}

function pipInstallTarget(site, pythonCmd, pythonArgs) {
    const req = path.join(paths.getAppRoot(), 'python', 'requirements-spark.txt');
    return runCmd(pythonCmd, [
        ...pythonArgs,
        '-m', 'pip', 'install',
        '--upgrade',
        '--target', site,
        '-r', req,
    ], { label: 'pip install spark deps', timeoutMs: 900000 });
}

function gitCloneUpstream(dest) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (fs.existsSync(path.join(dest, 'sparktts'))) return Promise.resolve({ ok: true });
    if (fs.existsSync(dest)) {
        try { fs.rmSync(dest, { recursive: true, force: true }); } catch (_) { /* */ }
    }
    return runCmd('git', [
        'clone', '--depth', '1', '--single-branch',
        UPSTREAM_GIT, dest,
    ], { label: 'git clone Spark-TTS', timeoutMs: 600000 });
}

async function snapshotModel(dest, pythonCmd, pythonArgs) {
    fs.mkdirSync(dest, { recursive: true });
    const script = [
        'from huggingface_hub import snapshot_download',
        `snapshot_download(${JSON.stringify(HF_ID)}, local_dir=${JSON.stringify(dest)}, local_dir_use_symlinks=False)`,
        'print("ok")',
    ].join('; ');
    return runCmd(pythonCmd, [...pythonArgs, '-c', script], {
        label: 'snapshot Spark-TTS-0.5B',
        timeoutMs: 1800000,
        env: {
            ...paths.buildNetworkEnv(),
            PYTHONPATH: sitePackagesDir(),
        },
    });
}

function writeInstalledManifest() {
    const pkg = mdl.getPackage(ENGINE_ID, VARIANT);
    const root = mdl.getInstallRoot(ENGINE_ID, VARIANT);
    const manPath = path.join(root, mdl.MANIFEST_NAME);
    fs.writeFileSync(manPath, JSON.stringify({
        engineId: ENGINE_ID,
        variant: VARIANT,
        version: pkg?.version || 'spark-tts-0.5b-hf',
        status: mdl.STATUS.INSTALLED,
        files: pkg?.files || [{ relativePath: 'config.yaml' }],
        installedAt: new Date().toISOString(),
        hfId: HF_ID,
    }, null, 2), 'utf8');
}

async function installRuntime(opts = {}) {
    rt.registerRuntime({
        id: RUNTIME_ID,
        strategy: rt.STRATEGY.ISOLATED_PYTHON,
        label: 'Spark-TTS 0.5B (optional PyTorch)',
    });
    rt.bindEngine(ENGINE_ID, RUNTIME_ID);
    rt.bindEngine('spark-tts', RUNTIME_ID);

    return rt.install(ENGINE_ID, {
        provision: opts.provision || (async ({ root, pythonPath }) => {
            const site = path.join(root, 'site-packages');
            const up = path.join(root, 'upstream');
            fs.mkdirSync(site, { recursive: true });
            fs.mkdirSync(path.dirname(pythonPath), { recursive: true });
            if (!fs.existsSync(pythonPath)) fs.writeFileSync(pythonPath, '');

            if (!opts.skipPip) {
                const py = paths.resolvePythonCmd();
                await pipInstallTarget(site, py.cmd, py.args);
                await gitCloneUpstream(up);
            } else {
                fs.mkdirSync(path.join(up, 'sparktts'), { recursive: true });
                fs.mkdirSync(path.join(up, 'cli'), { recursive: true });
                fs.mkdirSync(path.join(site, 'transformers'), { recursive: true });
            }

            fs.writeFileSync(path.join(root, RUNTIME_MARKER), JSON.stringify({
                package: 'SparkAudio/Spark-TTS',
                sitePackages: 'site-packages',
                upstream: 'upstream',
                installedAt: new Date().toISOString(),
                note: '0.5B only — pip --target, no Conda, no Gradio',
            }, null, 2), 'utf8');
        }),
    });
}

function uninstallRuntime() {
    return rt.uninstall(ENGINE_ID);
}

async function installOptional() {
    const runtime = await installRuntime();
    const root = mdl.getInstallRoot(ENGINE_ID, VARIANT);
    if (!optsSkipSnapshot()) {
        const py = paths.resolvePythonCmd();
        await snapshotModel(root, py.cmd, py.args);
    } else {
        fs.mkdirSync(root, { recursive: true });
        fs.writeFileSync(path.join(root, 'config.yaml'), 'sample_rate: 16000\n', 'utf8');
    }
    if (!fs.existsSync(path.join(root, 'config.yaml'))) {
        throw new Error('Spark-TTS snapshot thiếu config.yaml');
    }
    writeInstalledManifest();
    return {
        ok: true,
        runtime,
        model: { ok: true, status: mdl.STATUS.INSTALLED, installRoot: root },
        variant: VARIANT,
    };
}

/** Selfcheck hook — skip heavy HF snapshot when KHEPREE_SPARK_SKIP_SNAPSHOT=1 */
function optsSkipSnapshot() {
    return process.env.KHEPREE_SPARK_SKIP_SNAPSHOT === '1';
}

function uninstallAll() {
    try {
        if (mdl.getStatus(ENGINE_ID, VARIANT) !== mdl.STATUS.NOT_INSTALLED) {
            mdl.uninstall(ENGINE_ID, VARIANT);
        }
    } catch (_) { /* */ }
    return uninstallRuntime();
}

module.exports = {
    ENGINE_ID,
    RUNTIME_ID,
    VARIANT,
    HF_ID,
    GENDERS,
    LEVELS,
    VI_WARN,
    LANGS_PATH,
    registerSparkPackages,
    listLanguages,
    listGenders,
    listLevels,
    vietnameseWarningFor,
    validateLocalRefAudio,
    isRuntimeInstalled,
    isModelInstalled,
    installRuntime,
    uninstallRuntime,
    installOptional,
    uninstallAll,
    sitePackagesDir,
    upstreamDir,
    runtimeRoot,
    writeInstalledManifest,
};
