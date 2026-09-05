/**
 * Piper optional packages — OHF-Voice piper-tts runtime + rhasspy/piper-voices.
 * See docs/engines/piper.md. Not bundled into default installer.
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const mdl = require('./model-download-manager.cjs');
const paths = require('./paths.cjs');
const rt = require('./engine-runtime-manager.cjs');

const HF = 'https://huggingface.co/rhasspy/piper-voices/resolve/main';
const CATALOG_PATH = path.join(__dirname, 'data', 'piper-voices.json');
const DEFAULT_VOICE = 'en_US-lessac-medium';
const PIPER_PKG = 'piper-tts==1.5.0';
const RUNTIME_MARKER = '.khepree-piper-runtime.json';

const LICENSE_INSTALL_WARNING =
    'Thành phần này sử dụng giấy phép riêng. Hãy xem thông tin giấy phép trước khi cài.';

let _catalog = null;

function loadCatalog() {
    if (_catalog) return _catalog;
    const raw = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
    _catalog = raw && typeof raw === 'object' ? raw : {};
    return _catalog;
}

function listCatalogVoices() {
    const cat = loadCatalog();
    return Object.keys(cat).sort().map((key) => {
        const e = cat[key];
        const lang = e?.language || {};
        return {
            id: key,
            label: `${key}${e?.quality ? ` · ${e.quality}` : ''}`,
            language: lang.code || '',
            languageFamily: lang.family || '',
            languageEnglish: lang.name_english || '',
            quality: e?.quality || '',
            numSpeakers: e?.num_speakers || 1,
        };
    });
}

function catalogKeys() {
    return Object.keys(loadCatalog()).sort();
}

function hasVoice(key) {
    return Boolean(loadCatalog()[key]);
}

function filesForVoice(key) {
    const entry = loadCatalog()[key];
    if (!entry?.files) throw new Error(`Unknown Piper voice: ${key}`);
    const out = [];
    for (const rel of Object.keys(entry.files)) {
        const base = path.posix.basename(rel.replace(/\\/g, '/'));
        // Skip non-model extras if any; keep onnx / json / MODEL_CARD
        if (!/\.(onnx|json)$/i.test(base) && base !== 'MODEL_CARD') continue;
        out.push({
            relativePath: base,
            url: `${HF}/${rel.replace(/\\/g, '/')}`,
        });
    }
    if (!out.some((f) => f.relativePath.endsWith('.onnx'))) {
        throw new Error(`Piper voice missing onnx: ${key}`);
    }
    return out;
}

function registerPiperPackages() {
    rt.registerRuntime({
        id: 'piper',
        strategy: rt.STRATEGY.ISOLATED_PYTHON,
        label: 'Piper (optional GPL)',
    });
    rt.bindEngine('piper', 'piper');

    for (const key of catalogKeys()) {
        try {
            mdl.registerPackage({
                engineId: 'piper',
                variant: key,
                version: 'piper-voices-v1',
                files: filesForVoice(key),
            });
        } catch (e) {
            console.warn('[piper] skip voice', key, e.message);
        }
    }
}

function runtimeRoot() {
    return paths.getRuntimeDir('piper');
}

function sitePackagesDir() {
    return path.join(runtimeRoot(), 'site-packages');
}

function runtimeMarkerPath() {
    return path.join(runtimeRoot(), RUNTIME_MARKER);
}

function isRuntimeInstalled() {
    const marker = runtimeMarkerPath();
    if (!fs.existsSync(marker)) return false;
    const site = sitePackagesDir();
    // piper or piper_tts package folder after pip --target
    return fs.existsSync(path.join(site, 'piper'))
        || fs.existsSync(path.join(site, 'piper_tts'))
        || fs.existsSync(path.join(site, 'piper-1.5.0.dist-info'))
        || fs.existsSync(path.join(site, 'piper_tts-1.5.0.dist-info'));
}

function readVoiceLicense(variant) {
    try {
        const root = mdl.getInstallRoot('piper', variant);
        const card = path.join(root, 'MODEL_CARD');
        if (!fs.existsSync(card)) return null;
        const text = fs.readFileSync(card, 'utf8');
        for (const line of text.split(/\r?\n/)) {
            const s = line.trim().replace(/^[-*]\s*/, '');
            if (/^license:/i.test(s)) {
                return s.split(':').slice(1).join(':').trim() || null;
            }
        }
    } catch (_) { /* */ }
    return null;
}

