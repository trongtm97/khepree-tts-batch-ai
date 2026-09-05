/**
 * Hardware detector (Windows-first). Never throws on missing NVIDIA.
 * No invented VRAM requirements — only report what probes return.
 */
const os = require('os');
const { spawnSync } = require('child_process');

const NVIDIA_SMI_TIMEOUT_MS = 4000;
const ONNX_PROBE_TIMEOUT_MS = 8000;

function runCapture(cmd, args, timeoutMs) {
    try {
        const r = spawnSync(cmd, args, {
            encoding: 'utf8',
            timeout: timeoutMs,
            windowsHide: true,
            env: process.env,
        });
        if (r.error) return { ok: false, error: r.error.message, stdout: '', stderr: String(r.stderr || '') };
        return {
            ok: r.status === 0,
            status: r.status,
            stdout: String(r.stdout || '').trim(),
            stderr: String(r.stderr || '').trim(),
        };
    } catch (e) {
        return { ok: false, error: e.message, stdout: '', stderr: '' };
    }
}

function parseNvidiaSmi(stdout) {
    // Expected: name, memory.total [MiB], driver_version, cuda_version
    const line = String(stdout || '').split(/\r?\n/).map((s) => s.trim()).find(Boolean);
    if (!line) return null;
    const parts = line.split(',').map((s) => s.trim());
    if (parts.length < 2) return null;

    const name = parts[0] || null;
    let vramMb = null;
    const memRaw = parts[1] || '';
    const memNum = parseInt(String(memRaw).replace(/[^\d]/g, ''), 10);
    if (Number.isFinite(memNum) && memNum > 0) vramMb = memNum;

    const driverVersion = parts[2] || null;
    const cudaVersion = parts[3] && parts[3] !== '[N/A]' ? parts[3] : null;

    return {
        name,
        vramMb,
        vramBytes: vramMb != null ? vramMb * 1024 * 1024 : null,
        driverVersion,
        cudaVersion,
        trustedVram: vramMb != null,
    };
}

function detectNvidia() {
    const query = runCapture(
        'nvidia-smi',
        [
            '--query-gpu=name,memory.total,driver_version,cuda_version',
            '--format=csv,noheader,nounits',
        ],
        NVIDIA_SMI_TIMEOUT_MS
    );

    if (!query.ok || !query.stdout) {
        return {
            present: false,
            nvidiaSmiAvailable: false,
            gpus: [],
            error: query.error || query.stderr || null,
        };
    }

    const gpus = query.stdout
        .split(/\r?\n/)
        .map((line) => parseNvidiaSmi(line))
        .filter(Boolean);

    return {
        present: gpus.length > 0,
        nvidiaSmiAvailable: true,
        gpus,
        // Primary GPU summary (first card)
        name: gpus[0]?.name || null,
        vramMb: gpus[0]?.vramMb ?? null,
        vramBytes: gpus[0]?.vramBytes ?? null,
        trustedVram: Boolean(gpus[0]?.trustedVram),
        driverVersion: gpus[0]?.driverVersion || null,
        cudaVersion: gpus[0]?.cudaVersion || null,
        error: null,
    };
}

function detectCpuName() {
    if (process.platform === 'win32') {
        const ps = runCapture(
            'powershell.exe',
            [
                '-NoProfile',
                '-Command',
                '(Get-CimInstance Win32_Processor | Select-Object -First 1 -ExpandProperty Name)',
            ],
            5000
        );
        if (ps.ok && ps.stdout) return ps.stdout.replace(/\s+/g, ' ').trim();
    }
    const cpus = os.cpus();
    return cpus[0]?.model || 'Unknown CPU';
}

/**
 * Optional ONNX Runtime provider probe via core Python.
 * Soft-fail — never required for UI.
 */
function probeOnnxProviders(pythonCmd) {
    if (!pythonCmd) return { available: false, providers: [], error: null };
    const code = 'import onnxruntime as ort; print(",".join(ort.get_available_providers()))';
    const r = runCapture(pythonCmd, ['-c', code], ONNX_PROBE_TIMEOUT_MS);
    if (!r.ok || !r.stdout) {
        return { available: false, providers: [], error: r.error || r.stderr || 'onnx probe failed' };
    }
    const providers = r.stdout.split(',').map((s) => s.trim()).filter(Boolean);
    return { available: providers.length > 0, providers, error: null };
}

/**
 * @param {{ probeOnnx?: boolean, pythonCmd?: string }} [opts]
 */
function detectHardware(opts = {}) {
    const cpus = os.cpus() || [];
    const totalMemBytes = os.totalmem();
    const freeMemBytes = os.freemem();
    const nvidia = detectNvidia();

    const profile = {
        os: {
            platform: process.platform,
            release: os.release(),
            arch: os.arch(),
            type: os.type(),
        },
        cpu: {
            name: detectCpuName(),
            cores: cpus.length,
            speedMHz: cpus[0]?.speed || null,
        },
        ram: {
            totalBytes: totalMemBytes,
            freeBytes: freeMemBytes,
            totalGb: Math.round((totalMemBytes / (1024 ** 3)) * 10) / 10,
            freeGb: Math.round((freeMemBytes / (1024 ** 3)) * 10) / 10,
        },
        gpu: {
            nvidia: nvidia.present,
            name: nvidia.name,
            vramMb: nvidia.trustedVram ? nvidia.vramMb : null,
            vramTrusted: Boolean(nvidia.trustedVram),
            driverVersion: nvidia.driverVersion,
            cudaVersion: nvidia.cudaVersion,
            nvidiaSmiAvailable: nvidia.nvidiaSmiAvailable,
            devices: nvidia.gpus,
            error: nvidia.error,
        },
        cuda: {
            // Only claim CUDA if nvidia-smi reported a version (trusted probe)
            available: Boolean(nvidia.cudaVersion),
            version: nvidia.cudaVersion || null,
        },
        onnx: {
            probed: false,
            available: false,
            providers: [],
            error: null,
        },
        detectedAt: new Date().toISOString(),
    };

    if (opts.probeOnnx) {
        try {
            let cmd = opts.pythonCmd;
            if (!cmd) {
                try {
                    const paths = require('./paths.cjs');
                    cmd = paths.resolvePythonCmd().cmd;
                } catch (_) {
                    cmd = null;
                }
            }
            const onnx = probeOnnxProviders(cmd);
            profile.onnx = { probed: true, ...onnx };
        } catch (e) {
            profile.onnx = { probed: true, available: false, providers: [], error: e.message };
        }
    }

    return profile;
}

module.exports = {
    detectHardware,
    detectNvidia,
    parseNvidiaSmi,
    probeOnnxProviders,
};
