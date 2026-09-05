const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const { app } = require('electron');

/** Optional override from settings.modelStorageDir (validated). */
let _modelStorageDir = '';

/** Optional override for isolated Python runtimes (tests / future setting). */
let _runtimeStorageDir = '';

function isPackaged() {
    return Boolean(app?.isPackaged);
}

/** Thư mục gốc: models, python workers, runtime (dev = repo root). */
function getAppRoot() {
    if (isPackaged()) {
        return process.resourcesPath;
    }
    return path.join(__dirname, '..');
}

function getDistDir() {
    if (isPackaged()) {
        return path.join(app.getAppPath(), 'dist');
    }
    const root = path.join(__dirname, '..');
    const dist = path.join(root, 'dist');
    if (fs.existsSync(path.join(dist, 'batch.html'))) return dist;
    return root;
}

function getPublicDir() {
    if (isPackaged()) {
        return path.join(app.getAppPath(), 'public');
    }
    return path.join(__dirname, '..', 'public');
}

function getContentRoot() {
    if (isPackaged()) {
        return app.getAppPath();
    }
    return path.join(__dirname, '..');
}

function getSamplesDir() {
    return path.join(getContentRoot(), 'samples');
}

function getPythonDir() {
    return path.join(getAppRoot(), 'python');
}

/**
 * Bundled/offline models shipped with the app (VieNeu Turbo+Nano+codec).
 * Packaged → resources/models; dev → <repo>/models.
 */
function getBundledModelsDir() {
    return path.join(getAppRoot(), 'models');
}

/**
 * Compatibility for VieNeu / existing workers.
 * MUST remain the bundled tree — do not point this at userData.
 */
function getModelsDir() {
    return getBundledModelsDir();
}

/** Roots where optional model downloads must never land. */
function listForbiddenOptionalRoots() {
    const roots = [];
    try {
        if (process.resourcesPath) roots.push(path.resolve(process.resourcesPath));
    } catch (_) { /* ignore */ }
    try {
        if (app?.getAppPath) roots.push(path.resolve(app.getAppPath()));
    } catch (_) { /* ignore */ }
    // Dev source / project root (and packaged app root via getAppRoot).
    roots.push(path.resolve(path.join(__dirname, '..')));
    try {
        roots.push(path.resolve(getAppRoot()));
    } catch (_) { /* ignore */ }
    if (process.platform === 'win32') {
        const pf = process.env.ProgramFiles;
        const pf86 = process.env['ProgramFiles(x86)'];
        if (pf) roots.push(path.resolve(pf));
        if (pf86) roots.push(path.resolve(pf86));
    } else if (process.platform === 'darwin') {
        roots.push('/Applications');
    }
    return [...new Set(roots.filter(Boolean))];
}

/**
 * True if candidate is inside a forbidden install/resources/source tree.
 * @param {string} candidate
 * @param {string[]} [forbiddenRoots]
 */
function isForbiddenOptionalModelsPath(candidate, forbiddenRoots) {
    if (!candidate) return true;
    let resolved;
    try {
        resolved = path.resolve(candidate);
    } catch (_) {
        return true;
    }
    const roots = forbiddenRoots || listForbiddenOptionalRoots();
    const norm = resolved.toLowerCase();
    for (const root of roots) {
        const r = path.resolve(root).toLowerCase();
        if (norm === r || norm.startsWith(r + path.sep.toLowerCase()) || norm.startsWith(r + '/')) {
            return true;
        }
    }
    return false;
}

/**
 * Validate user-chosen optional model root. Returns absolute path or null if unsafe/empty.
 */
function resolveSafeOptionalModelsRoot(customDir) {
    const raw = String(customDir || '').trim();
    if (!raw) return null;
    const resolved = path.resolve(raw);
    if (isForbiddenOptionalModelsPath(resolved)) return null;
    return resolved;
}

/**
 * Apply settings.modelStorageDir (call from main after load/save settings).
 * Unsafe values are ignored; default userData/models remains in effect.
 */
function setModelStorageDir(customDir) {
    const safe = resolveSafeOptionalModelsRoot(customDir);
    _modelStorageDir = safe || '';
    return _modelStorageDir;
}

function getConfiguredModelStorageDir() {
    return _modelStorageDir || '';
}

/**
 * Writable root for optional (non-bundled) engine models.
 * Default: userData/models. Never resourcesPath / Program Files / app source.
 * @param {string} [customDir] — one-shot override (also validated)
 */
function getUserModelsDir(customDir) {
    const fromArg = resolveSafeOptionalModelsRoot(customDir);
    if (fromArg) return fromArg;
    if (_modelStorageDir) return _modelStorageDir;
    return path.join(app.getPath('userData'), 'models');
}

function sanitizeModelSubdir(name) {
    return String(name || 'engine')
        .replace(/[^a-zA-Z0-9_-]/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_|_$/g, '')
        .slice(0, 64) || 'engine';
}

