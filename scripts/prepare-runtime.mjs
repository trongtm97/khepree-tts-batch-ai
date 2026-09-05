/**
 * Chuẩn bị Python nhúng + ffmpeg trước khi electron-builder.
 * Chạy trên từng nền tảng đích (Windows / macOS).
 *
 *   npm run prepare:runtime
 */
import { createRequire } from 'module';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import https from 'https';
import http from 'http';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PLATFORM = process.platform;
const RUNTIME_DIR = path.join(ROOT, 'resources', 'runtime', PLATFORM);
const PYTHON_DIR = path.join(RUNTIME_DIR, 'python');
const FFMPEG_DIR = path.join(RUNTIME_DIR, 'ffmpeg');
const PYTHON_VERSION = '3.12.7';
const REQUIREMENTS = path.join(ROOT, 'python', 'requirements-bundle.txt');
const MODEL_MARKER = path.join(ROOT, 'models', 'vieneu', 'v3turbo', 'onnx', 'vieneu_prefill.onnx');
const NANO_MARKER = path.join(ROOT, 'models', 'vieneu', 'v3nano', 'vector_estimator.onnx');
const VIENEU_PIN = 'vieneu==3.5.4';
const DOWNLOAD_SCRIPT = path.join(ROOT, 'scripts', 'download-vieneu-model.py');

const TURBO_REQUIRED = [
    'vieneu_prefill.onnx',
    'vieneu_decode_step.onnx',
    'vieneu_acoustic_cached.onnx',
    'vieneu_backbone_shared.data',
    'vieneu_v3_heads.npz',
    'config.json',
    'tokenizer.json',
];
const CODEC_REQUIRED = [
    'moss_audio_tokenizer_decode_full.onnx',
    'moss_audio_tokenizer_decode_shared.data',
    'moss_audio_tokenizer_decode_step.onnx',
    'moss_audio_tokenizer_encode.onnx',
    'moss_audio_tokenizer_encode.data',
];
const NANO_REQUIRED = [
    'text_encoder.onnx',
    'duration_predictor.onnx',
    'vector_estimator.onnx',
    'codec_decoder.onnx',
    'config.json',
    'constants.npz',
    'speaker_encoder.onnx',
    'codec_encoder.onnx',
    'reference_encoder.onnx',
    'denoiser.onnx',
];

function log(msg) {
    console.log(`[prepare-runtime] ${msg}`);
}

function ensureDir(dir) {
    fs.mkdirSync(dir, { recursive: true });
}

function download(url, dest) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(dest);
        const client = url.startsWith('https') ? https : http;
        const request = (targetUrl) => {
            client.get(targetUrl, (res) => {
                if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    res.resume();
                    request(res.headers.location);
                    return;
                }
                if (res.statusCode !== 200) {
                    reject(new Error(`HTTP ${res.statusCode} khi tải ${targetUrl}`));
                    return;
                }
                res.pipe(file);
                file.on('finish', () => file.close(() => resolve(dest)));
            }).on('error', reject);
        };
        request(url);
    });
}

function copyFfmpeg() {
    ensureDir(FFMPEG_DIR);
    const ffmpegSrc = require('ffmpeg-static');
    const ffprobeSrc = require('ffprobe-static')?.path;
    if (!ffmpegSrc || !fs.existsSync(ffmpegSrc)) {
        throw new Error('Không tìm thấy ffmpeg-static. Chạy: npm install');
    }
    const ext = PLATFORM === 'win32' ? '.exe' : '';
    const ffmpegDest = path.join(FFMPEG_DIR, `ffmpeg${ext}`);
    fs.copyFileSync(ffmpegSrc, ffmpegDest);
    if (ffprobeSrc && fs.existsSync(ffprobeSrc)) {
        fs.copyFileSync(ffprobeSrc, path.join(FFMPEG_DIR, `ffprobe${ext}`));
    } else {
        log('Cảnh báo: không tìm thấy ffprobe-static');
    }
    if (PLATFORM !== 'win32') {
        fs.chmodSync(ffmpegDest, 0o755);
        const ffprobeDest = path.join(FFMPEG_DIR, `ffprobe${ext}`);
        if (fs.existsSync(ffprobeDest)) fs.chmodSync(ffprobeDest, 0o755);
    }
    log(`Đã copy ffmpeg → ${FFMPEG_DIR}`);
}

function fileOk(p) {
    try {
        return fs.existsSync(p) && fs.statSync(p).size > 0;
    } catch (_) {
        return false;
    }
}

function missingIn(dir, names) {
    return names.filter((fn) => !fileOk(path.join(dir, fn)));
}

function verifyModels() {
    const turboDir = path.join(ROOT, 'models', 'vieneu', 'v3turbo', 'onnx');
    const codecDir = path.join(ROOT, 'models', 'vieneu', 'codec');
    const nanoDir = path.join(ROOT, 'models', 'vieneu', 'v3nano');
    const problems = [];
    const turboMiss = missingIn(turboDir, TURBO_REQUIRED);
    if (turboMiss.length) problems.push(`v3turbo/onnx thiếu: ${turboMiss.join(', ')}`);
    const codecMiss = missingIn(codecDir, CODEC_REQUIRED);
    if (codecMiss.length) problems.push(`codec thiếu: ${codecMiss.join(', ')}`);
    const nanoMiss = missingIn(nanoDir, NANO_REQUIRED);
    if (nanoMiss.length) problems.push(`v3nano thiếu: ${nanoMiss.join(', ')}`);
    if (problems.length) {
        throw new Error(
            `Bundle model chưa đủ (installer phải offline hoàn toàn):\n  - ${problems.join('\n  - ')}\n`
            + 'Chạy: npm run ensure:models'
        );
    }
    if (!fileOk(MODEL_MARKER) || !fileOk(NANO_MARKER)) {
        throw new Error('Marker model Turbo/Nano không hợp lệ.');
    }
    log('Model VieNeu Turbo + Nano + codec: OK (offline bundle)');
}

