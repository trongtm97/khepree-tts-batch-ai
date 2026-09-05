/** Cài đặt mặc định — đồng bộ với electron/main.cjs và python worker. */

export const DEFAULT_SETTINGS = {

    outputDir: '',

    model: 'v3turbo',

    voice: '',

    voiceNano: '',

    speed: 1.0,

    delayMin: 0,

    delayMax: 1,

    pythonPath: '',

    device: 'cpu',

    threads: 6,

    hfToken: '',

    silenceLinePunct: 0.35,

    silenceLineNoPunct: 0.55,

    silenceParagraph: 0.75,

    silenceChunk: 0.15,

    splitByLine: true,

    stripHash: true,

    useSeaG2p: true,

    volume: 1.0,

    pauseScale: 1.0,

    edgeVoiceMode: 'vietnamese',

    edgeVoice: 'vi-VN-HoaiMyNeural',

    edgeRate: 0,

    edgePitch: 0,

    edgeVolume: 0,

    batchWorkers: 2,

    chunkMaxChars: 1200,

    chunkAutoOnImport: false,

    selectedBatchEngine: 'vieneu',

    /** Prompt 27 — local language detection + mismatch warnings */
    languageDetectionEnabled: true,
    languageMismatchWarnings: true,

    /** Optional models root; empty = userData/models. Never resources/Program Files. */
    modelStorageDir: '',

    /** Supertonic 3 (optional ONNX) */
    supertonicVoice: 'M1',
    supertonicLang: 'vi',
    supertonicSpeed: 1.05,
    supertonicSteps: 8,

    /** KittenTTS (optional ONNX) */
    kittenVoice: 'Bella',
    kittenVariant: 'mini',
    kittenSpeed: 1.0,

    /** Kokoro (optional ONNX via kokoro-onnx) */
    kokoroVoice: 'af_heart',
    kokoroVariant: 'int8',
    kokoroSpeed: 1.0,

    /** Piper (optional GPLv3 — not bundled) */
    piperVoice: 'en_US-lessac-medium',
    piperVariant: 'en_US-lessac-medium',
    piperSpeed: 1.0,

    /** Chatterbox (optional isolated PyTorch — Nano + Turbo) */
    chatterboxRef: '',
    chatterboxNanoRef: '',
    chatterboxVariant: 'nano',

    /** Qwen3-TTS 0.6B (optional isolated — CustomVoice + Base) */
    qwen3Voice: 'Vivian',
    qwen3Variant: '0.6b-custom',
    qwen3Lang: 'Auto',
    qwen3Ref: '',
    qwen3RefText: '',
    qwen3Instruct: '',

    /** Spark-TTS 0.5B (optional isolated — clone + speaker controls) */
    sparkMode: 'clone',
    sparkLang: 'Chinese',
    sparkRef: '',
    sparkRefText: '',
    sparkGender: 'male',
    sparkPitch: 'moderate',
    sparkSpeedLevel: 'moderate',

    /** Local benchmark + AUTO recommender prefs */
    benchmarkPreferredTask: 'vi-general',
    benchmarkPreferredLanguage: 'vi',
    benchmarkPreferredEngine: '',

    /** GPT-SoVITS Voice Lab (inference only — no training) */
    gptSovitsProfile: '',
    gptSovitsTextLang: 'zh',
    gptSovitsRefLang: 'zh',
    gptSovitsRef: '',
    gptSovitsRefText: '',
    gptSovitsGptCkpt: '',
    gptSovitsSovitsCkpt: '',

    settingsSchemaVersion: 2,

    engineSettings: {
        vieneu: { voice: '' },
        v3nano: { voice: '' },
        edge: {
            voice: 'vi-VN-HoaiMyNeural',
            voiceMode: 'vietnamese',
            rate: 0,
            pitch: 0,
            volume: 0,
        },
        supertonic: {
            voice: 'M1',
            lang: 'vi',
            speed: 1.05,
            steps: 8,
        },
        kitten: {
            voice: 'Bella',
            variant: 'mini',
            speed: 1.0,
        },
        kokoro: {
            voice: 'af_heart',
            variant: 'int8',
            speed: 1.0,
        },
        piper: {
            voice: 'en_US-lessac-medium',
            variant: 'en_US-lessac-medium',
            speed: 1.0,
        },
        chatterbox: {
            voice: '',
            ref: '',
            variant: 'nano',
        },
        qwen3: {
            voice: 'Vivian',
            variant: '0.6b-custom',
            lang: 'Auto',
            ref: '',
            refText: '',
            instruct: '',
        },
        spark: {
            mode: 'clone',
            lang: 'Chinese',
            ref: '',
            refText: '',
            gender: 'male',
            pitch: 'moderate',
            speedLevel: 'moderate',
        },
        'gpt-sovits': {
            profile: '',
            textLang: 'zh',
            refLang: 'zh',
            ref: '',
            refText: '',
            gptCkpt: '',
            sovitsCkpt: '',
        },
    },

};



/** Loại giọng Edge TTS: đa ngôn ngữ hoặc 2 giọng Việt chuyên. */

export const EDGE_VOICE_MODES = [

    { id: 'multilingual', label: 'Đa ngôn ngữ (Multilingual)' },

    { id: 'vietnamese', label: 'Tiếng Việt chuyên (HoaiMy · NamMinh)' },

];



