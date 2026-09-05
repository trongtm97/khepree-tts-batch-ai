/**
 * GPT-SoVITS Voice Lab engine — inference adapter over TTS_infer_pack.TTS.
 * No Gradio WebUI. No training.
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const paths = require('./paths.cjs');
const {
    sitePackagesDir,
    upstreamDir,
    isRuntimeInstalled,
    ENGINE_ID,
    validateLocalRefAudio,
    validateCheckpoint,
} = require('./gpt-sovits-package.cjs');

const WORKER_SCRIPT = paths.getWorkerScript(path.join('engines', 'gpt_sovits', 'worker.py'));

function synthesizeTimeoutMs(text) {
    const len = String(text || '').length;
    return Math.max(180000, Math.min(1800000, len * 200 + 180000));
}

function workerEnv() {
    const site = sitePackagesDir();
    const upstream = upstreamDir();
    const base = paths.buildWorkerEnv({
        KHEPREE_GPT_SOVITS_SITE: site,
        KHEPREE_GPT_SOVITS_SRC: upstream,
    });
    const parts = [];
    if (fs.existsSync(upstream)) parts.push(upstream);
    if (fs.existsSync(path.join(upstream, 'GPT_SoVITS'))) parts.push(path.join(upstream, 'GPT_SoVITS'));
    if (fs.existsSync(site)) parts.push(site);
    if (base.PYTHONPATH) parts.push(base.PYTHONPATH);
    if (parts.length) base.PYTHONPATH = parts.join(path.delimiter);
    return base;
}

class GptSovitsEngine {
    constructor() {
        this.proc = null;
        this.buffer = '';
        this.pending = [];
        this.ready = false;
        this.mode = null;
        this.languages = [];
        this.gptWeights = null;
        this.sovitsWeights = null;
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
                'GPT-SoVITS runtime chưa cài (Voice Lab / ISOLATED_PYTHON).'
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
            console.error('[GPT-SoVITS stderr]', chunk.trim());
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
                        ? `GPT-SoVITS worker không phản hồi: ${hint.slice(0, 400)}`
                        : 'GPT-SoVITS worker không phản hồi'
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
                            ? `GPT-SoVITS worker thoát sớm (code ${code}): ${hint.slice(0, 400)}`
                            : `GPT-SoVITS worker thoát sớm (code ${code})`
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
            if (msg.ok === false) handlers.reject(new Error(msg.error || 'Lỗi GPT-SoVITS'));
            else handlers.resolve(msg);
        }
    }

    _request(payload, timeoutMs = 600000) {
        return new Promise((resolve, reject) => {
            if (!this.proc || !this.proc.stdin.writable) {
                reject(new Error('GPT-SoVITS worker chưa chạy'));
                return;
            }
            const handlers = { resolve, reject, timer: null };
            handlers.timer = setTimeout(() => {
                const idx = this.pending.indexOf(handlers);
                if (idx >= 0) this.pending.splice(idx, 1);
                reject(new Error('Timeout GPT-SoVITS'));
            }, timeoutMs);
            this.pending.push(handlers);
            this.proc.stdin.write(`${JSON.stringify(payload)}\n`);
        });
    }

    async init(_mode, pythonPath, engineOptions = {}) {
        const run = async () => {
            const gpt = validateCheckpoint(
                engineOptions.gptWeights || engineOptions.gpt_weights || this.gptWeights,
                'GPT checkpoint'
            );
            if (!gpt.ok) throw new Error(gpt.error);
            const sovits = validateCheckpoint(
                engineOptions.sovitsWeights || engineOptions.sovits_weights || this.sovitsWeights,
                'SoVITS checkpoint'
            );
            if (!sovits.ok) throw new Error(sovits.error);

            if (!this.proc) await this.start(pythonPath);

            const res = await this._request({
                cmd: 'init',
                gpt_weights: gpt.path,
                sovits_weights: sovits.path,
                device: engineOptions.device || 'cuda',
                is_half: engineOptions.is_half,
            }, 900000);

            this.ready = true;
            this.gptWeights = gpt.path;
            this.sovitsWeights = sovits.path;
            this.mode = res.mode || 'gpt-sovits-infer';
            this.languages = res.languages || [];
            return {
                mode: this.mode,
                voices: res.voices || ['clone'],
                sample_rate: res.sample_rate,
                languages: this.languages,
                device: res.device,
                capabilities: res.capabilities || {},
            };
        };

        this._initChain = this._initChain.then(run, run);
        return this._initChain;
    }

    async synthesize(text, voice, outputPath, options = {}) {
        const refCheck = validateLocalRefAudio(
            options.ref_audio || options.ref_audio_path || null,
            { required: true }
        );
        if (!refCheck.ok) throw new Error(refCheck.error);

        const opts = {
            ...options,
            ref_audio: refCheck.path,
            prompt_text: options.prompt_text || options.ref_text || '',
            prompt_lang: options.prompt_lang || options.ref_lang || 'zh',
            text_lang: options.text_lang || options.language || options.lang || 'zh',
        };

        const res = await this._request({
            cmd: 'synthesize',
            text,
            voice: voice || 'clone',
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
            this.mode = null;
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
        this.mode = null;
        this.languages = [];
        this.pending = [];
        this.buffer = '';
        this._initChain = Promise.resolve();
    }
}

module.exports = { GptSovitsEngine, ENGINE_ID };