function listInstalledVoices() {
    return catalogKeys()
        .filter((k) => mdl.getStatus('piper', k) === mdl.STATUS.INSTALLED)
        .map((k) => ({
            id: k,
            label: k,
            license: readVoiceLicense(k),
            installed: true,
        }));
}

function pipInstallTarget(site, pythonCmd, pythonArgs, timeoutMs = 600000) {
    return new Promise((resolve, reject) => {
        const args = [
            ...pythonArgs,
            '-m', 'pip', 'install',
            '--upgrade',
            '--target', site,
            PIPER_PKG,
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
            reject(new Error(`pip install piper-tts timeout: ${stderr.slice(0, 400)}`));
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
            else reject(new Error(`pip install piper-tts failed (${code}): ${stderr.slice(0, 500)}`));
        });
    });
}

/**
 * Install isolated piper-tts into userData/runtimes/piper (not core).
 * @param {{ provision?: Function, skipPip?: boolean }} [opts]
 */
async function installRuntime(opts = {}) {
    rt.registerRuntime({
        id: 'piper',
        strategy: rt.STRATEGY.ISOLATED_PYTHON,
        label: 'Piper (optional GPL)',
    });
    rt.bindEngine('piper', 'piper');

    return rt.install('piper', {
        provision: opts.provision || (async ({ root, pythonPath }) => {
            const site = path.join(root, 'site-packages');
            fs.mkdirSync(site, { recursive: true });
            fs.mkdirSync(path.dirname(pythonPath), { recursive: true });
            // Stub binary satisfies runtime-manager layout; worker uses host Python + PYTHONPATH.
            if (!fs.existsSync(pythonPath)) {
                fs.writeFileSync(pythonPath, '');
            }
            if (!opts.skipPip) {
                const py = paths.resolvePythonCmd();
                await pipInstallTarget(site, py.cmd, py.args);
            } else {
                // Selfcheck / dry-run: fake importable marker dirs
                fs.mkdirSync(path.join(site, 'piper'), { recursive: true });
            }
            fs.writeFileSync(path.join(root, RUNTIME_MARKER), JSON.stringify({
                package: PIPER_PKG,
                sitePackages: 'site-packages',
                installedAt: new Date().toISOString(),
                note: 'Optional GPL component — not part of core Khepree bundle',
            }, null, 2), 'utf8');
        }),
    });
}

function uninstallRuntime() {
    return rt.uninstall('piper');
}

/**
 * Full optional install: runtime + one voice. Caller must show LICENSE_INSTALL_WARNING first.
 */
async function installOptional(voiceKey = DEFAULT_VOICE) {
    const key = hasVoice(voiceKey) ? voiceKey : DEFAULT_VOICE;
    const runtime = await installRuntime();
    const voice = await mdl.install('piper', key);
    return { ok: true, runtime, voice, variant: key };
}

function uninstallVoice(voiceKey) {
    return mdl.uninstall('piper', voiceKey);
}

/** Uninstall all piper voices + runtime (core untouched). */
function uninstallAll() {
    for (const key of catalogKeys()) {
        try {
            if (mdl.getStatus('piper', key) !== mdl.STATUS.NOT_INSTALLED) {
                mdl.uninstall('piper', key);
            }
        } catch (_) { /* */ }
    }
    return uninstallRuntime();
}

module.exports = {
    DEFAULT_VOICE,
    LICENSE_INSTALL_WARNING,
    CATALOG_PATH,
    loadCatalog,
    listCatalogVoices,
    catalogKeys,
    hasVoice,
    filesForVoice,
    registerPiperPackages,
    isRuntimeInstalled,
    installRuntime,
    uninstallRuntime,
    installOptional,
    uninstallVoice,
    uninstallAll,
    listInstalledVoices,
    readVoiceLicense,
    sitePackagesDir,
    runtimeRoot,
};
