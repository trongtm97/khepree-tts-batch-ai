/**
 * Generic renderer TTS client — one class for every registry engine.
 * Uses preload: listEngines / engineInit / engineSynthesize / engineReload /
 * engineUnload / engineStatus (with engineList / engineGetStatus aliases).
 */
import {
    getEngineOptions,
    getSynthOptions,
    getEdgeSynthOptions,
} from './settings.js';
import { formatKhepreeAccessError } from './khepree-access-messages.js';
import { getEngineMeta, resolveEngineId } from './engine-meta.js';

let catalogCache = null;

function api() {
    return typeof window !== 'undefined' ? window.api : null;
}

async function fetchCatalog(force = false) {
    if (catalogCache && !force) return catalogCache;
    const a = api();
    const listFn = a?.listEngines || a?.engineList;
    if (!listFn) {
        catalogCache = [];
        return catalogCache;
    }
    const list = await listFn();
    catalogCache = Array.isArray(list) ? list : [];
    return catalogCache;
}

export async function loadEngineCatalog(force = false) {
    return fetchCatalog(force);
}

export function getCachedEngine(engineId) {
    const id = resolveEngineId(engineId);
    return catalogCache?.find((e) => e.id === id) || null;
}

function mimeForFormat(fmt) {
    const ext = String(fmt || 'wav').toLowerCase();
    if (ext === 'mp3') return 'audio/mpeg';
    if (ext === 'ogg') return 'audio/ogg';
    return 'audio/wav';
}

function bufferToUint8(raw) {
    if (!raw) return new Uint8Array(0);
    if (raw instanceof Uint8Array) return raw;
    if (raw?.data) return new Uint8Array(raw.data);
    if (ArrayBuffer.isView(raw)) return new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
    return new Uint8Array(raw);
}

/** Build init options from registry capabilities — no per-engine if/else on id. */
export function buildInitOptions(meta, options = {}, appSettings = {}) {
    const caps = meta?.capabilities || {};
    const settingsMeta = meta?.settings || meta?.settingsKey || {};
    const voiceModeKey = settingsMeta.voiceModeSettingKey || settingsMeta.voiceMode;

    if (meta?.family === 'spark' || meta?.id === 'spark') {
        return {
            pythonPath: appSettings.pythonPath,
            device: appSettings.device || 'cuda',
            variant: meta?.modelVariant || '0.5b',
        };
    }

    if (meta?.family === 'gpt-sovits' || meta?.id === 'gpt-sovits') {
        return {
            pythonPath: appSettings.pythonPath,
            device: appSettings.device || 'cuda',
            gptWeights: appSettings.gptSovitsGptCkpt || '',
            sovitsWeights: appSettings.gptSovitsSovitsCkpt || '',
        };
    }

    if ((caps.voiceMode || voiceModeKey) && meta?.family !== 'spark') {
        const key = voiceModeKey || 'edgeVoiceMode';
        return {
            voiceMode: options.voiceMode || appSettings[key] || 'vietnamese',
            pythonPath: appSettings.pythonPath,
        };
    }

    if (caps.modelVariantSelect) {
        const variantKey = settingsMeta.variantSettingKey || settingsMeta.variant || 'kittenVariant';
        const defaultVariant = meta?.modelVariant
            || meta?.variants?.[0]?.id
            || 'mini';
        const out = {
            variant: options.variant || appSettings[variantKey] || defaultVariant,
            pythonPath: appSettings.pythonPath,
        };
        if (caps.voiceClone || caps.expressionTags || meta?.family === 'qwen3') {
            out.device = appSettings.device || (meta?.family === 'qwen3' ? 'cuda' : 'cpu');
        }
        return out;
    }

    if (caps.voiceClone || caps.expressionTags) {
        return {
            variant: options.variant || meta?.modelVariant || 'nano',
            pythonPath: appSettings.pythonPath,
            device: appSettings.device || 'cpu',
        };
    }

    return {
        mode: options.mode || meta?.mode || meta?.workerMode || null,
        engineOptions: options.engineOptions || getEngineOptions(appSettings),
        pythonPath: appSettings.pythonPath,
    };
}

