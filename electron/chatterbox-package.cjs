/**
 * Chatterbox optional runtime + Nano/Turbo model packages (shared isolated runtime).
 * Docs: docs/engines/chatterbox-nano.md
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const mdl = require('./model-download-manager.cjs');
const paths = require('./paths.cjs');
const rt = require('./engine-runtime-manager.cjs');

const HF_NANO = 'https://huggingface.co/ResembleAI/chatterbox-nano/resolve/main';
const HF_TURBO = 'https://huggingface.co/ResembleAI/chatterbox-turbo/resolve/main';
const TAGS_PATH = path.join(__dirname, 'data', 'chatterbox-nano-tags.json');
const RUNTIME_ID = 'chatterbox';
/** Canonical registry / package engine id (family card). */
const ENGINE_ID = 'chatterbox';
const PKG = 'chatterbox-tts';
const RUNTIME_MARKER = '.khepree-chatterbox-runtime.json';

const REF_AUDIO_EXTS = Object.freeze(['.wav', '.mp3', '.flac', '.ogg', '.m4a']);

/** Official Gradio EVENT_TAGS — subset of added_tokens (same for Nano/Turbo). */
const EVENT_TAGS = Object.freeze([
    '[clear throat]',
    '[sigh]',
    '[shush]',
    '[cough]',
    '[groan]',
    '[sniff]',
    '[gasp]',
    '[chuckle]',
    '[laugh]',
]);

const NANO_FILES = Object.freeze([
    've.safetensors',
    't3_nano_v1.safetensors',
    's3gen_meanflow.safetensors',
    'conds.pt',
    'added_tokens.json',
    'merges.txt',
    'vocab.json',
    'tokenizer_config.json',
    'special_tokens_map.json',
]);

const TURBO_FILES = Object.freeze([
    've.safetensors',
    't3_turbo_v1.safetensors',
    's3gen_meanflow.safetensors',
    'conds.pt',
    'added_tokens.json',
    'merges.txt',
    'vocab.json',
    'tokenizer_config.json',
    'special_tokens_map.json',
]);

const VARIANT_META = Object.freeze({
    nano: Object.freeze({
        id: 'nano',
        label: 'Nano (110M · CPU-friendly)',
        subtitle: 'English biểu cảm · CPU-friendly',
        strengths: Object.freeze([
            'English.',
            'Nhẹ hơn các Chatterbox lớn.',
            'Hướng tới on-device/CPU.',
            'Có khả năng biểu cảm theo upstream.',
            'Phù hợp dialogue và narration.',
        ]),
        weaknesses: Object.freeze([
            'English.',
            'Không phù hợp Vietnamese.',
            'Runtime PyTorch vẫn nặng hơn ONNX engines.',
            'Model nhỏ có giới hạn so với Turbo.',
        ]),
        bestFor: Object.freeze([
            'English.',
            'Máy không GPU mạnh.',
            'Dialogue.',
            'Nội dung cần biểu cảm.',
        ]),
        avoidWhen: Object.freeze([
            'Vietnamese → VieNeu/Supertonic.',
            'English thuần tốc độ → Kokoro/Kitten.',
            'Clone English mạnh → Turbo.',
        ]),
    }),
    turbo: Object.freeze({
        id: 'turbo',
        label: 'Turbo (350M · clone + biểu cảm)',
        subtitle: 'English clone voice · Biểu cảm mạnh',
        strengths: Object.freeze([
            'Voice cloning English.',
            'Biểu cảm.',
            'Paralinguistic tags theo upstream.',
            'Phù hợp character/dialogue/narration sáng tạo.',
        ]),
        weaknesses: Object.freeze([
            'Nặng hơn Nano.',
            'GPU giúp trải nghiệm tốt hơn.',
            'Không Vietnamese official.',
            'Runtime lớn hơn ONNX models.',
        ]),
        bestFor: Object.freeze([
            'Clone English.',
            'Character voice.',
            'Dialogue.',
            'PC có GPU phù hợp.',
        ]),
        avoidWhen: Object.freeze([
            'Vietnamese → VieNeu.',
            'CPU nhẹ → Nano/Kokoro/Kitten.',
        ]),
    }),
});

function loadOfficialTags() {
    const raw = JSON.parse(fs.readFileSync(TAGS_PATH, 'utf8'));
    return Object.keys(raw)
        .filter((k) => k.startsWith('[') && k.endsWith(']'))
        .sort();
}

function listExpressionTags() {
    const all = loadOfficialTags();
    return {
        source: 'ResembleAI/chatterbox-nano|turbo added_tokens.json (identical)',
        eventTags: EVENT_TAGS.filter((t) => all.includes(t)),
        allTags: all,
    };
}

