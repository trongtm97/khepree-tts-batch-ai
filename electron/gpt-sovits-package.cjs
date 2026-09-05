/**
 * GPT-SoVITS Voice Lab — inference-only isolated runtime (RVC-Boss/GPT-SoVITS).
 * Docs: docs/engines/gpt-sovits.md
 * No Gradio WebUI. No training. No Conda for end-user.
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const mdl = require('./model-download-manager.cjs');
const paths = require('./paths.cjs');
const rt = require('./engine-runtime-manager.cjs');

const ENGINE_ID = 'gpt-sovits';
const RUNTIME_ID = 'gpt-sovits';
const VARIANT = 'infer';
const UPSTREAM_GIT = 'https://github.com/RVC-Boss/GPT-SoVITS.git';
const RUNTIME_MARKER = '.khepree-gpt-sovits-runtime.json';
const LANGS_PATH = path.join(__dirname, 'data', 'gpt-sovits-languages.json');
const PROFILES_NAME = 'gpt-sovits-voice-profiles.json';

const REF_AUDIO_EXTS = Object.freeze(['.wav', '.mp3', '.flac', '.ogg', '.m4a']);
const CKPT_EXTS = Object.freeze(['.ckpt', '.pth', '.pt', '.safetensors']);

const VOICE_PROFILE_ACK =
    'Tôi có quyền sử dụng giọng/reference audio này.';

const VI_WARN =
    'GPT-SoVITS checkpoint/upstream hiện tại không quảng cáo tiếng Việt chính thức. Khepree khuyên dùng VieNeu cho Instant Vietnamese clone.';

function loadLanguages() {
    return JSON.parse(fs.readFileSync(LANGS_PATH, 'utf8'));
}

function listLanguages({ includeUnsupportedVi = true } = {}) {
    const official = loadLanguages();
    if (!includeUnsupportedVi) return official;
    return [
        ...official,
        {
            id: 'vi',
            label: 'Vietnamese (Unsupported — thử nghiệm)',
            unsupported: true,
        },
    ];
}

function vietnameseWarningFor(lang, text = '') {
    const l = String(lang || '').toLowerCase();
    if (l === 'vi' || l === 'vietnamese') return VI_WARN;
    if (/[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/i.test(String(text || ''))) {
        return VI_WARN;
    }
    return null;
}

function validateLocalRefAudio(filePath, { required = false } = {}) {
    if (filePath == null || !String(filePath).trim()) {
        if (required) return { ok: false, error: 'GPT-SoVITS cần reference audio local.' };
        return { ok: true, path: null };
    }
    const raw = String(filePath).trim();
    if (/^https?:\/\//i.test(raw) || /^ftp:\/\//i.test(raw)) {
        return { ok: false, error: 'Reference audio chỉ chấp nhận file local.' };
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

function validateCheckpoint(filePath, label) {
    if (filePath == null || !String(filePath).trim()) {
        return { ok: false, error: `Thiếu ${label}.` };
    }
    const raw = String(filePath).trim();
    if (/^https?:\/\//i.test(raw)) {
        return { ok: false, error: `${label} chỉ chấp nhận file local.` };
    }
    const resolved = path.resolve(raw);
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
        return { ok: false, error: `${label} không tồn tại: ${resolved}` };
    }
    const ext = path.extname(resolved).toLowerCase();
    if (!CKPT_EXTS.includes(ext)) {
        return {
            ok: false,
            error: `${label}: định dạng lạ (${ext}). Kỳ vọng: ${CKPT_EXTS.join(', ')}`,
        };
    }
    return { ok: true, path: resolved };
}

function profilesPath() {
    return path.join(paths.getEngineModelDir(ENGINE_ID), PROFILES_NAME);
}

function listVoiceProfiles() {
    const p = profilesPath();
    if (!fs.existsSync(p)) return [];
    try {
        const data = JSON.parse(fs.readFileSync(p, 'utf8'));
        return Array.isArray(data.profiles) ? data.profiles : [];
    } catch (_) {
        return [];
    }
}

function saveVoiceProfiles(profiles) {
    const p = profilesPath();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify({
        version: 1,
        profiles,
        updatedAt: new Date().toISOString(),
    }, null, 2), 'utf8');
}

/**
 * Create voice profile — requires explicit acknowledgement text checkbox.
 * No training. Inference reference only.
 */
function createVoiceProfile(input = {}) {
    const name = String(input.name || '').trim();
    if (!name) return { ok: false, error: 'Thiếu tên voice profile.' };
    if (!input.acknowledgement) {
        return {
            ok: false,
            error: `Cần xác nhận: "${VOICE_PROFILE_ACK}"`,
        };
    }
    const refCheck = validateLocalRefAudio(input.refAudio || input.ref_audio, { required: true });
    if (!refCheck.ok) return refCheck;
    const gpt = validateCheckpoint(input.gptCheckpoint || input.gpt_weights, 'GPT checkpoint');
    if (!gpt.ok) return gpt;
    const sovits = validateCheckpoint(input.sovitsCheckpoint || input.sovits_weights, 'SoVITS checkpoint');
    if (!sovits.ok) return sovits;

    const profile = {
        id: `gptsovits-${Date.now().toString(36)}`,
        name,
        refAudio: refCheck.path,
        refText: String(input.refText || input.prompt_text || '').trim(),
        refLang: String(input.refLang || input.prompt_lang || 'zh').trim().toLowerCase() || 'zh',
        targetLang: String(input.targetLang || input.text_lang || 'zh').trim().toLowerCase() || 'zh',
        gptCheckpoint: gpt.path,
        sovitsCheckpoint: sovits.path,
        acknowledgement: true,
        acknowledgementText: VOICE_PROFILE_ACK,
        createdAt: new Date().toISOString(),
    };
    const profiles = listVoiceProfiles();
    profiles.push(profile);
    saveVoiceProfiles(profiles);
    return { ok: true, profile };
}

