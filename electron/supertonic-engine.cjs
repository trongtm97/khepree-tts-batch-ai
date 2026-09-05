/**
 * Supertonic 3 engine — ONNX CPU via python/engines/supertonic/worker.py
 * Model lives in user storage; never downloads during synthesize.
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const paths = require('./paths.cjs');

const WORKER_SCRIPT = paths.getWorkerScript(path.join('engines', 'supertonic', 'worker.py'));

function synthesizeTimeoutMs(text, speed = 1) {
    const len = String(text || '').length;
    const spd = Math.max(0.7, Math.min(2, Number(speed) || 1));
    const base = Math.max(120000, Math.min(1800000, len * 120 + 90000));
    return Math.round(base / spd);
}

class SupertonicEngine {
    constructor() {
        this.proc = null;
        this.buffer = '';
        this.pending = [];
        this.ready = false;
        this.mode = 'supertonic-3';
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
        // Inference env (HF offline OK) — model already on disk; no download here.
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
            console.error('[Supertonic stderr]', chunk.trim());
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
                        ? `Supertonic worker không phản hồi: ${hint.slice(0, 400)}`
                        : 'Supertonic worker không phản hồi'
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
                            ? `Supertonic worker thoát sớm (code ${code}): ${hint.slice(0, 400)}`
                            : `Supertonic worker thoát sớm (code ${code})`
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
            if (msg.ok === false) handlers.reject(new Error(msg.error || 'Lỗi Supertonic'));
            else handlers.resolve(msg);
        }
    }

    _request(payload, timeoutMs = 600000) {
        return new Promise((resolve, reject) => {
            if (!this.proc || !this.proc.stdin.writable) {
                reject(new Error('Supertonic worker chưa chạy'));
                return;
            }
            const handlers = { resolve, reject, timer: null };
            handlers.timer = setTimeout(() => {
                const idx = this.pending.indexOf(handlers);
                if (idx >= 0) this.pending.splice(idx, 1);
                reject(new Error('Timeout Supertonic'));
            }, timeoutMs);
            this.pending.push(handlers);
            this.proc.stdin.write(`${JSON.stringify(payload)}\n`);
        });
    }

    /**
     * @param {string|null} _mode ignored (always supertonic-3)
     * @param {string} [pythonPath]
     * @param {{ modelDir?: string, threads?: number }} [engineOptions]
     */
    async init(_mode, pythonPath, engineOptions = {}) {
        const run = async () => {
            const modelDir = engineOptions.modelDir || this.modelDir;
            if (!modelDir) {
                throw new Error(
                    'Supertonic chưa được cài. Mở Đổi engine → Cài Supertonic 3 trước khi Generate.'
                );
            }
            if (!this.proc) await this.start(pythonPath);

            const res = await this._request({
                cmd: 'init',
                model_dir: modelDir,
                threads: engineOptions.threads,
            }, 600000);

            this.ready = true;
            this.modelDir = modelDir;
            this.mode = res.mode || 'supertonic-3';
            return {
                mode: this.mode,
                voices: res.voices || [],
                sample_rate: res.sample_rate,
                languages: res.languages || [],
            };
        };

        this._initChain = this._initChain.then(run, run);
        return this._initChain;
    }

    async listVoices() {
        const res = await this._request({ cmd: 'list_voices' }, 60000);
        return res.voices || [];
    }

    async getInfo() {
        return this._request({ cmd: 'get_info' }, 15000);
    }

    async synthesize(text, voice, outputPath, options = {}) {
        const speed = options?.speed || 1.05;
        const res = await this._request({
            cmd: 'synthesize',
            text,
            voice: voice || 'M1',
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
        this.pending = [];
        this.buffer = '';
        this._initChain = Promise.resolve();
    }
}

module.exports = { SupertonicEngine };
