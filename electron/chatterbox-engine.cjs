/**
 * Chatterbox engine — Nano + Turbo via shared isolated PyTorch worker.
 * Switching variant stops the worker (unload / free VRAM) then re-inits.
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
} = require('./chatterbox-package.cjs');

const WORKER_SCRIPT = paths.getWorkerScript(path.join('engines', 'chatterbox', 'worker.py'));

function synthesizeTimeoutMs(text) {
    const len = String(text || '').length;
    return Math.max(120000, Math.min(1200000, len * 120 + 90000));
}

function workerEnv() {
    const site = sitePackagesDir();
    const base = paths.buildWorkerEnv({
        KHEPREE_CHATTERBOX_SITE: site,
        HF_HUB_OFFLINE: '1',
        TRANSFORMERS_OFFLINE: '1',
    });
    const parts = [];
    if (fs.existsSync(site)) parts.push(site);
    if (base.PYTHONPATH) parts.push(base.PYTHONPATH);
    if (parts.length) base.PYTHONPATH = parts.join(path.delimiter);
    return base;
}

class ChatterboxEngine {
    constructor() {
        this.proc = null;
        this.buffer = '';
        this.pending = [];
        this.ready = false;
        this.mode = null;
        this.variant = null;
        this.modelDir = null;
        this.expressionTags = [];
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
                'Chatterbox runtime chưa cài (isolated). Không nằm trong core Khepree.'
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
            console.error('[Chatterbox stderr]', chunk.trim());
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
                        ? `Chatterbox worker không phản hồi: ${hint.slice(0, 400)}`
                        : 'Chatterbox worker không phản hồi'
                ));
            }, 30000);
            this.proc.once('error', (err) => {
                fail(new Error(`Không chạy được Python: ${err.message}`));
            });
            this.proc.once('exit', (code) => {
                if (code !== 0 && code !== null) {
                    const hint = this.stderrBuf.trim();
                    fail(new Error(
                        hint
                            ? `Chatterbox worker thoát sớm (code ${code}): ${hint.slice(0, 400)}`
                            : `Chatterbox worker thoát sớm (code ${code})`
                    ));
                }
            });
            this._request({ cmd: 'ping' }, 20000)
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
            if (msg.ok === false) handlers.reject(new Error(msg.error || 'Lỗi Chatterbox'));
            else handlers.resolve(msg);
        }
    }

    _request(payload, timeoutMs = 600000) {
        return new Promise((resolve, reject) => {
            if (!this.proc || !this.proc.stdin.writable) {
                reject(new Error('Chatterbox worker chưa chạy'));
                return;
            }
            const handlers = { resolve, reject, timer: null };
            handlers.timer = setTimeout(() => {
                const idx = this.pending.indexOf(handlers);
                if (idx >= 0) this.pending.splice(idx, 1);
                reject(new Error('Timeout Chatterbox'));
            }, timeoutMs);
            this.pending.push(handlers);
            this.proc.stdin.write(`${JSON.stringify(payload)}\n`);
        });
    }

    /**
     * @param {string|null} _mode ignored
     * @param {string} [pythonPath]
     * @param {{ modelDir?: string, variant?: string, device?: string }} [engineOptions]
     */
    async init(_mode, pythonPath, engineOptions = {}) {
        const run = async () => {
            const modelDir = engineOptions.modelDir || this.modelDir;
            const nextVariant = engineOptions.variant || this.variant || 'nano';
            if (!modelDir) {
                throw new Error(
                    'Chatterbox chưa được cài. Cài variant (Nano hoặc Turbo) trước khi Generate.'
                );
            }
            // Variant switch must kill worker so Torch/VRAM does not leak across Nano↔Turbo.
            if (this.proc && this.variant && this.variant !== nextVariant) {
                this.stop();
            }
            if (!this.proc) await this.start(pythonPath);

            const res = await this._request({
                cmd: 'init',
                model_dir: modelDir,
                variant: nextVariant,
                device: engineOptions.device || 'cpu',
            }, 600000);

            this.ready = true;
            this.modelDir = modelDir;
            this.variant = nextVariant;
            this.mode = res.mode || `chatterbox-${nextVariant}`;
            this.expressionTags = res.expression_tags || [];
            return {
                mode: this.mode,
                variant: this.variant,
                voices: res.voices || ['default'],
                sample_rate: res.sample_rate,
                languages: res.languages || ['en'],
                expression_tags: this.expressionTags,
                device: res.device,
            };
        };

        this._initChain = this._initChain.then(run, run);
        return this._initChain;
    }

    async listVoices() {
        const res = await this._request({ cmd: 'list_voices' }, 60000);
        return res.voices || ['default'];
    }

    async listTags() {
        const res = await this._request({ cmd: 'list_tags' }, 30000);
        return res.tags || this.expressionTags || [];
    }

    async synthesize(text, voice, outputPath, options = {}) {
        const refCheck = validateLocalRefAudio(
            options.audio_prompt_path || options.ref_wav || null
        );
        if (!refCheck.ok) throw new Error(refCheck.error);
        const opts = { ...options };
        if (refCheck.path) opts.audio_prompt_path = refCheck.path;
        else {
            delete opts.audio_prompt_path;
            delete opts.ref_wav;
        }

        const res = await this._request({
            cmd: 'synthesize',
            text,
            voice: voice || 'default',
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
            this.expressionTags = [];
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
        this.expressionTags = [];
        this.pending = [];
        this.buffer = '';
        this._initChain = Promise.resolve();
    }
}

module.exports = { ChatterboxEngine, ENGINE_ID };