/** Build synthesize options from capabilities. */
export function buildSynthOptions(meta, appSettings = {}, overrides = {}) {
    const caps = meta?.capabilities || {};
    const settingsMeta = meta?.settings || meta?.settingsKey || {};

    // Qwen3: variant + language + custom speakers / clone
    if (meta?.family === 'qwen3' || meta?.id === 'qwen3') {
        const variantKey = settingsMeta.variantSettingKey || settingsMeta.variant || 'qwen3Variant';
        const langKey = settingsMeta.langSettingKey || settingsMeta.lang || 'qwen3Lang';
        const voiceKey = settingsMeta.voiceSettingKey || settingsMeta.voice || 'qwen3Voice';
        const refKey = settingsMeta.ref || 'qwen3Ref';
        const variant = overrides.variant || appSettings[variantKey] || meta?.modelVariant || '0.6b-custom';
        const language = overrides.language || overrides.lang || appSettings[langKey] || 'Auto';
        return {
            variant,
            language,
            speaker: overrides.speaker || overrides.voice || appSettings[voiceKey] || 'Vivian',
            instruct: overrides.instruct ?? appSettings.qwen3Instruct ?? '',
            ref_audio: overrides.ref_audio
                || overrides.audio_prompt_path
                || appSettings[refKey]
                || appSettings.qwen3Ref
                || '',
            ref_text: overrides.ref_text ?? appSettings.qwen3RefText ?? '',
            allow_unsupported_lang: language === 'Vietnamese'
                || Boolean(overrides.allow_unsupported_lang),
            ...overrides,
            variant,
            language,
        };
    }

    if (meta?.family === 'spark' || meta?.id === 'spark') {
        const mode = overrides.spark_mode
            || overrides.mode
            || appSettings.sparkMode
            || 'clone';
        const language = overrides.language || overrides.lang || appSettings.sparkLang || 'Chinese';
        return {
            spark_mode: mode,
            language,
            gender: overrides.gender || appSettings.sparkGender || 'male',
            pitch: overrides.pitch || appSettings.sparkPitch || 'moderate',
            speed: overrides.speed || appSettings.sparkSpeedLevel || 'moderate',
            ref_audio: overrides.ref_audio
                || overrides.prompt_speech_path
                || appSettings.sparkRef
                || '',
            prompt_text: overrides.prompt_text ?? overrides.ref_text ?? appSettings.sparkRefText ?? '',
            allow_unsupported_lang: language === 'Vietnamese'
                || Boolean(overrides.allow_unsupported_lang),
            ...overrides,
            spark_mode: mode,
            language,
        };
    }

    if (meta?.family === 'gpt-sovits' || meta?.id === 'gpt-sovits') {
        const textLang = overrides.text_lang
            || overrides.language
            || overrides.lang
            || appSettings.gptSovitsTextLang
            || 'zh';
        const promptLang = overrides.prompt_lang
            || overrides.ref_lang
            || appSettings.gptSovitsRefLang
            || textLang;
        return {
            text_lang: textLang,
            prompt_lang: promptLang,
            language: textLang,
            ref_audio: overrides.ref_audio
                || overrides.ref_audio_path
                || appSettings.gptSovitsRef
                || '',
            prompt_text: overrides.prompt_text ?? overrides.ref_text ?? appSettings.gptSovitsRefText ?? '',
            gpt_weights: overrides.gpt_weights
                || overrides.gpt_checkpoint
                || appSettings.gptSovitsGptCkpt
                || '',
            sovits_weights: overrides.sovits_weights
                || overrides.sovits_checkpoint
                || appSettings.gptSovitsSovitsCkpt
                || '',
            allow_unsupported_lang: ['vi', 'vietnamese'].includes(String(textLang).toLowerCase())
                || Boolean(overrides.allow_unsupported_lang),
            ...overrides,
            text_lang: textLang,
            prompt_lang: promptLang,
        };
    }

    if (caps.edgeRate || caps.voiceMode) {
        return { ...getEdgeSynthOptions(appSettings), ...overrides };
    }
    if (caps.languageSelect) {
        return {
            lang: overrides.lang || appSettings.supertonicLang || 'vi',
            speed: overrides.speed ?? appSettings.supertonicSpeed ?? 1.05,
            total_steps: overrides.total_steps ?? appSettings.supertonicSteps ?? 8,
            silence_duration: overrides.silence_duration ?? 0.3,
            ...overrides,
        };
    }
    if (caps.modelVariantSelect) {
        const variantKey = settingsMeta.variantSettingKey || settingsMeta.variant || 'kittenVariant';
        const speedKey = settingsMeta.speedSettingKey || settingsMeta.speed || 'kittenSpeed';
        const defaultVariant = meta?.modelVariant
            || meta?.variants?.[0]?.id
            || 'mini';
        const out = {
            variant: overrides.variant || appSettings[variantKey] || defaultVariant,
            speed: overrides.speed ?? appSettings[speedKey] ?? 1,
            clean_text: overrides.clean_text !== false,
            ...overrides,
        };
        if (caps.voiceClone || caps.expressionTags) {
            const refKey = settingsMeta.ref || settingsMeta.voice || 'chatterboxRef';
            out.audio_prompt_path = overrides.audio_prompt_path
                || overrides.ref_wav
                || appSettings[refKey]
                || appSettings.chatterboxRef
                || appSettings.chatterboxNanoRef
                || '';
            out.norm_loudness = overrides.norm_loudness !== false;
            delete out.speed;
            delete out.clean_text;
        }
        return out;
    }
    if (caps.voiceClone || caps.expressionTags) {
        const refKey = settingsMeta.ref || settingsMeta.voice || 'chatterboxRef';
        return {
            audio_prompt_path: overrides.audio_prompt_path
                || overrides.ref_wav
                || appSettings[refKey]
                || appSettings.chatterboxRef
                || appSettings.chatterboxNanoRef
                || '',
            norm_loudness: overrides.norm_loudness !== false,
            ...overrides,
        };
    }
    return { ...getSynthOptions(appSettings), ...overrides };
}

