/**
 * Qwen3-TTS 0.6B engine — isolated PyTorch via qwen-tts worker.
 * Variants: 0.6b-custom (preset speakers) · 0.6b-base (voice clone).
 * No VoiceDesign (1.7B-only upstream).
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const paths = require('./paths.cjs');
const {
    sitePackagesDir,
    isRuntimeInstalled,
    ENGINE_ID,
    validateLocalRefAudio,
    variantMeta,
} = require('./qwen3-package.cjs');

const WORKER_SCRIPT = paths.getWorkerScript(path.join('engines', 'qwen3', 'worker.py'));

function synthesizeTimeoutMs(text) {
    const len = String(text || '').length;
    return Math.max(180000, Math.min(1800000, len * 150 + 120000));
}

function workerEnv() {
    const site = sitePackagesDir();
    const base = paths.buildWorkerEnv({
        KHEPREE_QWEN3_SITE: site,
        HF_HUB_OFFLINE: '1',
        TRANSFORMERS_OFFLINE: '1',
    });
    const parts = [];
    if (fs.existsSync(site)) parts.push(site);
    if (base.PYTHONPATH) parts.push(base.PYTHONPATH);
    if (parts.length) base.PYTHONPATH = parts.join(path.delimiter);
    return base;
}

class Qwen3Engine {
    constructor() {
        this.proc = null;
        this.buffer = '';
        this.pending = [];
        this.ready = false;
        this.mode = null;
        this.variant = null;
        this.modelDir = null;
        this.voices = [];
        this.languages = [];
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
        if (!isRuntimeInstalled()) {
            throw new Error(
                'Qwen3-TTS runtime chưa cài (isolated). Không nằm trong core Khepree.'
            );
        }
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
            env: workerEnv(),
        });

        this.proc.stdout.setEncoding('utf8');
        this.proc.stdout.on('data', (chunk) => this._onStdout(chunk));
        this.proc.stderr.setEncoding('utf8');
        this.proc.stderr.on('data', (chunk) => {
            this.stderrBuf += chunk;
            console.error('[Qwen3 stderr]', chunk.trim());
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
                        ? `Qwen3 worker không phản hồi: ${hint.slice(0, 400)}`
                        : 'Qwen3 worker không phản hồi'
                ));
            }, 60000);
            this.proc.once('error', (err) => {
                fail(new Error(`Không chạy được Python: ${err.message}`));
            });
            this.proc.once('exit', (code) => {
                if (code !== 0 && code !== null) {
                    const hint = this.stderrBuf.trim();
                    fail(new Error(
                        hint
                            ? `Qwen3 worker thoát sớm (code ${code}): ${hint.slice(0, 400)}`
                            : `Qwen3 worker thoát sớm (code ${code})`
                    ));
                }
            });
            this._request({ cmd: 'ping' }, 30000)
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
            if (msg.ok === false) handlers.reject(new Error(msg.error || 'Lỗi Qwen3-TTS'));
            else handlers.resolve(msg);
        }
    }

    _request(payload, timeoutMs = 600000) {
        return new Promise((resolve, reject) => {
            if (!this.proc || !this.proc.stdin.writable) {
                reject(new Error('Qwen3 worker chưa chạy'));
                return;
            }
            const handlers = { resolve, reject, timer: null };
            handlers.timer = setTimeout(() => {
                const idx = this.pending.indexOf(handlers);
                if (idx >= 0) this.pending.splice(idx, 1);
                reject(new Error('Timeout Qwen3-TTS'));
            }, timeoutMs);
            this.pending.push(handlers);
            this.proc.stdin.write(`${JSON.stringify(payload)}\n`);
        });
    }

    async init(_mode, pythonPath, engineOptions = {}) {
        const run = async () => {
            const modelDir = engineOptions.modelDir || this.modelDir;
            const nextVariant = engineOptions.variant || this.variant || '0.6b-custom';
            if (!modelDir) {
                throw new Error(
                    'Qwen3-TTS chưa được cài. Cài variant 0.6B (Custom hoặc Base) trước khi Generate.'
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
                device: engineOptions.device || 'cuda',
            }, 900000);

            this.ready = true;
            this.modelDir = modelDir;
            this.variant = nextVariant;
            this.mode = res.mode || `qwen3-${nextVariant}`;
            this.voices = res.voices || [];
            this.languages = res.languages || [];
            return {
                mode: this.mode,
                variant: this.variant,
                voices: this.voices,
                sample_rate: res.sample_rate,
                languages: this.languages,
                device: res.device,
                capabilities: res.capabilities || {},
            };
        };

        this._initChain = this._initChain.then(run, run);
        return this._initChain;
    }

    async listVoices() {
        const res = await this._request({ cmd: 'list_voices' }, 60000);
        return res.voices || this.voices || [];
    }

    async listLanguages() {
        const res = await this._request({ cmd: 'list_languages' }, 30000);
        return res.languages || this.languages || [];
    }

    async synthesize(text, voice, outputPath, options = {}) {
        const meta = variantMeta(options.variant || this.variant || '0.6b-custom');
        const opts = { ...options };
        if (meta.voiceClone) {
            const refCheck = validateLocalRefAudio(
                options.ref_audio || options.audio_prompt_path || options.ref_wav || null,
                { required: true }
            );
            if (!refCheck.ok) throw new Error(refCheck.error);
            opts.ref_audio = refCheck.path;
        } else {
            delete opts.ref_audio;
            delete opts.audio_prompt_path;
            delete opts.ref_wav;
        }

        const res = await this._request({
            cmd: 'synthesize',
            text,
            voice: voice || opts.speaker || 'Vivian',
            output_path: outputPath,
            options: opts,
        }, synthesizeTimeoutMs(text));
        return res.path;
    }

    async reload(_mode, pythonPath, engineOptions = {}) {
        this.stop();
        return this.init(null, pythonPath, engineOptions);
    }

    stop() {
        if (!this.proc) {
            this.ready = false;
            this.variant = null;
            this.voices = [];
            this.languages = [];
            this.pending = [];
            this.buffer = '';
            this._initChain = Promise.resolve();
            return;
        }
        try {
            if (this.proc.stdin.writable) {
                this.proc.stdin.write(`${JSON.stringify({ cmd: 'shutdown' })}\n`);
            }
        } catch (_) { /* ignore */ }
        try { this.proc.kill(); } catch (_) { /* ignore */ }
        this.proc = null;
        this.ready = false;
        this.variant = null;
        this.voices = [];
        this.languages = [];
        this.pending = [];
        this.buffer = '';
        this._initChain = Promise.resolve();
    }
}

module.exports = { Qwen3Engine, ENGINE_ID };
