const { spawn } = require('child_process');
const fs = require('fs');
const paths = require('./paths.cjs');

const WORKER_SCRIPT = paths.getWorkerScript('edge_tts_worker.py');

function synthesizeTimeoutMs(text) {
    const len = String(text || '').length;
    return Math.max(120000, Math.min(900000, len * 80 + 60000));
}

class EdgeTTSEngine {
    constructor() {
        this.proc = null;
        this.buffer = '';
        this.pending = [];
        this.stderrBuf = '';
        this.locale = null;
        this.ready = false;
        this.pythonCmd = null;
        this.pythonArgs = [];
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
            console.error('[EdgeTTS stderr]', chunk.trim());
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
                        ? `Edge worker không phản hồi: ${hint.slice(0, 400)}`
                        : 'Edge worker không phản hồi'
                ));
            }, 15000);
            this.proc.once('error', (err) => {
                fail(new Error(`Không chạy được Python: ${err.message}`));
            });
            this.proc.once('exit', (code) => {
                if (code !== 0 && code !== null) {
                    const hint = this.stderrBuf.trim();
                    fail(new Error(
                        hint
                            ? `Edge worker thoát sớm (code ${code}): ${hint.slice(0, 400)}`
                            : `Edge worker thoát sớm (code ${code})`
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
            if (msg.ok === false) handlers.reject(new Error(msg.error || 'Lỗi Edge TTS'));
            else handlers.resolve(msg);
        }
    }

    _request(payload, timeoutMs = 300000) {
        return new Promise((resolve, reject) => {
            if (!this.proc || !this.proc.stdin.writable) {
                reject(new Error('Edge worker chưa chạy'));
                return;
            }
            const handlers = { resolve, reject, timer: null };
            handlers.timer = setTimeout(() => {
                const idx = this.pending.indexOf(handlers);
                if (idx >= 0) {
                    this.pending.splice(idx, 1);
                }
                reject(new Error('Timeout Edge TTS'));
            }, timeoutMs);
            this.pending.push(handlers);
            this.proc.stdin.write(`${JSON.stringify(payload)}\n`);
        });
    }

    async init(voiceMode = 'vietnamese', pythonPath) {
        if (!this.proc) await this.start(pythonPath);
        const res = await this._request({ cmd: 'init', voice_mode: voiceMode }, 120000);
        this.locale = voiceMode;
        this.ready = true;
        return {
            voiceMode: res.voiceMode || voiceMode,
            voiceModes: res.voiceModes || [],
            voices: res.voices || [],
        };
    }

    async synthesize(text, voice, outputPath, options = {}) {
        const res = await this._request({
            cmd: 'synthesize',
            text,
            voice: voice || null,
            output_path: outputPath,
            options,
        }, synthesizeTimeoutMs(text));
        return res.path;
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
        this.locale = null;
        this.pending = [];
        this.buffer = '';
        this.stderrBuf = '';
    }
}

module.exports = { EdgeTTSEngine };