function ensureModels() {
    try {
        verifyModels();
        return;
    } catch (e) {
        log(String(e.message || e));
        log('Đang tải model thiếu vào models/…');
    }
    run(`py -3 "${DOWNLOAD_SCRIPT}"`);
    verifyModels();
}

function run(cmd, opts = {}) {
    log(cmd);
    execSync(cmd, { stdio: 'inherit', ...opts });
}

function patchEmbeddablePth(dir) {
    const pth = fs.readdirSync(dir).find((f) => f.endsWith('._pth'));
    if (!pth) throw new Error(`Không tìm thấy file ._pth trong ${dir}`);
    const zip = fs.readdirSync(dir).find((f) => f.endsWith('.zip'));
    ensureDir(path.join(dir, 'Lib', 'site-packages'));
    ensureDir(path.join(dir, 'Scripts'));
    const lines = [
        zip || 'python312.zip',
        '.',
        './Lib/site-packages',
        './Scripts',
        '../../python',
        'import site',
    ];
    fs.writeFileSync(path.join(dir, pth), `${lines.join('\n')}\n`, 'utf8');
}

async function prepareWinPython() {
    const zipName = `python-${PYTHON_VERSION}-embed-amd64.zip`;
    const zipUrl = `https://www.python.org/ftp/python/${PYTHON_VERSION}/${zipName}`;
    const zipPath = path.join(RUNTIME_DIR, zipName);

    ensureDir(RUNTIME_DIR);
    if (fs.existsSync(PYTHON_DIR)) {
        fs.rmSync(PYTHON_DIR, { recursive: true, force: true });
    }
    ensureDir(PYTHON_DIR);

    log(`Tải Python embeddable ${PYTHON_VERSION}…`);
    await download(zipUrl, zipPath);
    run(`powershell -NoProfile -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${PYTHON_DIR}' -Force"`);
    fs.unlinkSync(zipPath);

    patchEmbeddablePth(PYTHON_DIR);

    const pythonExe = path.join(PYTHON_DIR, 'python.exe');
    const getPip = path.join(RUNTIME_DIR, 'get-pip.py');
    await download('https://bootstrap.pypa.io/get-pip.py', getPip);

    run(`"${pythonExe}" "${getPip}"`);
    fs.unlinkSync(getPip);

    run(`"${pythonExe}" -m pip install --upgrade pip setuptools wheel`);
    run(`"${pythonExe}" -m pip install --no-deps ${VIENEU_PIN}`);
    run(`"${pythonExe}" -m pip install -r "${REQUIREMENTS}"`, { cwd: ROOT });
    log(`Python Windows → ${PYTHON_DIR}`);
}

async function prepareDarwinPython() {
    const arch = process.arch === 'arm64' ? 'aarch64' : 'x86_64';
    const tag = `cpython-${PYTHON_VERSION}+20241016-${arch}-apple-darwin-install_only`;
    const tarName = `${tag}.tar.gz`;
    const url = `https://github.com/astral-sh/python-build-standalone/releases/download/20241016/${tarName}`;
    const tarPath = path.join(RUNTIME_DIR, tarName);

    ensureDir(RUNTIME_DIR);
    if (fs.existsSync(PYTHON_DIR)) {
        fs.rmSync(PYTHON_DIR, { recursive: true, force: true });
    }

    log(`Tải Python standalone macOS (${arch})…`);
    await download(url, tarPath);
    run(`tar -xzf "${tarPath}" -C "${RUNTIME_DIR}"`);
    fs.unlinkSync(tarPath);

    const extracted = path.join(RUNTIME_DIR, 'python');
    if (!fs.existsSync(extracted)) {
        throw new Error('Giải nén Python macOS thất bại');
    }
    fs.renameSync(extracted, PYTHON_DIR);

    const pythonBin = path.join(PYTHON_DIR, 'bin', 'python3');
    run(`"${pythonBin}" -m ensurepip --upgrade`);
    run(`"${pythonBin}" -m pip install --upgrade pip setuptools wheel`);
    run(`"${pythonBin}" -m pip install --no-deps ${VIENEU_PIN}`);
    run(`"${pythonBin}" -m pip install -r "${REQUIREMENTS}"`, { cwd: ROOT });
    log(`Python macOS → ${PYTHON_DIR}`);
}

async function main() {
    if (!['win32', 'darwin'].includes(PLATFORM)) {
        throw new Error(`Nền tảng ${PLATFORM} chưa hỗ trợ prepare:runtime`);
    }

    ensureModels();
    copyFfmpeg();

    if (PLATFORM === 'win32') {
        await prepareWinPython();
    } else {
        await prepareDarwinPython();
    }

    log('Hoàn tất. Tiếp theo: npm run build:win hoặc npm run build:mac');
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
