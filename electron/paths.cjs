const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const { app } = require('electron');

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

function getModelsDir() {
    return path.join(getAppRoot(), 'models');
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
    }
    const pyDir = getPythonDir();
    if (fs.existsSync(pyDir)) {
        env.PYTHONPATH = pyDir;
    }
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
    getWorkerScript,
    getBundledPythonExe,
    resolveFfmpegBinary,
    buildWorkerEnv,
    resolvePythonCmd,
};