export class EngineService {
    constructor(engineId) {
        this.engineId = resolveEngineId(engineId);
        this.ready = false;
        this.voices = [];
        this.meta = getEngineMeta(this.engineId);
        this.mode = null;
        this.voiceMode = null;
        this.lastFormat = this.meta?.outputFormat || 'wav';
    }

    get outputFormat() {
        return this.lastFormat || this.meta?.outputFormat || 'wav';
    }

    getCapabilities() {
        return this.meta?.capabilities || {};
    }

    listVoices() {
        return this.voices;
    }

    async ensureMeta() {
        try {
            const list = await fetchCatalog();
            const live = list.find((e) => e.id === this.engineId);
            if (live) {
                this.meta = { ...getEngineMeta(this.engineId), ...live };
            }
        } catch (_) { /* keep local meta */ }
        if (!this.meta) {
            this.meta = getEngineMeta(this.engineId);
        }
        if (!this.meta) throw new Error(`Engine không có trong registry: ${this.engineId}`);
        return this.meta;
    }

    async init(options = {}, appSettings = {}) {
        await this.ensureMeta();
        const a = api();
        if (!a?.engineInit) throw new Error('engineInit API không khả dụng');

        const initOpts = buildInitOptions(this.meta, options, appSettings);
        const result = await a.engineInit({
            engineId: this.engineId,
            options: initOpts,
        });
        if (result?.error) throw new Error(result.error);

        this.ready = true;
        this.voices = result.voices || [];
        this.mode = result.mode || initOpts.mode || null;
        this.voiceMode = result.voiceMode || initOpts.voiceMode || null;
        this.lastFormat = this.meta.outputFormat || this.lastFormat;
        return this.voices;
    }

    async synthesize(text, voice, appSettings = {}, overrides = {}) {
        if (!this.ready) throw new Error('Engine chưa sẵn sàng');
        await this.ensureMeta();
        const a = api();
        if (!a?.engineSynthesize) throw new Error('engineSynthesize API không khả dụng');

        const options = buildSynthOptions(this.meta, appSettings, overrides);
        const result = await a.engineSynthesize({
            engineId: this.engineId,
            text,
            voice,
            options,
        });
        if (result?.error) throw new Error(formatKhepreeAccessError(result.error));

        const fmt = result.format || this.meta.outputFormat || 'wav';
        this.lastFormat = fmt;
        const bytes = bufferToUint8(result.buffer);
        return new Blob([bytes], { type: mimeForFormat(fmt) });
    }

    async reload(options = {}, appSettings = {}) {
        const a = api();
        if (a?.engineReload) {
            const result = await a.engineReload(this.engineId);
            if (result?.error) throw new Error(result.error);
        }
        this.dispose();
        return this.init(options, appSettings);
    }

    async unload() {
        const a = api();
        this.dispose();
        if (a?.engineUnload) {
            return a.engineUnload(this.engineId);
        }
        return { ok: true, engineId: this.engineId };
    }

    async status() {
        const a = api();
        const statusFn = a?.engineStatus || a?.engineGetStatus;
        if (!statusFn) {
            return {
                ok: true,
                engineId: this.engineId,
                ready: this.ready,
                outputFormat: this.outputFormat,
            };
        }
        const result = await statusFn(this.engineId);
        if (result?.error) throw new Error(result.error);
        return result;
    }

    /** Clear client state only — does not stop main-process workers unless unload(). */
    dispose() {
        this.ready = false;
        this.voices = [];
        this.mode = null;
        this.voiceMode = null;
    }
}

/** Compatibility: VieNeu used TTSService(mode) without engineId. */
export class TTSService {
    constructor(engineId = 'vieneu') {
        this._inner = new EngineService(engineId);
        this.ready = false;
        this.voices = [];
        this.mode = null;
    }

    async init(mode, appSettings = {}) {
        const engineId = mode === 'v3nano' ? 'v3nano' : 'vieneu';
        if (this._inner.engineId !== engineId) {
            this._inner.dispose();
            this._inner = new EngineService(engineId);
        }
        const voices = await this._inner.init({ mode }, appSettings);
        this.ready = this._inner.ready;
        this.voices = voices;
        this.mode = this._inner.mode;
        return voices;
    }

    synthesize(text, voice, appSettings, overrides) {
        return this._inner.synthesize(text, voice, appSettings, overrides);
    }

    dispose() {
        this._inner.dispose();
        this.ready = false;
        this.voices = [];
        this.mode = null;
    }
}

/** Compatibility wrapper for Edge. */
export class EdgeTTSService {
    constructor() {
        this._inner = new EngineService('edge');
        this.ready = false;
        this.voices = [];
        this.voiceMode = 'vietnamese';
    }

    async init(voiceMode, appSettings = {}) {
        const voices = await this._inner.init({ voiceMode }, appSettings);
        this.ready = this._inner.ready;
        this.voices = voices;
        this.voiceMode = this._inner.voiceMode || voiceMode;
        return voices;
    }

    synthesize(text, voice, appSettings, overrides) {
        return this._inner.synthesize(text, voice, appSettings, overrides);
    }

    dispose() {
        this._inner.dispose();
        this.ready = false;
        this.voices = [];
    }
}

export default EngineService;