/**
 * Directory for one engine's model files.
 * Bundled engines → getBundledModelsDir()/subdir
 * Optional engines → getUserModelsDir()/subdir
 */
function getEngineModelDir(engineId) {
    let entry = null;
    try {
        entry = require('./engine-registry.cjs').getEngine(engineId);
    } catch (_) { /* registry optional during early boot */ }

    const sub = sanitizeModelSubdir(entry?.modelsSubdir || entry?.id || engineId);
    if (entry?.bundled) {
        return path.join(getBundledModelsDir(), sub);
    }
    // Unknown / optional → user-writable storage only
    return path.join(getUserModelsDir(), sub);
}

/**
 * Writable root for optional isolated Python runtimes (not core bundle).
 * Default: userData/runtimes. Never resourcesPath / Program Files / repo.
 */
function setRuntimeStorageDir(customDir) {
    const safe = resolveSafeOptionalModelsRoot(customDir);
    _runtimeStorageDir = safe || '';
    return _runtimeStorageDir;
}

function getUserRuntimesDir(customDir) {
    const fromArg = resolveSafeOptionalModelsRoot(customDir);
    if (fromArg) return fromArg;
    if (_runtimeStorageDir) return _runtimeStorageDir;
    return path.join(app.getPath('userData'), 'runtimes');
}

function getRuntimeDir(runtimeId) {
    const id = sanitizeModelSubdir(runtimeId || 'runtime');
    const root = path.resolve(getUserRuntimesDir());
    const dir = path.resolve(path.join(root, id));
    if (dir !== root && !dir.startsWith(root + path.sep)) {
        throw new Error('Runtime path escaped user runtimes dir');
    }
    return dir;
}

function getWorkerScript(name) {
    return path.join(getPythonDir(), name);
}

function getBundledPythonExe() {
    if (!isPackaged()) return null;
    const root = getAppRoot();
    const candidates = [];
    if (process.platform === 'win32') {
        candidates.push(
            path.join(root, 'runtime', 'python', 'python.exe'),
            path.join(root, 'runtime', 'python', 'Scripts', 'python.exe'),
        );
    } else if (process.platform === 'darwin') {
        candidates.push(
            path.join(root, 'runtime', 'python', 'bin', 'python3'),
            path.join(root, 'runtime', 'python', 'bin', 'python'),
        );
    } else {
        candidates.push(path.join(root, 'runtime', 'python', 'bin', 'python3'));
    }
    for (const exe of candidates) {
        if (fs.existsSync(exe)) return exe;
    }
    return null;
}

function getBundledFfmpegDir() {
    const dir = path.join(getAppRoot(), 'runtime', 'ffmpeg');
    return fs.existsSync(dir) ? dir : null;
}

function resolveFfmpegBinary(baseName) {
    const bundledDir = getBundledFfmpegDir();
    if (bundledDir) {
        const ext = process.platform === 'win32' ? '.exe' : '';
        const p = path.join(bundledDir, `${baseName}${ext}`);
        if (fs.existsSync(p)) return p;
    }
    try {
        if (baseName === 'ffmpeg') {
            const p = require('ffmpeg-static');
            if (p && fs.existsSync(p)) return p;
        }
        if (baseName === 'ffprobe') {
            const p = require('ffprobe-static')?.path;
            if (p && fs.existsSync(p)) return p;
        }
    } catch (_) { /* optional in dev */ }
    return null;
}

/**
 * Inference worker env. Packaged builds force HF offline so synthesis never
 * pulls models. Do NOT use this for model downloads — use buildNetworkEnv().
 */
function buildWorkerEnv(extra = {}) {
    const env = {
        ...process.env,
        KHEPREE_TTS_ROOT: getAppRoot(),
        PYTHONIOENCODING: 'utf-8',
        PYTHONUTF8: '1',
        PYTHONUNBUFFERED: '1',
        ...extra,
    };

    // Packaged builds ship models/ — never pull from HuggingFace at runtime.
    if (isPackaged()) {
        env.HF_HUB_OFFLINE = '1';
        env.HF_DATASETS_OFFLINE = '1';
        env.TRANSFORMERS_OFFLINE = '1';
    }

    const ffmpeg = resolveFfmpegBinary('ffmpeg');
    const ffprobe = resolveFfmpegBinary('ffprobe');
    if (ffmpeg) {
        env.FFMPEG_PATH = ffmpeg;
        env.IMAGEIO_FFMPEG_EXE = ffmpeg;
        const binDir = path.dirname(ffmpeg);
        env.PATH = `${binDir}${path.delimiter}${env.PATH || ''}`;
    }
    if (ffprobe) {
        env.FFPROBE_PATH = ffprobe;
        const probeDir = path.dirname(ffprobe);
        if (!ffmpeg || probeDir !== path.dirname(ffmpeg)) {
            env.PATH = `${probeDir}${path.delimiter}${env.PATH || ''}`;
        }
    }
    const pyDir = getPythonDir();
    if (fs.existsSync(pyDir)) {
        env.PYTHONPATH = pyDir;
    }
    return env;
}

