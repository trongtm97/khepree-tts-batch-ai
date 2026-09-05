/**
 * Benchmark metrics helpers — no fake quality scores.
 * Duration from WAV header when possible; VRAM only via trusted nvidia-smi.
 */
const { spawnSync } = require('child_process');
const paths = require('./paths.cjs');

function wavDurationSec(buf) {
    if (!Buffer.isBuffer(buf) || buf.length < 44) return null;
    if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
        return null;
    }
    let offset = 12;
    let sampleRate = 0;
    let bitsPerSample = 16;
    let channels = 1;
    let dataSize = 0;
    while (offset + 8 <= buf.length) {
        const id = buf.toString('ascii', offset, offset + 4);
        const size = buf.readUInt32LE(offset + 4);
        const next = offset + 8 + size;
        if (id === 'fmt ' && size >= 16) {
            channels = buf.readUInt16LE(offset + 10);
            sampleRate = buf.readUInt32LE(offset + 12);
            bitsPerSample = buf.readUInt16LE(offset + 22);
        } else if (id === 'data') {
            dataSize = size;
            break;
        }
        offset = next + (size % 2); // word align
    }
    if (!sampleRate || !dataSize) return null;
    const bytesPerSample = Math.max(1, (bitsPerSample / 8) * Math.max(1, channels));
    return dataSize / (sampleRate * bytesPerSample);
}

function probeDurationSec(filePath) {
    const ffprobe = paths.resolveFfmpegBinary('ffprobe');
    if (!ffprobe || !filePath) return null;
    try {
        const r = spawnSync(ffprobe, [
            '-v', 'error',
            '-show_entries', 'format=duration',
            '-of', 'default=noprint_wrappers=1:nokey=1',
            filePath,
        ], { encoding: 'utf8', windowsHide: true, timeout: 15000 });
        if (r.status !== 0) return null;
        const n = Number(String(r.stdout || '').trim());
        return Number.isFinite(n) && n > 0 ? n : null;
    } catch (_) {
        return null;
    }
}

/** RTF = wall / audio; realtimeFactor = audio / wall (× realtime). */
function computeTiming(synthMs, audioSec) {
    const wallSec = Number(synthMs) / 1000;
    if (!Number.isFinite(wallSec) || wallSec <= 0) {
        return { rtf: null, realtimeFactor: null };
    }
    if (!Number.isFinite(audioSec) || audioSec <= 0) {
        return { rtf: null, realtimeFactor: null };
    }
    return {
        rtf: wallSec / audioSec,
        realtimeFactor: audioSec / wallSec,
    };
}

function readNvidiaUsedMb() {
    try {
        const r = spawnSync('nvidia-smi', [
            '--query-gpu=memory.used',
            '--format=csv,noheader,nounits',
        ], { encoding: 'utf8', windowsHide: true, timeout: 8000 });
        if (r.status !== 0) return null;
        const lines = String(r.stdout || '').trim().split(/\r?\n/).filter(Boolean);
        const vals = lines.map((l) => Number(l.trim())).filter((n) => Number.isFinite(n));
        if (!vals.length) return null;
        return vals.reduce((a, b) => a + b, 0);
    } catch (_) {
        return null;
    }
}

/**
 * @returns {{ mb: number|null, trusted: boolean }}
 */
function vramSnapshotMb(hardware) {
    if (!hardware?.gpu?.nvidia || !hardware?.gpu?.nvidiaSmiAvailable) {
        return { mb: null, trusted: false };
    }
    const mb = readNvidiaUsedMb();
    return { mb, trusted: mb != null };
}

/** Node heap is not engine RAM — never report as trusted. */
function ramSnapshotTrusted() {
    return { mb: null, trusted: false };
}

module.exports = {
    wavDurationSec,
    probeDurationSec,
    computeTiming,
    vramSnapshotMb,
    ramSnapshotTrusted,
};
