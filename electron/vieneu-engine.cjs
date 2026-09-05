const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const paths = require('./paths.cjs');

const WORKER_SCRIPT = paths.getWorkerScript('tts_worker.py');
const MODEL_CONFIG_PATH = path.join(paths.getModelsDir(), 'vieneu', 'model-config.json');

const VIENEU_MODES = [
    { id: 'v3turbo', name: 'VieNeu-TTS v3 Turbo (48 kHz)' },
    { id: 'v3nano', name: 'VieNeu-TTS v3 Nano (24 kHz)' },
];

function loadAvailableModes() {
    try {
        if (!fs.existsSync(MODEL_CONFIG_PATH)) return VIENEU_MODES;
        const cfg = JSON.parse(fs.readFileSync(MODEL_CONFIG_PATH, 'utf8'));
        const keys = cfg.modes ? Object.keys(cfg.modes) : [cfg.mode || 'v3turbo'];
        const available = VIENEU_MODES.filter((m) => keys.includes(m.id));
        return available.length ? available : VIENEU_MODES;
    } catch (_) {
        return VIENEU_MODES;
    }
}

function synthesizeTimeoutMs(text, speed = 1) {
    const len = String(text || '').length;
    const spd = Math.max(0.5, Math.min(2, Number(speed) || 1));
    const base = Math.max(180000, Math.min(3600000, len * 200 + 120000));
    return Math.round(base / spd);
}

class VieNeuEngine {
    constructor() {
        this.proc = null;
        this.buffer = '';
        this.pending = [];
        this.reqId = 0;
        this.mode = null;
        this.ready = false;
        this.pythonCmd = null;
        this.pythonArgs = [];
        this._initChain = Promise.resolve();
        this._initMode = null;
    }

    listModes() {
        return loadAvailableModes();
    }

    resolvePythonCmd(customPath) {
        return paths.resolvePythonCmd(customPath);
    }

    async start(pythonPath) {
        if (this.proc) return;
        const resolved = this.resolvePythonCmd(pythonPath);
        this.pythonCmd = resolved.cmd;
        this.pythonArgs = resolved.args;

        if (!fs.existsSync(WORKER_SCRIPT)) {
            throw new Error(`Không tìm thấy ${WORKER_SCRIPT}`);
        }

        const args = [...this.pythonArgs, WORKER_SCRIPT];

        this.proc = spawn(this.pythonCmd, args, {
            cwd: paths.getAppRoot(),
            stdio: ['pipe', 'pipe', 'pipe'],
            env: paths.buildWorkerEnv(),
        });

        this.proc.stdout.setEncoding('utf8');
        this.proc.stdout.on('data', (chunk) => this._onStdout(chunk));
        this.proc.stderr.setEncoding('utf8');
        this.proc.stderr.on('data', (chunk) => {
            console.error('[VieNeu stderr]', chunk.trim());
        });

        await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('Python worker không phản hồi')), 15000);
            this.proc.once('error', (err) => {
                clearTimeout(timer);
                reject(new Error(
                    `Không chạy được Python (${this.pythonCmd}): ${err.message}. `
                    + 'Cài: py -3 -m pip install -r python/requirements.txt'
                ));
            });
            this.proc.once('exit', (code) => {
                clearTimeout(timer);
                if (code !== 0 && code !== null) {
                    reject(new Error(`Python worker thoát sớm (code ${code})`));
                }
            });
            this._request({ cmd: 'ping' }, 15000)
                .then(() => { clearTimeout(timer); resolve(); })
                .catch(reject);
        });
    }

    _onStdout(chunk) {
        this.buffer += chunk;
        const lines = this.buffer.split('\n');
        this.buffer = lines.pop() || '';
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            let msg;
            try {
                msg = JSON.parse(trimmed);
            } catch (_) {
                continue;
            }
            const handlers = this.pending.shift();
            if (!handlers) continue;
            clearTimeout(handlers.timer);
            if (msg.ok === false) handlers.reject(new Error(msg.error || 'Lỗi VieNeu-TTS'));
            else handlers.resolve(msg);
        }
    }

    _request(payload, timeoutMs = 600000) {
        return new Promise((resolve, reject) => {
            if (!this.proc || !this.proc.stdin.writable) {
                reject(new Error('Python worker chưa chạy'));
                return;
            }
            const handlers = { resolve, reject, timer: null };
            handlers.timer = setTimeout(() => {
                const idx = this.pending.indexOf(handlers);
                if (idx >= 0) this.pending.splice(idx, 1);
                reject(new Error('Timeout VieNeu-TTS'));
            }, timeoutMs);
            this.pending.push(handlers);
            this.proc.stdin.write(`${JSON.stringify(payload)}\n`);
        });
    }

    async init(mode = 'v3turbo', pythonPath, engineOptions = {}) {
        const run = async () => {
            if (this.ready && this.mode === mode && this.proc) {
                const res = await this._request({
                    cmd: 'init',
                    mode,
                    engine_options: engineOptions,
                }, 600000);
                return { mode: res.mode || mode, voices: res.voices || [] };
            }

            if (this.proc && this.mode && this.mode !== mode) {
                await this.restartWorker(pythonPath);
            } else if (!this.proc) {
                await this.start(pythonPath);
            }

            const res = await this._request({
                cmd: 'init',
                mode,
                engine_options: engineOptions,
            }, 600000);
            this.mode = mode;
            this.ready = true;
            this._initMode = mode;
            return { mode: res.mode || mode, voices: res.voices || [] };
        };

        this._initChain = this._initChain.then(run, run);
        return this._initChain;
    }

    async restartWorker(pythonPath) {
        if (!this.proc) return;
        try {
            if (this.proc.stdin.writable) {
                this.proc.stdin.write(`${JSON.stringify({ cmd: 'shutdown' })}\n`);
            }
        } catch (_) { /* ignore */ }
        try { this.proc.kill(); } catch (_) { /* ignore */ }
        this.proc = null;
        this.ready = false;
        this.mode = null;
        this.pending = [];
        this.buffer = '';
        await this.start(pythonPath);
    }

    async listVoices() {
        const res = await this._request({ cmd: 'list_voices' }, 60000);
        return res.voices || [];
    }

    async synthesize(text, voice, outputPath, options = {}) {
        const speed = options?.speed || 1;
        const res = await this._request({
            cmd: 'synthesize',
            text,
            voice: voice || null,
            output_path: outputPath,
            options,
        }, synthesizeTimeoutMs(text, speed));
        return res.path;
    }

    async reload(mode = 'v3turbo', pythonPath, engineOptions = {}) {
        this.stop();
        return this.init(mode, pythonPath, engineOptions);
    }

    stop() {
        if (!this.proc) return;
        try {
            if (this.proc.stdin.writable) {
                this.proc.stdin.write(`${JSON.stringify({ cmd: 'shutdown' })}\n`);
            }
        } catch (_) { /* ignore */ }
        try { this.proc.kill(); } catch (_) { /* ignore */ }
        this.proc = null;
        this.ready = false;
        this.mode = null;
        this._initMode = null;
        this.pending = [];
        this.buffer = '';
        this._initChain = Promise.resolve();
    }
}

module.exports = { VieNeuEngine, VIENEU_MODES, loadAvailableModes };
