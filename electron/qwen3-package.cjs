/**
 * Qwen3-TTS 0.6B optional runtime + CustomVoice/Base model packages.
 * Docs: docs/engines/qwen3.md
 * Official: https://github.com/QwenLM/Qwen3-TTS (0.6B only — no 1.7B VoiceDesign)
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const mdl = require('./model-download-manager.cjs');
const paths = require('./paths.cjs');
const rt = require('./engine-runtime-manager.cjs');

const ENGINE_ID = 'qwen3';
const RUNTIME_ID = 'qwen3';
const PKG = 'qwen-tts';
const RUNTIME_MARKER = '.khepree-qwen3-runtime.json';

const HF_CUSTOM = 'https://huggingface.co/Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice/resolve/main';
const HF_BASE = 'https://huggingface.co/Qwen/Qwen3-TTS-12Hz-0.6B-Base/resolve/main';

const LANGS_PATH = path.join(__dirname, 'data', 'qwen3-languages.json');
const SPEAKERS_PATH = path.join(__dirname, 'data', 'qwen3-speakers.json');

const REF_AUDIO_EXTS = Object.freeze(['.wav', '.mp3', '.flac', '.ogg', '.m4a']);

/** Official 0.6B checkpoints only (no 1.7B / VoiceDesign). */
const MODEL_FILES = Object.freeze([
    'config.json',
    'generation_config.json',
    'merges.txt',
    'model.safetensors',
    'preprocessor_config.json',
    'tokenizer_config.json',
    'vocab.json',
    'speech_tokenizer/config.json',
    'speech_tokenizer/configuration.json',
    'speech_tokenizer/model.safetensors',
    'speech_tokenizer/preprocessor_config.json',
]);

const VARIANT_META = Object.freeze({
    '0.6b-custom': Object.freeze({
        id: '0.6b-custom',
        label: '0.6B CustomVoice (preset speakers)',
        hfId: 'Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice',
        hfBase: HF_CUSTOM,
        mode: 'custom',
        voiceClone: false,
        presetSpeakers: true,
    }),
    '0.6b-base': Object.freeze({
        id: '0.6b-base',
        label: '0.6B Base (voice clone)',
        hfId: 'Qwen/Qwen3-TTS-12Hz-0.6B-Base',
        hfBase: HF_BASE,
        mode: 'base',
        voiceClone: true,
        presetSpeakers: false,
    }),
});

const VI_WARN =
    'Model này không hỗ trợ tiếng Việt chính thức. Khepree khuyên dùng VieNeu hoặc Supertonic.';

function loadLanguages() {
    return JSON.parse(fs.readFileSync(LANGS_PATH, 'utf8'));
}

function loadSpeakers() {
    return JSON.parse(fs.readFileSync(SPEAKERS_PATH, 'utf8'));
}

/** Official languages + optional unsupported Vietnamese override. */
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

function listSpeakers() {
    return loadSpeakers();
}

function listVariants() {
    return Object.values(VARIANT_META).map((v) => ({
        id: v.id,
        label: v.label,
        mode: v.mode,
        voiceClone: v.voiceClone,
        presetSpeakers: v.presetSpeakers,
    }));
}

function variantMeta(id) {
    return VARIANT_META[id] || VARIANT_META['0.6b-custom'];
}

function filesFor(variant) {
    const meta = variantMeta(variant);
    return MODEL_FILES.map((name) => ({
        relativePath: name,
        url: `${meta.hfBase}/${name}`,
    }));
}

function isOfficialLanguage(lang) {
    const id = String(lang || '').trim();
    if (!id || id === 'Auto') return true;
    return loadLanguages().some((l) => l.id === id);
}

