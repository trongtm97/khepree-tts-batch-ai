/**
 * Settings schema v2: engineSettings[engineId] + legacy flat-key mirrors.
 * Migration fills missing engineSettings fields from legacy once — never
 * overwrites an already-populated engineSettings value from legacy on reload.
 */
const SETTINGS_SCHEMA_VERSION = 2;

const DEFAULT_ENGINE_SETTINGS = Object.freeze({
    vieneu: Object.freeze({ voice: '' }),
    v3nano: Object.freeze({ voice: '' }),
    edge: Object.freeze({
        voice: 'vi-VN-HoaiMyNeural',
        voiceMode: 'vietnamese',
        rate: 0,
        pitch: 0,
        volume: 0,
    }),
    supertonic: Object.freeze({
        voice: 'M1',
        lang: 'vi',
        speed: 1.05,
        steps: 8,
    }),
    kitten: Object.freeze({
        voice: 'Bella',
        variant: 'mini',
        speed: 1.0,
    }),
    kokoro: Object.freeze({
        voice: 'af_heart',
        variant: 'int8',
        speed: 1.0,
    }),
    piper: Object.freeze({
        voice: 'en_US-lessac-medium',
        variant: 'en_US-lessac-medium',
        speed: 1.0,
    }),
    chatterbox: Object.freeze({
        voice: '',
        ref: '',
        variant: 'nano',
    }),
    qwen3: Object.freeze({
        voice: 'Vivian',
        variant: '0.6b-custom',
        lang: 'Auto',
        ref: '',
        refText: '',
        instruct: '',
    }),
    spark: Object.freeze({
        mode: 'clone',
        lang: 'Chinese',
        ref: '',
        refText: '',
        gender: 'male',
        pitch: 'moderate',
        speedLevel: 'moderate',
    }),
    'gpt-sovits': Object.freeze({
        profile: '',
        textLang: 'zh',
        refLang: 'zh',
        ref: '',
        refText: '',
        gptCkpt: '',
        sovitsCkpt: '',
    }),
});

/** Flat legacy key → [engineId, nestedKey] */
const LEGACY_TO_ENGINE = Object.freeze([
    ['voice', 'vieneu', 'voice'],
    ['voiceNano', 'v3nano', 'voice'],
    ['edgeVoice', 'edge', 'voice'],
    ['edgeVoiceMode', 'edge', 'voiceMode'],
    ['edgeRate', 'edge', 'rate'],
    ['edgePitch', 'edge', 'pitch'],
    ['edgeVolume', 'edge', 'volume'],
    ['supertonicVoice', 'supertonic', 'voice'],
    ['supertonicLang', 'supertonic', 'lang'],
    ['supertonicSpeed', 'supertonic', 'speed'],
    ['supertonicSteps', 'supertonic', 'steps'],
    ['kittenVoice', 'kitten', 'voice'],
    ['kittenVariant', 'kitten', 'variant'],
    ['kittenSpeed', 'kitten', 'speed'],
    ['kokoroVoice', 'kokoro', 'voice'],
    ['kokoroVariant', 'kokoro', 'variant'],
    ['kokoroSpeed', 'kokoro', 'speed'],
    ['piperVoice', 'piper', 'voice'],
    ['piperVariant', 'piper', 'variant'],
    ['piperSpeed', 'piper', 'speed'],
    ['chatterboxRef', 'chatterbox', 'ref'],
    ['chatterboxNanoRef', 'chatterbox', 'ref'],
    ['chatterboxVariant', 'chatterbox', 'variant'],
    ['qwen3Voice', 'qwen3', 'voice'],
    ['qwen3Variant', 'qwen3', 'variant'],
    ['qwen3Lang', 'qwen3', 'lang'],
    ['qwen3Ref', 'qwen3', 'ref'],
    ['qwen3RefText', 'qwen3', 'refText'],
    ['qwen3Instruct', 'qwen3', 'instruct'],
    ['sparkMode', 'spark', 'mode'],
    ['sparkLang', 'spark', 'lang'],
    ['sparkRef', 'spark', 'ref'],
    ['sparkRefText', 'spark', 'refText'],
    ['sparkGender', 'spark', 'gender'],
    ['sparkPitch', 'spark', 'pitch'],
    ['sparkSpeedLevel', 'spark', 'speedLevel'],
    ['gptSovitsProfile', 'gpt-sovits', 'profile'],
    ['gptSovitsTextLang', 'gpt-sovits', 'textLang'],
    ['gptSovitsRefLang', 'gpt-sovits', 'refLang'],
    ['gptSovitsRef', 'gpt-sovits', 'ref'],
    ['gptSovitsRefText', 'gpt-sovits', 'refText'],
    ['gptSovitsGptCkpt', 'gpt-sovits', 'gptCkpt'],
    ['gptSovitsSovitsCkpt', 'gpt-sovits', 'sovitsCkpt'],
]);

function cloneDefaults() {
    return {
        vieneu: { ...DEFAULT_ENGINE_SETTINGS.vieneu },
        v3nano: { ...DEFAULT_ENGINE_SETTINGS.v3nano },
        edge: { ...DEFAULT_ENGINE_SETTINGS.edge },
    };
}