function deleteVoiceProfile(id) {
    const profiles = listVoiceProfiles().filter((p) => p.id !== id);
    saveVoiceProfiles(profiles);
    return { ok: true };
}

function registerGptSovitsPackages() {
    rt.registerRuntime({
        id: RUNTIME_ID,
        strategy: rt.STRATEGY.ISOLATED_PYTHON,
        label: 'GPT-SoVITS Voice Lab (inference)',
    });
    rt.bindEngine(ENGINE_ID, RUNTIME_ID);
    rt.bindEngine('gptsovits', RUNTIME_ID);

    mdl.registerPackage({
        engineId: ENGINE_ID,
        variant: VARIANT,
        version: 'gpt-sovits-infer-runtime',
        // Sentinel — runtime marker proves optional install; checkpoints are user-provided
        files: [{ relativePath: '.khepree-gpt-sovits-infer.json', url: 'https://example.invalid/sentinel' }],
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
    const hasUpstream = fs.existsSync(path.join(up, 'GPT_SoVITS'))
        || fs.existsSync(path.join(up, 'GPT_SoVITS', 'TTS_infer_pack'));
    const hasTorch = [...(fs.existsSync(site) ? fs.readdirSync(site) : [])].some((n) =>
        /^torch(-|\.|$)/i.test(n) || n === 'torch');
    return hasUpstream && (hasTorch || fs.existsSync(path.join(site, 'transformers')));
}

function isModelInstalled() {
    return isRuntimeInstalled() && mdl.getStatus(ENGINE_ID, VARIANT) === mdl.STATUS.INSTALLED;
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
    const req = path.join(paths.getAppRoot(), 'python', 'requirements-gpt-sovits.txt');
    return runCmd(pythonCmd, [
        ...pythonArgs,
        '-m', 'pip', 'install',
        '--upgrade',
        '--target', site,
        '-r', req,
    ], { label: 'pip install gpt-sovits deps', timeoutMs: 900000 });
}

function gitCloneUpstream(dest) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (fs.existsSync(path.join(dest, 'GPT_SoVITS'))) return Promise.resolve({ ok: true });
    if (fs.existsSync(dest)) {
        try { fs.rmSync(dest, { recursive: true, force: true }); } catch (_) { /* */ }
    }
    return runCmd('git', [
        'clone', '--depth', '1', '--single-branch',
        UPSTREAM_GIT, dest,
    ], { label: 'git clone GPT-SoVITS', timeoutMs: 600000 });
}

function writeInstalledManifest() {
    const pkg = mdl.getPackage(ENGINE_ID, VARIANT);
    const root = mdl.getInstallRoot(ENGINE_ID, VARIANT);
    fs.mkdirSync(root, { recursive: true });
    const manPath = path.join(root, mdl.MANIFEST_NAME);
    const sentinel = path.join(root, '.khepree-gpt-sovits-infer.json');
    fs.writeFileSync(sentinel, JSON.stringify({
        inferenceOnly: true,
        noGradio: true,
        noTraining: true,
        installedAt: new Date().toISOString(),
    }, null, 2), 'utf8');
    fs.writeFileSync(manPath, JSON.stringify({
        engineId: ENGINE_ID,
        variant: VARIANT,
        version: pkg?.version || 'gpt-sovits-infer-runtime',
        status: mdl.STATUS.INSTALLED,
        files: [{ relativePath: '.khepree-gpt-sovits-infer.json' }],
        installedAt: new Date().toISOString(),
        note: 'Checkpoints (GPT/SoVITS) are user-provided — not bundled.',
    }, null, 2), 'utf8');
}

async function installRuntime(opts = {}) {
    rt.registerRuntime({
        id: RUNTIME_ID,
        strategy: rt.STRATEGY.ISOLATED_PYTHON,
        label: 'GPT-SoVITS Voice Lab (inference)',
    });
    rt.bindEngine(ENGINE_ID, RUNTIME_ID);

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
                fs.mkdirSync(path.join(up, 'GPT_SoVITS', 'TTS_infer_pack'), { recursive: true });
                fs.mkdirSync(path.join(up, 'GPT_SoVITS', 'configs'), { recursive: true });
                fs.mkdirSync(path.join(site, 'transformers'), { recursive: true });
            }

            fs.writeFileSync(path.join(root, RUNTIME_MARKER), JSON.stringify({
                package: 'RVC-Boss/GPT-SoVITS',
                sitePackages: 'site-packages',
                upstream: 'upstream',
                installedAt: new Date().toISOString(),
                note: 'inference only — no Gradio, no Conda, no training',
            }, null, 2), 'utf8');
        }),
    });
}

function uninstallRuntime() {
    return rt.uninstall(ENGINE_ID);
}

async function installOptional() {
    const runtime = await installRuntime({
        skipPip: process.env.KHEPREE_GPT_SOVITS_SKIP_PIP === '1',
    });
    writeInstalledManifest();
    return {
        ok: true,
        runtime,
        model: { ok: true, status: mdl.STATUS.INSTALLED, installRoot: mdl.getInstallRoot(ENGINE_ID, VARIANT) },
        variant: VARIANT,
        note: 'Chọn GPT + SoVITS checkpoint local để infer. Không training.',
    };
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
    VOICE_PROFILE_ACK,
    VI_WARN,
    LANGS_PATH,
    registerGptSovitsPackages,
    listLanguages,
    vietnameseWarningFor,
    validateLocalRefAudio,
    validateCheckpoint,
    listVoiceProfiles,
    createVoiceProfile,
    deleteVoiceProfile,
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