function listVariants() {
    return Object.values(VARIANT_META).map((v) => ({ id: v.id, label: v.label, subtitle: v.subtitle }));
}

function variantMeta(id) {
    return VARIANT_META[id] || VARIANT_META.nano;
}

function filesFor(variant) {
    if (variant === 'turbo') {
        return TURBO_FILES.map((name) => ({ relativePath: name, url: `${HF_TURBO}/${name}` }));
    }
    return NANO_FILES.map((name) => ({ relativePath: name, url: `${HF_NANO}/${name}` }));
}

function registerChatterboxPackages() {
    rt.registerRuntime({
        id: RUNTIME_ID,
        strategy: rt.STRATEGY.ISOLATED_PYTHON,
        label: 'Chatterbox (optional PyTorch)',
    });
    rt.bindEngine(ENGINE_ID, RUNTIME_ID);
    rt.bindEngine('chatterbox-nano', RUNTIME_ID);
    rt.bindEngine('chatterbox-turbo', RUNTIME_ID);

    mdl.registerPackage({
        engineId: ENGINE_ID,
        variant: 'nano',
        version: 'chatterbox-nano-hf',
        files: filesFor('nano'),
    });
    mdl.registerPackage({
        engineId: ENGINE_ID,
        variant: 'turbo',
        version: 'chatterbox-turbo-hf',
        files: filesFor('turbo'),
    });
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
    return fs.existsSync(path.join(site, 'chatterbox'))
        || fs.existsSync(path.join(site, 'chatterbox_tts'))
        || [...(fs.existsSync(site) ? fs.readdirSync(site) : [])].some((n) =>
            /^chatterbox.*\.dist-info$/i.test(n));
}

function isModelInstalled(variant = 'nano') {
    return mdl.getStatus(ENGINE_ID, variant) === mdl.STATUS.INSTALLED;
}

/**
 * Reference audio: local file only — no http(s) upload/URL.
 * @returns {{ ok: boolean, path?: string|null, error?: string }}
 */
function validateLocalRefAudio(filePath) {
    if (filePath == null || !String(filePath).trim()) {
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

function pipInstallTarget(site, pythonCmd, pythonArgs, timeoutMs = 900000) {
    return new Promise((resolve, reject) => {
        const req = path.join(paths.getAppRoot(), 'python', 'requirements-chatterbox.txt');
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
            reject(new Error(`pip install chatterbox timeout: ${stderr.slice(0, 400)}`));
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
            else reject(new Error(`pip install chatterbox failed (${code}): ${stderr.slice(0, 500)}`));
        });
    });
}

async function installRuntime(opts = {}) {
    rt.registerRuntime({
        id: RUNTIME_ID,
        strategy: rt.STRATEGY.ISOLATED_PYTHON,
        label: 'Chatterbox (optional PyTorch)',
    });
    rt.bindEngine(ENGINE_ID, RUNTIME_ID);
    rt.bindEngine('chatterbox-nano', RUNTIME_ID);
    rt.bindEngine('chatterbox-turbo', RUNTIME_ID);

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
                fs.mkdirSync(path.join(site, 'chatterbox'), { recursive: true });
            }
            fs.writeFileSync(path.join(root, RUNTIME_MARKER), JSON.stringify({
                package: PKG,
                sitePackages: 'site-packages',
                installedAt: new Date().toISOString(),
                note: 'Shared by Chatterbox Nano and Turbo — one isolated runtime',
            }, null, 2), 'utf8');
        }),
    });
}

function uninstallRuntime() {
    return rt.uninstall(ENGINE_ID);
}

/** Install shared runtime + one variant model (default nano). */
async function installOptional(variant = 'nano') {
    const v = variant === 'turbo' ? 'turbo' : 'nano';
    const runtime = await installRuntime();
    const model = await mdl.install(ENGINE_ID, v);
    return { ok: true, runtime, model, variant: v };
}

function uninstallAll() {
    for (const v of ['nano', 'turbo']) {
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
    EVENT_TAGS,
    NANO_FILES,
    TURBO_FILES,
    VARIANT_META,
    TAGS_PATH,
    registerChatterboxPackages,
    listExpressionTags,
    loadOfficialTags,
    listVariants,
    variantMeta,
    filesFor,
    isRuntimeInstalled,
    isModelInstalled,
    validateLocalRefAudio,
    installRuntime,
    uninstallRuntime,
    installOptional,
    uninstallAll,
    sitePackagesDir,
    runtimeRoot,
};