function ensureBucket(engineSettings, engineId) {
    if (!engineSettings[engineId] || typeof engineSettings[engineId] !== 'object') {
        engineSettings[engineId] = { ...(DEFAULT_ENGINE_SETTINGS[engineId] || {}) };
    }
    return engineSettings[engineId];
}

/**
 * Fill only undefined/null nested keys from legacy flat settings (one-way seed).
 * Does not pre-fill empty defaults before reading legacy (would block migration).
 */
function seedEngineSettingsFromLegacy(settings) {
    const incoming = settings.engineSettings && typeof settings.engineSettings === 'object'
        ? settings.engineSettings
        : {};
    const es = {};

    for (const engineId of Object.keys(DEFAULT_ENGINE_SETTINGS)) {
        es[engineId] = { ...(incoming[engineId] || {}) };
    }
    for (const [id, bucket] of Object.entries(incoming)) {
        if (!es[id]) es[id] = { ...bucket };
    }

    // Legacy engine id chatterbox-nano → chatterbox
    if (incoming['chatterbox-nano'] && typeof incoming['chatterbox-nano'] === 'object') {
        const dest = ensureBucket(es, 'chatterbox');
        for (const [k, v] of Object.entries(incoming['chatterbox-nano'])) {
            if (dest[k] === undefined || dest[k] === null || dest[k] === '') {
                dest[k] = v;
            }
        }
    }

    for (const [flatKey, engineId, nestedKey] of LEGACY_TO_ENGINE) {
        const bucket = ensureBucket(es, engineId);
        if (bucket[nestedKey] === undefined || bucket[nestedKey] === null) {
            if (settings[flatKey] !== undefined && settings[flatKey] !== null) {
                bucket[nestedKey] = settings[flatKey];
            } else if (DEFAULT_ENGINE_SETTINGS[engineId]?.[nestedKey] !== undefined) {
                bucket[nestedKey] = DEFAULT_ENGINE_SETTINGS[engineId][nestedKey];
            }
        }
    }

    settings.engineSettings = es;
    return settings;
}

/**
 * After UI edits flat keys (BatchController), fold them into engineSettings.
 * Flat keys are source of truth for known legacy fields on save.
 */
function foldLegacyIntoEngineSettings(settings) {
    const es = {
        ...cloneDefaults(),
        ...(settings.engineSettings && typeof settings.engineSettings === 'object'
            ? settings.engineSettings
            : {}),
    };

    for (const [flatKey, engineId, nestedKey] of LEGACY_TO_ENGINE) {
        const bucket = ensureBucket(es, engineId);
        if (settings[flatKey] !== undefined) {
            bucket[nestedKey] = settings[flatKey];
        }
    }

    settings.engineSettings = es;
    return settings;
}

/** Mirror engineSettings → flat keys so old readers keep working. */
function mirrorEngineSettingsToLegacy(settings) {
    const es = settings.engineSettings || {};
    if (es.vieneu && es.vieneu.voice !== undefined) settings.voice = es.vieneu.voice;
    if (es.v3nano && es.v3nano.voice !== undefined) settings.voiceNano = es.v3nano.voice;
    if (es.edge) {
        if (es.edge.voice !== undefined) settings.edgeVoice = es.edge.voice;
        if (es.edge.voiceMode !== undefined) settings.edgeVoiceMode = es.edge.voiceMode;
        if (es.edge.rate !== undefined) settings.edgeRate = es.edge.rate;
        if (es.edge.pitch !== undefined) settings.edgePitch = es.edge.pitch;
        if (es.edge.volume !== undefined) settings.edgeVolume = es.edge.volume;
    }
    return settings;
}

/**
 * Load path: seed missing engineSettings from legacy once, then mirror out.
 * Does not overwrite existing engineSettings values with legacy.
 */
function migrateSettingsOnLoad(raw = {}) {
    const settings = { ...(raw || {}) };
    seedEngineSettingsFromLegacy(settings);
    mirrorEngineSettingsToLegacy(settings);
    settings.settingsSchemaVersion = Math.max(
        SETTINGS_SCHEMA_VERSION,
        Number(settings.settingsSchemaVersion) || 0
    );
    return settings;
}

/**
 * Save path: fold current flat keys into engineSettings, bump schema, mirror.
 */
function migrateSettingsOnSave(raw = {}) {
    const settings = { ...(raw || {}) };
    foldLegacyIntoEngineSettings(settings);
    mirrorEngineSettingsToLegacy(settings);
    settings.settingsSchemaVersion = SETTINGS_SCHEMA_VERSION;
    return settings;
}

function getEngineSetting(settings, engineId, key, fallback) {
    const bucket = settings?.engineSettings?.[engineId];
    if (bucket && bucket[key] !== undefined && bucket[key] !== null) return bucket[key];
    return fallback;
}

module.exports = {
    SETTINGS_SCHEMA_VERSION,
    DEFAULT_ENGINE_SETTINGS,
    LEGACY_TO_ENGINE,
    migrateSettingsOnLoad,
    migrateSettingsOnSave,
    getEngineSetting,
    seedEngineSettingsFromLegacy,
    foldLegacyIntoEngineSettings,
    mirrorEngineSettingsToLegacy,
};
