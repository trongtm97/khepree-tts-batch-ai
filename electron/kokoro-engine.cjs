/**
 * Kokoro engine — ONNX CPU via python/engines/kokoro/worker.py (kokoro-onnx).
 * Variants: int8 (default) | fp32. See docs/engines/kokoro.md.
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const paths = require('./paths.cjs');

const WORKER_SCRIPT = paths.getWorkerScript(path.join('engines', 'kokoro', 'worker.py'));

function synthesizeTimeoutMs(text, speed = 1) {
    const len = String(text || '').length;
    const spd = Math.max(0.5, Math.min(2, Number(speed) || 1));
    const base = Math.max(90000, Math.min(900000, len * 80 + 60000));
    return Math.round(base / spd);
}

class KokoroEngine {
    constructor() {
        this.proc = null;
        this.buffer = '';
        this.pending = [];
        this.ready = false;
        this.mode = null;
        this.variant = null;
        this.modelDir = null;
        this.pythonCmd = null;
        this.pythonArgs = [];
        this._initChain = Promise.resolve();
        this.stderrBuf = '';
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

        this.stderrBuf = '';
        this.proc = spawn(this.pythonCmd, [...this.pythonArgs, WORKER_SCRIPT], {
            cwd: paths.getAppRoot(),
            stdio: ['pipe', 'pipe', 'pipe'],
            env: paths.buildWorkerEnv(),
        });

        this.proc.stdout.setEncoding('utf8');
        this.proc.stdout.on('data', (chunk) => this._onStdout(chunk));
        this.proc.stderr.setEncoding('utf8');
        this.proc.stderr.on('data', (chunk) => {
            this.stderrBuf += chunk;
            console.error('[Kokoro stderr]', chunk.trim());
        });

        await new Promise((resolve, reject) => {
            const fail = (err) => {
                clearTimeout(timer);
                reject(err);
            };
            const timer = setTimeout(() => {
                const hint = this.stderrBuf.trim();
                fail(new Error(
                    hint
                        ? `Kokoro worker không phản hồi: ${hint.slice(0, 400)}`
                        : 'Kokoro worker không phản hồi'
                ));
            }, 20000);
            this.proc.once('error', (err) => {
                fail(new Error(`Không chạy được Python: ${err.message}`));
            });
            this.proc.once('exit', (code) => {
                if (code !== 0 && code !== null) {
                    const hint = this.stderrBuf.trim();
                    fail(new Error(
                        hint
                            ? `Kokoro worker thoát sớm (code ${code}): ${hint.slice(0, 400)}`
                            : `Kokoro worker thoát sớm (code ${code})`
                    ));
                }
            });
            this._request({ cmd: 'ping' }, 15000)
                .then(() => { clearTimeout(timer); resolve(); })
                .catch(fail);
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
            if (msg.ok === false) handlers.reject(new Error(msg.error || 'Lỗi Kokoro'));
            else handlers.resolve(msg);
        }
    }

    _request(payload, timeoutMs = 600000) {
        return new Promise((resolve, reject) => {
            if (!this.proc || !this.proc.stdin.writable) {
                reject(new Error('Kokoro worker chưa chạy'));
                return;
            }
            const handlers = { resolve, reject, timer: null };
            handlers.timer = setTimeout(() => {
                const idx = this.pending.indexOf(handlers);
                if (idx >= 0) this.pending.splice(idx, 1);
                reject(new Error('Timeout Kokoro'));
            }, timeoutMs);
            this.pending.push(handlers);
            this.proc.stdin.write(`${JSON.stringify(payload)}\n`);
        });
    }

    /**
     * @param {string|null} _mode ignored
     * @param {string} [pythonPath]
     * @param {{ modelDir?: string, variant?: string }} [engineOptions]
     */
    async init(_mode, pythonPath, engineOptions = {}) {
        const run = async () => {
            const modelDir = engineOptions.modelDir || this.modelDir;
            const nextVariant = engineOptions.variant || this.variant || 'int8';
            if (!modelDir) {
                throw new Error(
                    'Kokoro chưa được cài. Đổi engine → Cài variant (INT8/FP32) trước khi Generate.'
                );
            }
            if (this.proc && this.variant && this.variant !== nextVariant) {
                this.stop();
            }
            if (!this.proc) await this.start(pythonPath);

            const res = await this._request({
                cmd: 'init',
                model_dir: modelDir,
                variant: nextVariant,
            }, 300000);

            this.ready = true;
            this.modelDir = modelDir;
            this.variant = nextVariant;
            this.mode = res.mode || `kokoro-${nextVariant}`;
            return {
                mode: this.mode,
                variant: this.variant,
                voices: res.voices || [],
                sample_rate: res.sample_rate,
                languages: res.languages || ['en'],
            };
        };

        this._initChain = this._initChain.then(run, run);
        return this._initChain;
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
            voice: voice || 'af_heart',
            output_path: outputPath,
            options,
        }, synthesizeTimeoutMs(text, speed));
        return res.path;
    }

    async reload(_mode, pythonPath, engineOptions = {}) {
        this.stop();
        return this.init(null, pythonPath, engineOptions);
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
        this.variant = null;
        this.pending = [];
        this.buffer = '';
        this._initChain = Promise.resolve();
    }
}

module.exports = { KokoroEngine };