function vietnameseWarningFor(lang, text = '') {
    const id = String(lang || '').trim();
    if (id === 'Vietnamese') return VI_WARN;
    // Heuristic: Vietnamese diacritics in user text
    if (/[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/i.test(String(text || ''))) {
        return VI_WARN;
    }
    return null;
}

function validateLocalRefAudio(filePath, { required = false } = {}) {
    if (filePath == null || !String(filePath).trim()) {
        if (required) return { ok: false, error: 'Base variant cần reference audio local (clone).' };
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

function registerQwen3Packages() {
    rt.registerRuntime({
        id: RUNTIME_ID,
        strategy: rt.STRATEGY.ISOLATED_PYTHON,
        label: 'Qwen3-TTS 0.6B (optional PyTorch)',
    });
    rt.bindEngine(ENGINE_ID, RUNTIME_ID);

    for (const id of Object.keys(VARIANT_META)) {
        mdl.registerPackage({
            engineId: ENGINE_ID,
            variant: id,
            version: `qwen3-tts-${id}`,
            files: filesFor(id),
        });
    }
}

function runtimeRoot() {
    return paths.getRuntimeDir(RUNTIME_ID);
}

function sitePackagesDir() {
    return path.join(runtimeRoot(), 'site-packages');
}

function runtimeMarkerPath() {
    return path.join(runtimeRoot(), RUNTIME_MARKER);
}

function isRuntimeInstalled() {
    if (!fs.existsSync(runtimeMarkerPath())) return false;
    const site = sitePackagesDir();
    return fs.existsSync(path.join(site, 'qwen_tts'))
        || [...(fs.existsSync(site) ? fs.readdirSync(site) : [])].some((n) =>
            /^qwen_tts.*\.dist-info$/i.test(n) || /^qwen.?tts.*\.dist-info$/i.test(n));
}

function isModelInstalled(variant = '0.6b-custom') {
    return mdl.getStatus(ENGINE_ID, variant) === mdl.STATUS.INSTALLED;
}

function pipInstallTarget(site, pythonCmd, pythonArgs, timeoutMs = 900000) {
    return new Promise((resolve, reject) => {
        const req = path.join(paths.getAppRoot(), 'python', 'requirements-qwen3.txt');
        const args = [
            ...pythonArgs,
            '-m', 'pip', 'install',
            '--upgrade',
            '--target', site,
            '-r', req,
        ];
        const env = paths.buildNetworkEnv();
        const proc = spawn(pythonCmd, args, {
            cwd: paths.getAppRoot(),
            env,
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stderr = '';
        const timer = setTimeout(() => {
            try { proc.kill(); } catch (_) { /* */ }
            reject(new Error(`pip install qwen-tts timeout: ${stderr.slice(0, 400)}`));
        }, timeoutMs);
        proc.stderr.setEncoding('utf8');
        proc.stderr.on('data', (c) => { stderr += c; });
        proc.on('error', (e) => {
            clearTimeout(timer);
            reject(e);
        });
        proc.on('exit', (code) => {
            clearTimeout(timer);
            if (code === 0) resolve({ ok: true });
            else reject(new Error(`pip install qwen-tts failed (${code}): ${stderr.slice(0, 500)}`));
        });
    });
}

async function installRuntime(opts = {}) {
    rt.registerRuntime({
        id: RUNTIME_ID,
        strategy: rt.STRATEGY.ISOLATED_PYTHON,
        label: 'Qwen3-TTS 0.6B (optional PyTorch)',
    });
    rt.bindEngine(ENGINE_ID, RUNTIME_ID);

    return rt.install(ENGINE_ID, {
        provision: opts.provision || (async ({ root, pythonPath }) => {
            const site = path.join(root, 'site-packages');
            fs.mkdirSync(site, { recursive: true });
            fs.mkdirSync(path.dirname(pythonPath), { recursive: true });
            if (!fs.existsSync(pythonPath)) {
                fs.writeFileSync(pythonPath, '');
            }
            if (!opts.skipPip) {
                const py = paths.resolvePythonCmd();
                await pipInstallTarget(site, py.cmd, py.args);
            } else {
                fs.mkdirSync(path.join(site, 'qwen_tts'), { recursive: true });
            }
            fs.writeFileSync(path.join(root, RUNTIME_MARKER), JSON.stringify({
                package: PKG,
                sitePackages: 'site-packages',
                installedAt: new Date().toISOString(),
                note: 'Qwen3-TTS 0.6B only — CustomVoice + Base; not VoiceDesign 1.7B',
            }, null, 2), 'utf8');
        }),
    });
}

function uninstallRuntime() {
    return rt.uninstall(ENGINE_ID);
}

async function installOptional(variant = '0.6b-custom') {
    const v = VARIANT_META[variant] ? variant : '0.6b-custom';
    const runtime = await installRuntime();
    const model = await mdl.install(ENGINE_ID, v);
    return { ok: true, runtime, model, variant: v };
}

function uninstallAll() {
    for (const v of Object.keys(VARIANT_META)) {
        try {
            if (mdl.getStatus(ENGINE_ID, v) !== mdl.STATUS.NOT_INSTALLED) {
                mdl.uninstall(ENGINE_ID, v);
            }
        } catch (_) { /* */ }
    }
    return uninstallRuntime();
}

module.exports = {
    ENGINE_ID,
    RUNTIME_ID,
    MODEL_FILES,
    VARIANT_META,
    VI_WARN,
    LANGS_PATH,
    SPEAKERS_PATH,
    registerQwen3Packages,
    listLanguages,
    listSpeakers,
    listVariants,
    variantMeta,
    filesFor,
    isOfficialLanguage,
    vietnameseWarningFor,
    validateLocalRefAudio,
    isRuntimeInstalled,
    isModelInstalled,
    installRuntime,
    uninstallRuntime,
    installOptional,
    uninstallAll,
    sitePackagesDir,
    runtimeRoot,
};
