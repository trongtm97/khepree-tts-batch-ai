/**
 * Generic engine IPC. Legacy tts:* / edge:* are thin wrappers over this layer.
 * Handlers never throw to the renderer — always { error } or success payload.
 */
const fs = require('fs');
const path = require('path');
const registry = require('./engine-registry.cjs');
const install = require('./engine-install.cjs');
const mdl = require('./model-download-manager.cjs');

function fail(error, code = 'ENGINE_ERROR') {
    const message = error instanceof Error ? error.message : String(error || 'Unknown error');
    return { ok: false, error: message, code };
}

function createEngineIpc({
    ipcMain,
    poolManager,
    getSettings,
    getEngineOptions,
    getSynthOptions,
    getEdgeSynthOptions,
    batchWorkerCount,
    requireKhepreeAccess,
    sendLog,
    tempDir,
}) {
    function poolSize() {
        return batchWorkerCount(getSettings());
    }

    function resolveEntry(engineId) {
        const entry = registry.getEngine(engineId);
        if (!entry?.EngineClass) return null;
        return entry;
    }

    async function engineInit(engineId, payload = {}) {
        const entry = resolveEntry(engineId);
        if (!entry) return fail(`Engine không khả dụng: ${engineId}`, 'ENGINE_UNKNOWN');
        if (!install.isInstalled(entry.id)) {
            return fail(`Engine chưa được cài: ${entry.displayName}`, 'ENGINE_NOT_INSTALLED');
        }

        const settings = getSettings();
        const pool = poolManager.getPool(entry.id, poolSize());

        if (entry.family === 'edge') {
            const mode = payload.voiceMode || settings.edgeVoiceMode || 'vietnamese';
            const result = await pool.withEngine((engine) =>
                engine.init(mode, payload.pythonPath || settings.pythonPath));
            sendLog?.(`Edge TTS sẵn sàng (${mode}) · ${pool.maxSize} worker`, 'success');
            return { ok: true, engineId: entry.id, ...result };
        }

        if (entry.family === 'supertonic') {
            let modelDir;
            try {
                modelDir = mdl.getInstallRoot(entry.id, entry.modelVariant || 'default');
            } catch (e) {
                return fail(e, 'ENGINE_MODEL_PATH');
            }
            const opts = {
                modelDir,
                threads: settings.threads ?? 6,
                ...(payload.engineOptions || {}),
            };
            const result = await pool.withEngine((engine) =>
                engine.init(null, payload.pythonPath || settings.pythonPath, opts));
            sendLog?.(`Supertonic 3 sẵn sàng · ${pool.maxSize} worker`, 'success');
            return { ok: true, engineId: entry.id, ...result };
        }

        if (entry.family === 'kitten') {
            const variant = payload.variant
                || payload.engineOptions?.variant
                || settings.kittenVariant
                || 'mini';
            if (mdl.getStatus(entry.id, variant) !== mdl.STATUS.INSTALLED) {
                return fail(
                    `Variant KittenTTS chưa cài: ${variant}. Cài Mini/Micro/Nano trong workspace trước.`,
                    'ENGINE_NOT_INSTALLED'
                );
            }
            let modelDir;
            try {
                modelDir = mdl.getInstallRoot(entry.id, variant);
            } catch (e) {
                return fail(e, 'ENGINE_MODEL_PATH');
            }
            const opts = { modelDir, variant, ...(payload.engineOptions || {}) };
            const result = await pool.withEngine((engine) =>
                engine.init(null, payload.pythonPath || settings.pythonPath, opts));
            sendLog?.(`KittenTTS (${variant}) sẵn sàng · ${pool.maxSize} worker`, 'success');
            return { ok: true, engineId: entry.id, ...result };
        }

        if (entry.family === 'kokoro') {
            const variant = payload.variant
                || payload.engineOptions?.variant
                || settings.kokoroVariant
                || entry.modelVariant
                || 'int8';
            if (mdl.getStatus(entry.id, variant) !== mdl.STATUS.INSTALLED) {
                return fail(
                    `Variant Kokoro chưa cài: ${variant}. Cài INT8/FP32 trong workspace trước.`,
                    'ENGINE_NOT_INSTALLED'
                );
            }
            let modelDir;
            try {
                modelDir = mdl.getInstallRoot(entry.id, variant);
            } catch (e) {
                return fail(e, 'ENGINE_MODEL_PATH');
            }
            const opts = { modelDir, variant, ...(payload.engineOptions || {}) };
            const result = await pool.withEngine((engine) =>
                engine.init(null, payload.pythonPath || settings.pythonPath, opts));
            sendLog?.(`Kokoro (${variant}) sẵn sàng · ${pool.maxSize} worker`, 'success');
            return { ok: true, engineId: entry.id, ...result };
        }

        if (entry.family === 'piper') {
            const piperPkg = require('./piper-package.cjs');
            if (!piperPkg.isRuntimeInstalled()) {
                return fail(
                    'Piper runtime chưa cài (optional GPLv3). Cài runtime trước — không nằm trong core.',
                    'ENGINE_RUNTIME_MISSING'
                );
            }
            const variant = payload.variant
                || payload.engineOptions?.variant
                || settings.piperVariant
                || entry.modelVariant
                || piperPkg.DEFAULT_VOICE;
            if (mdl.getStatus(entry.id, variant) !== mdl.STATUS.INSTALLED) {
                return fail(
                    `Piper voice chưa cài: ${variant}. Cài voice trong workspace trước.`,
                    'ENGINE_NOT_INSTALLED'
                );
            }
            let modelDir;
            try {
                modelDir = mdl.getInstallRoot(entry.id, variant);
            } catch (e) {
                return fail(e, 'ENGINE_MODEL_PATH');
            }
            const opts = { modelDir, variant, ...(payload.engineOptions || {}) };
            const result = await pool.withEngine((engine) =>
                engine.init(null, payload.pythonPath || settings.pythonPath, opts));
            sendLog?.(`Piper (${variant}) sẵn sàng · ${pool.maxSize} worker`, 'success');
            return { ok: true, engineId: entry.id, ...result };
        }

        if (entry.family === 'chatterbox') {
            const cbPkg = require('./chatterbox-package.cjs');
            if (!cbPkg.isRuntimeInstalled()) {
                return fail(
                    'Chatterbox runtime chưa cài (isolated PyTorch). Không nằm trong core.',
                    'ENGINE_RUNTIME_MISSING'
                );
            }
            const variant = payload.variant
                || payload.engineOptions?.variant
                || entry.modelVariant
                || 'nano';
            if (mdl.getStatus(entry.id, variant) !== mdl.STATUS.INSTALLED) {
                return fail(
                    `Chatterbox model chưa cài: ${variant}. Cài variant Nano hoặc Turbo trong app trước.`,
                    'ENGINE_NOT_INSTALLED'
                );
            }
            let modelDir;
            try {
                modelDir = mdl.getInstallRoot(entry.id, variant);
            } catch (e) {
                return fail(e, 'ENGINE_MODEL_PATH');
            }
            const opts = {
                modelDir,
                variant,
                device: payload.device || payload.engineOptions?.device || settings.device || 'cpu',
                ...(payload.engineOptions || {}),
            };
            const result = await pool.withEngine((engine) =>
                engine.init(null, payload.pythonPath || settings.pythonPath, opts));
            sendLog?.(`Chatterbox ${variant} sẵn sàng · ${pool.maxSize} worker`, 'success');
            return { ok: true, engineId: entry.id, ...result };
        }

        if (entry.family === 'qwen3') {
            const qwenPkg = require('./qwen3-package.cjs');
            if (!qwenPkg.isRuntimeInstalled()) {
                return fail(
                    'Qwen3-TTS runtime chưa cài (isolated PyTorch). Không nằm trong core.',
                    'ENGINE_RUNTIME_MISSING'
                );
            }
            const variant = payload.variant
                || payload.engineOptions?.variant
                || settings.qwen3Variant
                || entry.modelVariant
                || '0.6b-custom';
            if (mdl.getStatus(entry.id, variant) !== mdl.STATUS.INSTALLED) {
                return fail(
                    `Qwen3-TTS model chưa cài: ${variant}. Cài 0.6B Custom hoặc Base trong app trước.`,
                    'ENGINE_NOT_INSTALLED'
                );
            }
            let modelDir;
            try {
                modelDir = mdl.getInstallRoot(entry.id, variant);
            } catch (e) {
                return fail(e, 'ENGINE_MODEL_PATH');
            }
            const opts = {
                modelDir,
                variant,
                device: payload.device || payload.engineOptions?.device || settings.device || 'cuda',
                ...(payload.engineOptions || {}),
            };
            const result = await pool.withEngine((engine) =>
                engine.init(null, payload.pythonPath || settings.pythonPath, opts));
            sendLog?.(`Qwen3-TTS ${variant} sẵn sàng · ${pool.maxSize} worker`, 'success');
            return { ok: true, engineId: entry.id, ...result };
        }

        if (entry.family === 'spark') {
            const sparkPkg = require('./spark-package.cjs');
            if (!sparkPkg.isRuntimeInstalled()) {
                return fail(
                    'Spark-TTS runtime chưa cài (isolated PyTorch). Không Conda / không Gradio.',
                    'ENGINE_RUNTIME_MISSING'
                );
            }
            const variant = payload.variant
                || payload.engineOptions?.variant
                || entry.modelVariant
                || sparkPkg.VARIANT;
            if (mdl.getStatus(entry.id, variant) !== mdl.STATUS.INSTALLED) {
                return fail(
                    'Spark-TTS 0.5B chưa cài. Cài model trong app trước.',
                    'ENGINE_NOT_INSTALLED'
                );
            }
            let modelDir;
            try {
                modelDir = mdl.getInstallRoot(entry.id, variant);
            } catch (e) {
                return fail(e, 'ENGINE_MODEL_PATH');
            }
            const opts = {
                modelDir,
                variant,
                device: payload.device || payload.engineOptions?.device || settings.device || 'cuda',
                ...(payload.engineOptions || {}),
            };
            const result = await pool.withEngine((engine) =>
                engine.init(null, payload.pythonPath || settings.pythonPath, opts));
            sendLog?.(`Spark-TTS 0.5B sẵn sàng · ${pool.maxSize} worker`, 'success');
            return { ok: true, engineId: entry.id, ...result };
        }

        if (entry.family === 'gpt-sovits') {
            const gsvPkg = require('./gpt-sovits-package.cjs');
            if (!gsvPkg.isRuntimeInstalled()) {
                return fail(
                    'GPT-SoVITS Voice Lab runtime chưa cài (ISOLATED_PYTHON). Không Gradio / không training.',
                    'ENGINE_RUNTIME_MISSING'
                );
            }
            if (!gsvPkg.isModelInstalled()) {
                return fail(
                    'GPT-SoVITS chưa cài. Cài Voice Lab runtime trước, rồi chọn GPT + SoVITS checkpoint.',
                    'ENGINE_NOT_INSTALLED'
                );
            }
            const gptWeights = payload.gptWeights
                || payload.engineOptions?.gptWeights
                || payload.engineOptions?.gpt_weights
                || settings.gptSovitsGptCkpt;
            const sovitsWeights = payload.sovitsWeights
                || payload.engineOptions?.sovitsWeights
                || payload.engineOptions?.sovits_weights
                || settings.gptSovitsSovitsCkpt;
            const gptCheck = gsvPkg.validateCheckpoint(gptWeights, 'GPT checkpoint');
            if (!gptCheck.ok) return fail(gptCheck.error, 'ENGINE_CKPT_INVALID');
            const sovitsCheck = gsvPkg.validateCheckpoint(sovitsWeights, 'SoVITS checkpoint');
            if (!sovitsCheck.ok) return fail(sovitsCheck.error, 'ENGINE_CKPT_INVALID');
            const opts = {
                gptWeights: gptCheck.path,
                sovitsWeights: sovitsCheck.path,
                device: payload.device || payload.engineOptions?.device || settings.device || 'cuda',
                ...(payload.engineOptions || {}),
            };
            const result = await pool.withEngine((engine) =>
                engine.init(null, payload.pythonPath || settings.pythonPath, opts));
            sendLog?.(`GPT-SoVITS (Voice Lab) sẵn sàng · ${pool.maxSize} worker`, 'success');
            return { ok: true, engineId: entry.id, ...result };
        }

        const targetMode = payload.mode || entry.mode || entry.workerMode || 'v3turbo';
        const opts = payload.engineOptions || getEngineOptions(settings);
        const result = await pool.withEngine((engine) =>
            engine.init(targetMode, settings.pythonPath, opts));
        sendLog?.(`VieNeu-TTS sẵn sàng: ${result.mode} · ${pool.maxSize} worker`, 'success');
        return { ok: true, engineId: entry.id, ...result };
    }

    async function engineSynthesize(engineId, { text, voice, options } = {}) {
        const denied = requireKhepreeAccess();
        if (denied) {
            return {
                ok: false,
                error: denied.error || 'KHEPREE_ACCESS_REQUIRED',
                code: denied.code || 'KHEPREE_ACCESS_REQUIRED',
            };
        }

        const entry = resolveEntry(engineId);
        if (!entry) return fail(`Engine không khả dụng: ${engineId}`, 'ENGINE_UNKNOWN');

        try {
            if (!text || !String(text).trim()) {
                return fail('Thiếu text để synthesize', 'ENGINE_BAD_REQUEST');
            }
            if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

            const settings = getSettings();
            const pool = poolManager.getPool(entry.id, poolSize());
            const ext = entry.outputFormat || 'wav';
            const tempFile = path.join(
                tempDir,
                `tts_${entry.id}_${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`
            );

            if (entry.family === 'edge') {
                const mode = options?.edgeVoiceMode || settings.edgeVoiceMode || 'vietnamese';
                const synthOpts = { ...getEdgeSynthOptions(settings), ...(options || {}) };
                const outPath = await pool.withEngine(async (engine) => {
                    if (!engine.ready) {
                        await engine.init(mode, settings.pythonPath);
                    }
                    return engine.synthesize(text, voice, tempFile, synthOpts);
                });
                const buffer = fs.readFileSync(outPath);
                try { fs.unlinkSync(outPath); } catch (_) { /* ignore */ }
                return { ok: true, engineId: entry.id, buffer, format: 'mp3' };
            }

            if (entry.family === 'supertonic') {
                const modelDir = mdl.getInstallRoot(entry.id, entry.modelVariant || 'default');
                const synthOpts = {
                    lang: options?.lang || settings.supertonicLang || 'vi',
                    speed: options?.speed ?? settings.supertonicSpeed ?? settings.speed ?? 1.05,
                    total_steps: options?.total_steps ?? settings.supertonicSteps ?? 8,
                    silence_duration: options?.silence_duration ?? 0.3,
                    max_chunk_length: options?.max_chunk_length,
                    // Explicit: never VieNeu sea-g2p
                };
                const outPath = await pool.withEngine(async (engine) => {
                    if (!engine.ready) {
                        await engine.init(null, settings.pythonPath, {
                            modelDir,
                            threads: settings.threads ?? 6,
                        });
                    }
                    return engine.synthesize(text, voice || settings.supertonicVoice || 'M1', tempFile, synthOpts);
                });
                const buffer = fs.readFileSync(outPath);
                try { fs.unlinkSync(outPath); } catch (_) { /* ignore */ }
                return { ok: true, engineId: entry.id, buffer, format: 'wav' };
            }

            if (entry.family === 'kitten') {
                const variant = options?.variant || settings.kittenVariant || 'mini';
                if (mdl.getStatus(entry.id, variant) !== mdl.STATUS.INSTALLED) {
                    return fail(`Variant KittenTTS chưa cài: ${variant}`, 'ENGINE_NOT_INSTALLED');
                }
                const modelDir = mdl.getInstallRoot(entry.id, variant);
                const synthOpts = {
                    speed: options?.speed ?? settings.kittenSpeed ?? 1.0,
                    clean_text: options?.clean_text !== false,
                    variant,
                };
                const outPath = await pool.withEngine(async (engine) => {
                    if (!engine.ready || engine.variant !== variant) {
                        await engine.init(null, settings.pythonPath, { modelDir, variant });
                    }
                    return engine.synthesize(
                        text,
                        voice || settings.kittenVoice || 'Bella',
                        tempFile,
                        synthOpts
                    );
                });
                const buffer = fs.readFileSync(outPath);
                try { fs.unlinkSync(outPath); } catch (_) { /* ignore */ }
                return { ok: true, engineId: entry.id, buffer, format: 'wav' };
            }

            if (entry.family === 'kokoro') {
                const variant = options?.variant || settings.kokoroVariant || entry.modelVariant || 'int8';
                if (mdl.getStatus(entry.id, variant) !== mdl.STATUS.INSTALLED) {
                    return fail(`Variant Kokoro chưa cài: ${variant}`, 'ENGINE_NOT_INSTALLED');
                }
                const modelDir = mdl.getInstallRoot(entry.id, variant);
                const synthOpts = {
                    speed: options?.speed ?? settings.kokoroSpeed ?? 1.0,
                    lang: options?.lang,
                    variant,
                };
                const outPath = await pool.withEngine(async (engine) => {
                    if (!engine.ready || engine.variant !== variant) {
                        await engine.init(null, settings.pythonPath, { modelDir, variant });
                    }
                    return engine.synthesize(
                        text,
                        voice || settings.kokoroVoice || 'af_heart',
                        tempFile,
                        synthOpts
                    );
                });
                const buffer = fs.readFileSync(outPath);
                try { fs.unlinkSync(outPath); } catch (_) { /* ignore */ }
                return { ok: true, engineId: entry.id, buffer, format: 'wav' };
            }

            if (entry.family === 'piper') {
                const piperPkg = require('./piper-package.cjs');
                if (!piperPkg.isRuntimeInstalled()) {
                    return fail('Piper runtime chưa cài', 'ENGINE_RUNTIME_MISSING');
                }
                const variant = options?.variant || settings.piperVariant || entry.modelVariant || piperPkg.DEFAULT_VOICE;
                if (mdl.getStatus(entry.id, variant) !== mdl.STATUS.INSTALLED) {
                    return fail(`Piper voice chưa cài: ${variant}`, 'ENGINE_NOT_INSTALLED');
                }
                const modelDir = mdl.getInstallRoot(entry.id, variant);
                const synthOpts = {
                    speed: options?.speed ?? settings.piperSpeed ?? 1.0,
                    variant,
                };
                const outPath = await pool.withEngine(async (engine) => {
                    if (!engine.ready || engine.variant !== variant) {
                        await engine.init(null, settings.pythonPath, { modelDir, variant });
                    }
                    return engine.synthesize(
                        text,
                        voice || settings.piperVoice || variant,
                        tempFile,
                        synthOpts
                    );
                });
                const buffer = fs.readFileSync(outPath);
                try { fs.unlinkSync(outPath); } catch (_) { /* ignore */ }
                return { ok: true, engineId: entry.id, buffer, format: 'wav' };
            }

            if (entry.family === 'chatterbox') {
                const cbPkg = require('./chatterbox-package.cjs');
                if (!cbPkg.isRuntimeInstalled()) {
                    return fail('Chatterbox runtime chưa cài', 'ENGINE_RUNTIME_MISSING');
                }
                const variant = options?.variant || entry.modelVariant || 'nano';
                if (mdl.getStatus(entry.id, variant) !== mdl.STATUS.INSTALLED) {
                    return fail(`Chatterbox model chưa cài: ${variant}`, 'ENGINE_NOT_INSTALLED');
                }
                const modelDir = mdl.getInstallRoot(entry.id, variant);
                const refRaw = options?.audio_prompt_path
                    || options?.ref_wav
                    || settings.chatterboxRef
                    || settings.chatterboxNanoRef
                    || null;
                const refCheck = cbPkg.validateLocalRefAudio(refRaw);
                if (!refCheck.ok) {
                    return fail(refCheck.error, 'ENGINE_REF_INVALID');
                }
                const synthOpts = {
                    variant,
                    audio_prompt_path: refCheck.path,
                    temperature: options?.temperature,
                    top_p: options?.top_p,
                    top_k: options?.top_k,
                    repetition_penalty: options?.repetition_penalty,
                    norm_loudness: options?.norm_loudness !== false,
                };
                const outPath = await pool.withEngine(async (engine) => {
                    if (!engine.ready || engine.variant !== variant) {
                        await engine.init(null, settings.pythonPath, {
                            modelDir,
                            variant,
                            device: settings.device || 'cpu',
                        });
                    }
                    return engine.synthesize(
                        text,
                        voice || 'default',
                        tempFile,
                        synthOpts
                    );
                });
                const buffer = fs.readFileSync(outPath);
                try { fs.unlinkSync(outPath); } catch (_) { /* ignore */ }
                return { ok: true, engineId: entry.id, buffer, format: 'wav' };
            }

            if (entry.family === 'qwen3') {
                const qwenPkg = require('./qwen3-package.cjs');
                if (!qwenPkg.isRuntimeInstalled()) {
                    return fail('Qwen3-TTS runtime chưa cài', 'ENGINE_RUNTIME_MISSING');
                }
                const variant = options?.variant
                    || settings.qwen3Variant
                    || entry.modelVariant
                    || '0.6b-custom';
                if (mdl.getStatus(entry.id, variant) !== mdl.STATUS.INSTALLED) {
                    return fail(`Qwen3-TTS model chưa cài: ${variant}`, 'ENGINE_NOT_INSTALLED');
                }
                const modelDir = mdl.getInstallRoot(entry.id, variant);
                const meta = qwenPkg.variantMeta(variant);
                const lang = options?.language || options?.lang || settings.qwen3Lang || 'Auto';
                const viWarn = qwenPkg.vietnameseWarningFor(lang, text);
                const allowUnsupported = Boolean(options?.allow_unsupported_lang)
                    || lang === 'Vietnamese';
                if (lang === 'Vietnamese' && !allowUnsupported) {
                    return fail(qwenPkg.VI_WARN, 'ENGINE_LANG_UNSUPPORTED');
                }
                let refPath = null;
                if (meta.voiceClone) {
                    const refCheck = qwenPkg.validateLocalRefAudio(
                        options?.ref_audio
                            || options?.audio_prompt_path
                            || options?.ref_wav
                            || settings.qwen3Ref
                            || null,
                        { required: true }
                    );
                    if (!refCheck.ok) return fail(refCheck.error, 'ENGINE_REF_INVALID');
                    refPath = refCheck.path;
                }
                const synthOpts = {
                    variant,
                    language: lang,
                    speaker: options?.speaker || voice || settings.qwen3Voice || 'Vivian',
                    instruct: options?.instruct || settings.qwen3Instruct || '',
                    ref_audio: refPath,
                    ref_text: options?.ref_text || settings.qwen3RefText || '',
                    x_vector_only_mode: options?.x_vector_only_mode,
                    allow_unsupported_lang: allowUnsupported,
                };
                const outPath = await pool.withEngine(async (engine) => {
                    if (!engine.ready || engine.variant !== variant) {
                        await engine.init(null, settings.pythonPath, {
                            modelDir,
                            variant,
                            device: settings.device || 'cuda',
                        });
                    }
                    return engine.synthesize(
                        text,
                        synthOpts.speaker,
                        tempFile,
                        synthOpts
                    );
                });
                const buffer = fs.readFileSync(outPath);
                try { fs.unlinkSync(outPath); } catch (_) { /* ignore */ }
                return {
                    ok: true,
                    engineId: entry.id,
                    buffer,
                    format: 'wav',
                    warning: viWarn || undefined,
                };
            }

            if (entry.family === 'spark') {
                const sparkPkg = require('./spark-package.cjs');
                if (!sparkPkg.isRuntimeInstalled()) {
                    return fail('Spark-TTS runtime chưa cài', 'ENGINE_RUNTIME_MISSING');
                }
                const variant = options?.variant || entry.modelVariant || sparkPkg.VARIANT;
                if (mdl.getStatus(entry.id, variant) !== mdl.STATUS.INSTALLED) {
                    return fail('Spark-TTS 0.5B chưa cài', 'ENGINE_NOT_INSTALLED');
                }
                const modelDir = mdl.getInstallRoot(entry.id, variant);
                const lang = options?.language || options?.lang || settings.sparkLang || 'Chinese';
                const sparkMode = options?.spark_mode
                    || options?.mode
                    || settings.sparkMode
                    || voice
                    || 'clone';
                const viWarn = sparkPkg.vietnameseWarningFor(lang, text);
                const allowUnsupported = Boolean(options?.allow_unsupported_lang)
                    || lang === 'Vietnamese';
                if (lang === 'Vietnamese' && !allowUnsupported) {
                    return fail(sparkPkg.VI_WARN, 'ENGINE_LANG_UNSUPPORTED');
                }
                let refPath = null;
                if (sparkMode === 'clone') {
                    const refCheck = sparkPkg.validateLocalRefAudio(
                        options?.ref_audio
                            || options?.prompt_speech_path
                            || options?.audio_prompt_path
                            || settings.sparkRef
                            || null,
                        { required: true }
                    );
                    if (!refCheck.ok) return fail(refCheck.error, 'ENGINE_REF_INVALID');
                    refPath = refCheck.path;
                }
                const synthOpts = {
                    variant,
                    language: lang,
                    spark_mode: sparkMode,
                    gender: options?.gender || settings.sparkGender || 'male',
                    pitch: options?.pitch || settings.sparkPitch || 'moderate',
                    speed: options?.speed || settings.sparkSpeedLevel || 'moderate',
                    ref_audio: refPath,
                    prompt_text: options?.prompt_text || options?.ref_text || settings.sparkRefText || '',
                    allow_unsupported_lang: allowUnsupported,
                };
                const outPath = await pool.withEngine(async (engine) => {
                    if (!engine.ready) {
                        await engine.init(null, settings.pythonPath, {
                            modelDir,
                            variant,
                            device: settings.device || 'cuda',
                        });
                    }
                    return engine.synthesize(text, sparkMode, tempFile, synthOpts);
                });
                const buffer = fs.readFileSync(outPath);
                try { fs.unlinkSync(outPath); } catch (_) { /* ignore */ }
                return {
                    ok: true,
                    engineId: entry.id,
                    buffer,
                    format: 'wav',
                    warning: viWarn || undefined,
                };
            }

            if (entry.family === 'gpt-sovits') {
                const gsvPkg = require('./gpt-sovits-package.cjs');
                if (!gsvPkg.isRuntimeInstalled()) {
                    return fail('GPT-SoVITS runtime chưa cài', 'ENGINE_RUNTIME_MISSING');
                }
                if (!gsvPkg.isModelInstalled()) {
                    return fail('GPT-SoVITS chưa cài', 'ENGINE_NOT_INSTALLED');
                }
                const textLang = options?.text_lang
                    || options?.language
                    || options?.lang
                    || settings.gptSovitsTextLang
                    || 'zh';
                const promptLang = options?.prompt_lang
                    || options?.ref_lang
                    || settings.gptSovitsRefLang
                    || textLang;
                const viWarn = gsvPkg.vietnameseWarningFor(textLang, text)
                    || gsvPkg.vietnameseWarningFor(promptLang, '');
                const allowUnsupported = Boolean(options?.allow_unsupported_lang)
                    || ['vi', 'vietnamese'].includes(String(textLang).toLowerCase())
                    || ['vi', 'vietnamese'].includes(String(promptLang).toLowerCase());
                if (
                    ['vi', 'vietnamese'].includes(String(textLang).toLowerCase())
                    && !allowUnsupported
                ) {
                    return fail(gsvPkg.VI_WARN, 'ENGINE_LANG_UNSUPPORTED');
                }
                const refCheck = gsvPkg.validateLocalRefAudio(
                    options?.ref_audio
                        || options?.ref_audio_path
                        || settings.gptSovitsRef
                        || null,
                    { required: true }
                );
                if (!refCheck.ok) return fail(refCheck.error, 'ENGINE_REF_INVALID');
                const gptCheck = gsvPkg.validateCheckpoint(
                    options?.gpt_weights
                        || options?.gpt_checkpoint
                        || settings.gptSovitsGptCkpt,
                    'GPT checkpoint'
                );
                if (!gptCheck.ok) return fail(gptCheck.error, 'ENGINE_CKPT_INVALID');
                const sovitsCheck = gsvPkg.validateCheckpoint(
                    options?.sovits_weights
                        || options?.sovits_checkpoint
                        || settings.gptSovitsSovitsCkpt,
                    'SoVITS checkpoint'
                );
                if (!sovitsCheck.ok) return fail(sovitsCheck.error, 'ENGINE_CKPT_INVALID');
                const synthOpts = {
                    text_lang: textLang,
                    prompt_lang: promptLang,
                    ref_audio: refCheck.path,
                    prompt_text: options?.prompt_text
                        || options?.ref_text
                        || settings.gptSovitsRefText
                        || '',
                    gpt_weights: gptCheck.path,
                    sovits_weights: sovitsCheck.path,
                    allow_unsupported_lang: allowUnsupported,
                    speed_factor: options?.speed_factor ?? options?.speed ?? 1.0,
                };
                const outPath = await pool.withEngine(async (engine) => {
                    if (!engine.ready) {
                        await engine.init(null, settings.pythonPath, {
                            gptWeights: gptCheck.path,
                            sovitsWeights: sovitsCheck.path,
                            device: settings.device || 'cuda',
                        });
                    }
                    return engine.synthesize(text, 'clone', tempFile, synthOpts);
                });
                const buffer = fs.readFileSync(outPath);
                try { fs.unlinkSync(outPath); } catch (_) { /* ignore */ }
                return {
                    ok: true,
                    engineId: entry.id,
                    buffer,
                    format: 'wav',
                    warning: viWarn || undefined,
                };
            }

            const targetMode = entry.mode || entry.workerMode || 'v3turbo';
            const synthOpts = { ...getSynthOptions(settings), ...(options || {}) };
            const outPath = await pool.withEngine(async (engine) => {
                if (!engine.ready || engine.mode !== targetMode) {
                    await engine.init(targetMode, settings.pythonPath, getEngineOptions(settings));
                }
                return engine.synthesize(text, voice, tempFile, synthOpts);
            });
            const buffer = fs.readFileSync(outPath);
            try { fs.unlinkSync(outPath); } catch (_) { /* ignore */ }
            return { ok: true, engineId: entry.id, buffer, format: 'wav' };
        } catch (e) {
            return fail(e, 'ENGINE_SYNTH_FAILED');
        }
    }

    async function engineReload(engineId) {
        const entry = resolveEntry(engineId);
        if (!entry) return fail(`Unknown engine: ${engineId}`, 'ENGINE_UNKNOWN');
        try {
            poolManager.reloadPool(entry.id, poolSize());
        } catch (e) {
            return fail(e, 'ENGINE_RELOAD_FAILED');
        }
        return engineInit(entry.id, {});
    }

    function engineUnload(engineId) {
        const entry = resolveEntry(engineId);
        if (!entry) return fail(`Unknown engine: ${engineId}`, 'ENGINE_UNKNOWN');
        try {
            poolManager.shutdownPool(entry.id);
            return { ok: true, engineId: entry.id };
        } catch (e) {
            return fail(e, 'ENGINE_UNLOAD_FAILED');
        }
    }

    function engineStatus(engineId) {
        const entry = resolveEntry(engineId);
        if (!entry) return fail(`Unknown engine: ${engineId}`, 'ENGINE_UNKNOWN');
        return {
            ok: true,
            ...poolManager.getStatus(entry.id),
            installState: install.getInstallState(entry),
            outputFormat: entry.outputFormat,
            bundled: entry.bundled,
            online: entry.online,
            local: entry.local,
        };
    }

    function modeToEngineId(mode) {
        if (mode === 'v3nano') return 'v3nano';
        return 'vieneu';
    }

    function safeHandle(channel, handler) {
        ipcMain.handle(channel, async (event, ...args) => {
            try {
                return await handler(event, ...args);
            } catch (e) {
                sendLog?.(`IPC ${channel}: ${e.message}`, 'error');
                return fail(e, 'ENGINE_IPC_CRASH');
            }
        });
    }

    safeHandle('engine:list', () =>
        registry.listPublic((e) => install.getInstallState(e)));

    safeHandle('engine:init', async (_, payload = {}) => {
        const engineId = payload.engineId;
        const result = await engineInit(engineId, payload.options || {});
        if (result?.error) sendLog?.(`Lỗi khởi tạo ${engineId}: ${result.error}`, 'error');
        return result;
    });

    safeHandle('engine:synthesize', async (_, payload = {}) => {
        const { engineId, text, voice, options } = payload;
        return engineSynthesize(engineId, { text, voice, options });
    });

    safeHandle('engine:reload', async (_, engineId) => {
        const result = await engineReload(engineId);
        if (!result?.error) sendLog?.(`Đã khởi động lại ${engineId}`, 'success');
        return result;
    });

    safeHandle('engine:unload', (_, engineId) => engineUnload(engineId));

    safeHandle('engine:status', (_, engineId) => engineStatus(engineId));
    // Alias kept for earlier preload name
    safeHandle('engine:getStatus', (_, engineId) => engineStatus(engineId));

    // --- Legacy wrappers ---

    safeHandle('tts:listModels', () => {
        const { loadAvailableModes } = require('./vieneu-engine.cjs');
        return loadAvailableModes();
    });

    safeHandle('tts:init', async (_, { mode, engineOptions } = {}) => {
        const settings = getSettings();
        const targetMode = mode || settings.model || 'v3turbo';
        const result = await engineInit(modeToEngineId(targetMode), {
            mode: targetMode,
            engineOptions,
        });
        if (result?.error) sendLog?.(`Lỗi khởi tạo VieNeu: ${result.error}`, 'error');
        return result;
    });

    safeHandle('tts:reload', async () => {
        try {
            poolManager.shutdownPool('vieneu');
            poolManager.shutdownPool('v3nano');
        } catch (_) { /* ignore */ }
        const result = await engineInit('vieneu', { mode: 'v3turbo' });
        if (result?.error) sendLog?.(`Lỗi reload engine: ${result.error}`, 'error');
        return result;
    });

    safeHandle('tts:synthesize', async (_, { text, voice, mode, options } = {}) => {
        const settings = getSettings();
        const targetMode = mode || settings.model || 'v3turbo';
        return engineSynthesize(modeToEngineId(targetMode), { text, voice, options });
    });

    safeHandle('edge:init', async (_, { voiceMode, pythonPath } = {}) => {
        const result = await engineInit('edge', { voiceMode, pythonPath });
        if (result?.error) sendLog?.(`Lỗi khởi tạo Edge TTS: ${result.error}`, 'error');
        return result;
    });

    safeHandle('edge:reload', async () => engineReload('edge'));

    safeHandle('edge:synthesize', async (_, { text, voice, options } = {}) =>
        engineSynthesize('edge', { text, voice, options }));

    return {
        engineInit,
        engineSynthesize,
        engineReload,
        engineUnload,
        engineStatus,
        engineGetStatus: engineStatus,
        modeToEngineId,
        fail,
    };
}

module.exports = { createEngineIpc, fail };