/**
 * Network context for Model Download Manager (and similar).
 * Explicitly clears HF/transformers offline flags so downloads can run even
 * when packaged inference workers stay offline.
 */
function buildNetworkEnv(extra = {}) {
    const env = {
        ...process.env,
        KHEPREE_TTS_ROOT: getAppRoot(),
        PYTHONIOENCODING: 'utf-8',
        PYTHONUTF8: '1',
        PYTHONUNBUFFERED: '1',
        KHEPREE_NETWORK_CONTEXT: '1',
        ...extra,
    };
    delete env.HF_HUB_OFFLINE;
    delete env.HF_DATASETS_OFFLINE;
    delete env.TRANSFORMERS_OFFLINE;
    return env;
}

function resolveExecutable(cmd) {
    if (!cmd) return cmd;
    if (path.isAbsolute(cmd) && fs.existsSync(cmd)) return cmd;
    if (process.platform === 'win32' && !cmd.includes(path.sep)) {
        try {
            const r = spawnSync('where.exe', [cmd], {
                encoding: 'utf8',
                timeout: 8000,
                windowsHide: true,
            });
            if (r.status === 0) {
                const hit = r.stdout.split(/\r?\n/).map((s) => s.trim()).find(Boolean);
                if (hit && fs.existsSync(hit)) return hit;
            }
        } catch (_) { /* ignore */ }
        const launcher = path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Python', 'Launcher', `${cmd}.exe`);
        if (fs.existsSync(launcher)) return launcher;
    }
    return cmd;
}

function pythonWorks(cmd, extraArgs = []) {
    const resolved = resolveExecutable(cmd);
    try {
        const r = spawnSync(resolved, [...extraArgs, '--version'], {
            encoding: 'utf8',
            timeout: 8000,
            windowsHide: true,
        });
        return r.status === 0;
    } catch (_) {
        return false;
    }
}

function finalizePythonCmd(cmd, args = []) {
    return { cmd: resolveExecutable(cmd), args };
}

function resolvePythonCmd(customPath) {
    if (customPath) {
        const resolved = path.resolve(customPath);
        if (!fs.existsSync(resolved)) {
            throw new Error(`Không tìm thấy Python: ${customPath}`);
        }
        return { cmd: resolved, args: [] };
    }

    const bundled = getBundledPythonExe();
    if (bundled) {
        return { cmd: bundled, args: [] };
    }

    if (isPackaged()) {
        throw new Error(
            'Không tìm thấy Python đi kèm bản cài đặt. Hãy cài lại Khepree TTS Batch AI.'
        );
    }

    if (process.platform === 'win32') {
        const candidates = [
            { cmd: 'py', args: ['-3'] },
            { cmd: 'python3', args: [] },
            { cmd: 'python', args: [] },
        ];
        for (const c of candidates) {
            if (pythonWorks(c.cmd, c.args)) return finalizePythonCmd(c.cmd, c.args);
        }
        const localAppData = process.env.LOCALAPPDATA || '';
        if (localAppData) {
            const pyRoot = path.join(localAppData, 'Programs', 'Python');
            if (fs.existsSync(pyRoot)) {
                for (const dir of fs.readdirSync(pyRoot).sort().reverse()) {
                    const exe = path.join(pyRoot, dir, 'python.exe');
                    if (fs.existsSync(exe)) return { cmd: exe, args: [] };
                }
            }
        }
    } else {
        for (const cmd of ['python3', 'python']) {
            if (pythonWorks(cmd)) return finalizePythonCmd(cmd);
        }
    }

    throw new Error(
        'Không tìm thấy Python. Chạy: py -3 -m pip install -r python/requirements.txt '
        + '(hoặc npm run prepare:runtime trước khi build installer).'
    );
}

module.exports = {
    isPackaged,
    getAppRoot,
    getDistDir,
    getPublicDir,
    getContentRoot,
    getSamplesDir,
    getPythonDir,
    getModelsDir,
    getBundledModelsDir,
    getUserModelsDir,
    getEngineModelDir,
    getUserRuntimesDir,
    getRuntimeDir,
    setRuntimeStorageDir,
    setModelStorageDir,
    getConfiguredModelStorageDir,
    resolveSafeOptionalModelsRoot,
    isForbiddenOptionalModelsPath,
    listForbiddenOptionalRoots,
    getWorkerScript,
    getBundledPythonExe,
    resolveFfmpegBinary,
    buildWorkerEnv,
    buildNetworkEnv,
    resolvePythonCmd,
};