const VIENEU_FIELD_MAP = [

    ['set-outputDir', 'outputDir', 'string'],

    ['set-speed', 'speed', 'number'],

    ['set-delayMin', 'delayMin', 'number'],

    ['set-delayMax', 'delayMax', 'number'],

    ['set-pythonPath', 'pythonPath', 'string'],

    ['set-device', 'device', 'string'],

    ['set-threads', 'threads', 'number'],

    ['set-batchWorkers', 'batchWorkers', 'number'],

    ['set-silenceLinePunct', 'silenceLinePunct', 'number'],

    ['set-silenceLineNoPunct', 'silenceLineNoPunct', 'number'],

    ['set-silenceParagraph', 'silenceParagraph', 'number'],

    ['set-silenceChunk', 'silenceChunk', 'number'],

    ['set-splitByLine', 'splitByLine', 'checkbox'],

    ['set-stripHash', 'stripHash', 'checkbox'],

    ['set-useSeaG2p', 'useSeaG2p', 'checkbox'],

    ['set-languageDetectionEnabled', 'languageDetectionEnabled', 'checkbox'],

    ['set-languageMismatchWarnings', 'languageMismatchWarnings', 'checkbox'],

];



const EDGE_FIELD_MAP = [

    ['set-edgeVoiceMode', 'edgeVoiceMode', 'string'],

    ['set-edgeVoice', 'edgeVoice', 'string'],

    ['set-edgeRate', 'edgeRate', 'number'],

    ['set-edgePitch', 'edgePitch', 'number'],

    ['set-edgeVolume', 'edgeVolume', 'number'],

];



const FIELD_MAP = [...VIENEU_FIELD_MAP, ...EDGE_FIELD_MAP];



/** Khóa chỉ thuộc tab Cài đặt VieNeu. */

export const VIENEU_SETTING_KEYS = [...new Set(VIENEU_FIELD_MAP.map(([, key]) => key))];



/** Khóa chỉ thuộc tab Cài đặt Edge. */

export const EDGE_SETTING_KEYS = [...new Set(EDGE_FIELD_MAP.map(([, key]) => key))];



function setField(id, value, type) {

    const el = document.getElementById(id);

    if (!el) return;

    if (type === 'checkbox') el.checked = Boolean(value);

    else el.value = value ?? '';

}



function readField(id, type, fallback) {

    const el = document.getElementById(id);

    if (!el) return fallback;

    if (type === 'checkbox') return el.checked;

    if (type === 'number') {

        const n = Number(el.value);

        return Number.isFinite(n) ? n : fallback;

    }

    return el.value.trim();

}



function applyFieldMap(settings, fieldMap) {

    const s = { ...DEFAULT_SETTINGS, ...settings };

    for (const [id, key, type] of fieldMap) {

        setField(id, s[key], type);

    }

}



function readFieldMap(base, fieldMap) {

    const s = { ...base };

    for (const [id, key, type] of fieldMap) {

        s[key] = readField(id, type, DEFAULT_SETTINGS[key]);

    }

    return s;

}



function clampSettings(s) {

    if (s.model !== 'v3turbo' && s.model !== 'v3nano') s.model = 'v3turbo';

    s.speed = Math.max(0.5, Math.min(2, s.speed));

    s.threads = Math.max(0, Math.min(32, Math.round(s.threads)));

    s.batchWorkers = Math.max(1, Math.min(8, Math.round(s.batchWorkers)));

    s.edgeRate = Math.max(-50, Math.min(100, s.edgeRate));

    s.edgePitch = Math.max(-50, Math.min(50, s.edgePitch));

    s.edgeVolume = Math.max(-50, Math.min(50, s.edgeVolume));

    s.chunkMaxChars = Math.max(400, Math.min(5000, Math.round(s.chunkMaxChars)));

    return s;

}



export function applySettingsToForm(settings) {

    applyFieldMap(settings, FIELD_MAP);

}



export function readSettingsFromForm(base = {}) {

    return clampSettings(readFieldMap({ ...DEFAULT_SETTINGS, ...base }, FIELD_MAP));

}



export function readVieneuSettingsFromForm(base = {}) {

    return clampSettings(readFieldMap({ ...DEFAULT_SETTINGS, ...base }, VIENEU_FIELD_MAP));

}



export function readEdgeSettingsFromForm(base = {}) {

    return clampSettings(readFieldMap({ ...DEFAULT_SETTINGS, ...base }, EDGE_FIELD_MAP));

}



export function applyVieneuDefaultsToForm() {

    applyFieldMap(DEFAULT_SETTINGS, VIENEU_FIELD_MAP);

}



export function applyEdgeDefaultsToForm() {

    applyFieldMap(DEFAULT_SETTINGS, EDGE_FIELD_MAP);

}



export function getEngineOptions(settings) {

    const s = { ...DEFAULT_SETTINGS, ...settings };

    return {

        device: s.device || 'cpu',

        threads: s.threads ?? 6,

        hfToken: s.hfToken || undefined,

    };

}



export function getSynthOptions(settings) {

    const s = { ...DEFAULT_SETTINGS, ...settings };

    return {

        speed: s.speed,

        silenceLinePunct: s.silenceLinePunct,

        silenceLineNoPunct: s.silenceLineNoPunct,

        silenceParagraph: s.silenceParagraph,

        silenceChunk: s.silenceChunk,

        splitByLine: s.splitByLine,

        stripHash: s.stripHash,

        useSeaG2p: s.useSeaG2p,

        volume: s.volume,

    };

}



export function getEdgeSynthOptions(settings) {

    const s = { ...DEFAULT_SETTINGS, ...settings };

    return {

        edgeVoiceMode: s.edgeVoiceMode,

        edgeRate: s.edgeRate,

        edgePitch: s.edgePitch,

        edgeVolume: s.edgeVolume,

        stripHash: s.stripHash,

        useSeaG2p: s.useSeaG2p,

    };

}


