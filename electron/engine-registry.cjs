/**
 * Engine Registry — metadata + EngineClass for TTS engines.
 * Canonical job/settings ids: vieneu | v3nano | edge
 */
const path = require('path');
const { VieNeuEngine } = require('./vieneu-engine.cjs');
const { EdgeTTSEngine } = require('./edge-engine.cjs');
const langSupport = require('./language-support.cjs');
const { lang, LEVEL } = langSupport;

/** @typedef {'NOT_INSTALLED'|'INSTALLING'|'INSTALLED'|'BROKEN'} InstallState */

const INSTALL = Object.freeze({
    NOT_INSTALLED: 'NOT_INSTALLED',
    INSTALLING: 'INSTALLING',
    INSTALLED: 'INSTALLED',
    BROKEN: 'BROKEN',
});

/** Alternate ids → canonical registry id (keep synthesis callers working). */
const ID_ALIASES = Object.freeze({
    'vieneu-turbo': 'vieneu',
    v3turbo: 'vieneu',
    'vieneu-nano': 'v3nano',
    /** Legacy / shorthand → single family engine (Nano + Turbo variants) */
    'chatterbox-nano': 'chatterbox',
    'chatterbox-turbo': 'chatterbox',
    'qwen3-tts': 'qwen3',
    'spark-tts': 'spark',
    gptsovits: 'gpt-sovits',
    'gpt_sovits': 'gpt-sovits',
});

const REQUIRED_FIELDS = Object.freeze([
    'id',
    'family',
    'displayName',
    'subtitle',
    'description',
    'EngineClass',
    'outputFormat',
    'bundled',
    'optional',
    'local',
    'online',
    'languages',
    'runtimeStrategy',
    'capabilities',
    'strengths',
    'weaknesses',
    'bestFor',
    'avoidWhen',
    'license',
    'settings',
]);

/** @type {Map<string, object>} */
const engines = new Map();

function register(entry) {
    if (!entry?.id) throw new Error('Engine registry entry requires id');
    engines.set(entry.id, freezeEntry(entry));
}

function freezeCapabilities(c = {}) {
    return Object.freeze({
        cpu: c.cpu !== false,
        gpu: Boolean(c.gpu),
        presetVoices: c.presetVoices !== false,
        voiceClone: Boolean(c.voiceClone),
        speed: c.speed !== false,
        emotion: Boolean(c.emotion),
        expressionTags: Boolean(c.expressionTags),
        voiceDesign: Boolean(c.voiceDesign),
        nativeBatch: c.nativeBatch !== false,
        streaming: Boolean(c.streaming),
        // UI helpers used by current BatchController (non-breaking)
        edgeRate: Boolean(c.edgeRate),
        voiceMode: Boolean(c.voiceMode),
        volume: c.volume !== false,
        pauseScale: c.pauseScale !== false,
        languageSelect: Boolean(c.languageSelect),
        totalSteps: Boolean(c.totalSteps),
        modelVariantSelect: Boolean(c.modelVariantSelect),
        speakerControls: Boolean(c.speakerControls),
        voiceProfiles: Boolean(c.voiceProfiles),
        customCheckpoints: Boolean(c.customCheckpoints),
    });
}

function freezeEntry(e) {
    const voiceSettingKey = e.settings?.voiceSettingKey
        || e.settingsKey?.voice
        || 'voice';
    const voiceModeSettingKey = e.settings?.voiceModeSettingKey
        || e.settingsKey?.voiceMode
        || null;

    return Object.freeze({
        id: e.id,
        family: e.family,
        displayName: e.displayName,
        subtitle: e.subtitle || '',
        description: e.description || '',
        /** One-line product positioning for Engine Selector cards (not description). */
        positioning: e.positioning || e.description || '',
        EngineClass: e.EngineClass || null,
        mode: e.mode ?? e.workerMode ?? null,
        outputFormat: e.outputFormat || 'wav',
        bundled: Boolean(e.bundled),
        optional: e.optional === true || e.bundled === false,
        local: Boolean(e.local),
        online: Boolean(e.online),
        languages: Object.freeze([...(e.languages || [])]),
        languageSupport: langSupport.freezeLanguageSupport(e.languageSupport || {}),
        variantLanguageSupport: langSupport.freezeVariantLanguageSupport(
            e.variantLanguageSupport || {}
        ),
        primaryLanguages: Object.freeze(
            e.primaryLanguages?.length
                ? [...e.primaryLanguages]
                : langSupport.derivePrimaryLanguages(e.languageSupport, e.languages)
        ),
        /** True when language coverage depends on installed voice (e.g. Piper). */
        languageSupportDependsOnVoice: Boolean(e.languageSupportDependsOnVoice),
        /** True when coverage depends on user checkpoint (e.g. GPT-SoVITS). */
        languageSupportDependsOnCheckpoint: Boolean(e.languageSupportDependsOnCheckpoint),
        runtimeStrategy: e.runtimeStrategy || e.runtimeId || 'CORE_PYTHON',
        capabilities: freezeCapabilities(e.capabilities),
        strengths: Object.freeze([...(e.strengths || [])]),
        weaknesses: Object.freeze([...(e.weaknesses || [])]),
        bestFor: Object.freeze([...(e.bestFor || [])]),
        avoidWhen: Object.freeze([...(e.avoidWhen || [])]),
        license: Object.freeze({
            codeLicense: e.license?.codeLicense || e.license?.code || '',
            modelLicense: e.license?.modelLicense || e.license?.model || '',
            attentionRequired: Boolean(e.license?.attentionRequired),
            /** Alias for product prompts / UI */
            licenseAttentionRequired: Boolean(
                e.license?.licenseAttentionRequired ?? e.license?.attentionRequired
            ),
        }),
        settings: Object.freeze({
            voiceSettingKey,
            voiceModeSettingKey,
            langSettingKey: e.settings?.langSettingKey || null,
            stepsSettingKey: e.settings?.stepsSettingKey || null,
            variantSettingKey: e.settings?.variantSettingKey || null,
            speedSettingKey: e.settings?.speedSettingKey || null,
        }),
        // Compatibility aliases for existing pool/IPC/UI code
        workerMode: e.mode ?? e.workerMode ?? null,
        runtimeId: e.runtimeStrategy === 'CORE_PYTHON' || !e.runtimeStrategy
            ? (e.runtimeId || 'core')
            : e.runtimeId || e.runtimeStrategy,
        modelsSubdir: e.modelsSubdir ?? null,
        modelVariant: e.modelVariant || 'default',
        modelVariants: Object.freeze([...(e.modelVariants || [])]),
        installMarker: e.installMarker ?? null,
        settingsKey: Object.freeze({
            voice: voiceSettingKey,
            voiceMode: voiceModeSettingKey,
            lang: e.settings?.langSettingKey || null,
            steps: e.settings?.stepsSettingKey || null,
            variant: e.settings?.variantSettingKey || null,
            speed: e.settings?.speedSettingKey || null,
        }),
        recommended: Boolean(e.recommended),
        experimental: Boolean(e.experimental),
        /** 'batch' (default beginner catalog) | 'voice-lab' (advanced, not beginner default) */
        category: e.category === 'voice-lab' ? 'voice-lab' : 'batch',
        badges: Object.freeze([...(e.badges || [])]),
        // Flat mirrors used by older listPublic consumers
        supportsCpu: (e.capabilities?.cpu !== false),
        supportsGpu: Boolean(e.capabilities?.gpu),
        supportsVoiceClone: Boolean(e.capabilities?.voiceClone),
        supportsPresetVoices: e.capabilities?.presetVoices !== false,
        supportsSpeed: e.capabilities?.speed !== false,
        supportsEmotion: Boolean(e.capabilities?.emotion),
        supportsVoiceDesign: Boolean(e.capabilities?.voiceDesign),
    });
}

function resolveId(engineId) {
    const raw = String(engineId || '').trim();
    if (!raw) return null;
    if (engines.has(raw)) return raw;
    const aliased = ID_ALIASES[raw];
    if (aliased && engines.has(aliased)) return aliased;
    return null;
}

function getEngine(id) {
    const resolved = resolveId(id);
    return resolved ? engines.get(resolved) : null;
}

function listEngines() {
    return [...engines.values()];
}

function hasEngine(id) {
    return resolveId(id) != null;
}

/** @deprecated prefer getEngine */
function get(engineId) {
    return getEngine(engineId);
}

/** @deprecated prefer listEngines */
function list() {
    return listEngines();
}

function assertRequiredMetadata(entry) {
    for (const key of REQUIRED_FIELDS) {
        if (entry[key] === undefined || entry[key] === null) {
            throw new Error(`Engine ${entry.id || '?'} missing required field: ${key}`);
        }
    }
    if (!entry.EngineClass) throw new Error(`Engine ${entry.id} missing EngineClass`);
    if (!entry.capabilities || typeof entry.capabilities !== 'object') {
        throw new Error(`Engine ${entry.id} missing capabilities`);
    }
    if (!entry.license || typeof entry.license !== 'object') {
        throw new Error(`Engine ${entry.id} missing license`);
    }
    if (!entry.settings?.voiceSettingKey) {
        throw new Error(`Engine ${entry.id} missing settings.voiceSettingKey`);
    }
}

/** Serializable catalog for renderer (no EngineClass). */
function listPublic(installResolver) {
    return listEngines().map((e) => {
        const installState = typeof installResolver === 'function'
            ? installResolver(e)
            : INSTALL.INSTALLED;
        return {
            id: e.id,
            family: e.family,
            displayName: e.displayName,
            subtitle: e.subtitle,
            description: e.description,
            positioning: e.positioning || e.description || '',
            mode: e.mode,
            outputFormat: e.outputFormat,
            bundled: e.bundled,
            optional: e.optional,
            local: e.local,
            online: e.online,
            languages: [...e.languages],
            primaryLanguages: [...(e.primaryLanguages || [])],
            languageSupport: { ...(e.languageSupport || {}) },
            variantLanguageSupport: Object.fromEntries(
                Object.entries(e.variantLanguageSupport || {}).map(([k, v]) => [k, { ...v }])
            ),
            languageSupportDependsOnVoice: Boolean(e.languageSupportDependsOnVoice),
            languageSupportDependsOnCheckpoint: Boolean(e.languageSupportDependsOnCheckpoint),
            runtimeStrategy: e.runtimeStrategy,
            capabilities: { ...e.capabilities },
            strengths: [...e.strengths],
            weaknesses: [...e.weaknesses],
            bestFor: [...e.bestFor],
            avoidWhen: [...e.avoidWhen],
            license: { ...e.license },
            settings: { ...e.settings },
            modelsSubdir: e.modelsSubdir,
            modelVariant: e.modelVariant,
            modelVariants: [...(e.modelVariants || [])],
            workerMode: e.workerMode,
            settingsKey: { ...e.settingsKey },
            runtimeId: e.runtimeId,
            badges: [...e.badges],
            recommended: e.recommended,
            experimental: e.experimental,
            category: e.category || 'batch',
            supportsCpu: e.supportsCpu,
            supportsGpu: e.supportsGpu,
            supportsVoiceClone: e.supportsVoiceClone,
            supportsPresetVoices: e.supportsPresetVoices,
            supportsSpeed: e.supportsSpeed,
            supportsEmotion: e.supportsEmotion,
            supportsVoiceDesign: e.supportsVoiceDesign,
            installState,
            available: installState === INSTALL.INSTALLED && Boolean(e.EngineClass),
        };
    });
}

function modelsDirFor(entry, getModelsDir) {
    if (!entry?.modelsSubdir) return null;
    return path.join(getModelsDir(), entry.modelsSubdir);
}

// --- Built-in engines (synthesis classes unchanged) ---

register({
    id: 'vieneu',
    family: 'vieneu',
    displayName: 'VieNeu Turbo',
    subtitle: '48 kHz · Offline · CPU mạnh',
    description: 'VieNeu-TTS v3 Turbo offline, 48 kHz, phù hợp batch tiếng Việt trên PC.',
    positioning: 'Khuyên dùng nếu nội dung chính là tiếng Việt.',
    EngineClass: VieNeuEngine,
    mode: 'v3turbo',
    outputFormat: 'wav',
    bundled: true,
    optional: false,
    local: true,
    online: false,
    languages: ['vi'],
    primaryLanguages: ['vi'],
    languageSupport: {
        vi: lang(LEVEL.NATIVE, {
            recommended: true,
            source: 'official',
            note: 'VieNeu-TTS v3 Turbo — thế mạnh tiếng Việt (Apache-2.0 upstream).',
        }),
        en: lang(LEVEL.UNSUPPORTED, {
            recommended: false,
            source: 'official',
            note: 'Không phải English engine chính thức.',
        }),
    },
    runtimeStrategy: 'CORE_PYTHON',
    capabilities: {
        cpu: true,
        gpu: true,
        presetVoices: true,
        voiceClone: false,
        speed: true,
        emotion: true,
        expressionTags: true,
        voiceDesign: false,
        nativeBatch: true,
        streaming: false,
        volume: true,
        pauseScale: true,
    },
    strengths: [
        'Offline hoàn toàn sau khi cài',
        'Chất lượng tiếng Việt cao (48 kHz)',
        'Đi kèm installer — không cần tải thêm',
    ],
    weaknesses: [
        'Nặng hơn Nano trên máy yếu',
        'Chủ yếu tối ưu tiếng Việt',
    ],
    bestFor: [
        'Batch nội dung tiếng Việt chất lượng cao',
        'Máy có CPU/RAM đủ mạnh',
    ],
    avoidWhen: [
        'Máy rất yếu / cần tốc độ tối đa',
        'Cần nhiều ngôn ngữ ngoài tiếng Việt',
    ],
    license: {
        codeLicense: 'Khepree product (app)',
        modelLicense: 'VieNeu-TTS upstream terms',
        attentionRequired: false,
    },
    settings: { voiceSettingKey: 'voice' },
    modelsSubdir: 'vieneu',
    installMarker: 'model-config.json',
    recommended: true,
    badges: ['Khuyên dùng', 'CPU', 'GPU', 'Offline', 'Tiếng Việt', 'Nâng cao'],
});

register({
    id: 'v3nano',
    family: 'vieneu',
    displayName: 'VieNeu Nano',
    subtitle: '24 kHz · Offline · máy yếu',
    description: 'VieNeu-TTS v3 Nano offline, 24 kHz, nhẹ hơn Turbo.',
    positioning: 'Nhẹ hơn, phù hợp máy cần tiết kiệm tài nguyên.',
    EngineClass: VieNeuEngine,
    mode: 'v3nano',
    outputFormat: 'wav',
    bundled: true,
    optional: false,
    local: true,
    online: false,
    languages: ['vi'],
    primaryLanguages: ['vi'],
    languageSupport: {
        vi: lang(LEVEL.NATIVE, {
            recommended: true,
            source: 'official',
            note: 'VieNeu-TTS v3 Nano — thế mạnh tiếng Việt, nhẹ hơn Turbo.',
        }),
        en: lang(LEVEL.UNSUPPORTED, {
            recommended: false,
            source: 'official',
            note: 'Không phải English engine chính thức.',
        }),
    },
    runtimeStrategy: 'CORE_PYTHON',
    capabilities: {
        cpu: true,
        gpu: true,
        presetVoices: true,
        voiceClone: false,
        speed: true,
        emotion: true,
        expressionTags: true,
        voiceDesign: false,
        nativeBatch: true,
        streaming: false,
        volume: true,
        pauseScale: true,
    },
    strengths: [
        'Nhẹ hơn Turbo',
        'Offline, đi kèm installer',
        'Phù hợp máy yếu hơn',
    ],
    weaknesses: [
        'Mẫu âm thanh 24 kHz (thấp hơn Turbo)',
        'Chủ yếu tiếng Việt',
    ],
    bestFor: [
        'Batch tiếng Việt trên máy hạn chế tài nguyên',
        'Khi Turbo quá chậm',
    ],
    avoidWhen: [
        'Cần chất lượng 48 kHz tối đa',
        'Cần engine đa ngôn ngữ online',
    ],
    license: {
        codeLicense: 'Khepree product (app)',
        modelLicense: 'VieNeu-TTS upstream terms',
        attentionRequired: false,
    },
    settings: { voiceSettingKey: 'voiceNano' },
    modelsSubdir: 'vieneu',
    installMarker: 'model-config.json',
    badges: ['CPU', 'GPU', 'Offline', 'Tiếng Việt', 'Nhẹ'],
});

register({
    id: 'edge',
    family: 'edge',
    displayName: 'Edge TTS',
    subtitle: 'Online · cần mạng · đa ngôn ngữ',
    description: 'Microsoft Edge online TTS — nhiều giọng, cần mạng.',
    positioning: 'Nhiều giọng, dễ dùng, nhưng cần Internet.',
    EngineClass: EdgeTTSEngine,
    mode: null,
    outputFormat: 'mp3',
    bundled: true,
    optional: false,
    local: false,
    online: true,
    languages: ['vi', 'en', 'multi'],
    primaryLanguages: ['vi', 'en'],
    languageSupport: {
        vi: lang(LEVEL.SUPPORTED, {
            recommended: true,
            source: 'official',
            note: 'Catalog Edge có giọng vi-VN official (HoaiMy, NamMinh, …).',
        }),
        en: lang(LEVEL.SUPPORTED, {
            recommended: true,
            source: 'official',
            note: 'English + multilingual voices trên dịch vụ Microsoft Edge TTS.',
        }),
        multi: lang(LEVEL.SUPPORTED, {
            recommended: true,
            source: 'official',
            note: 'Nhiều locale qua voice catalog online.',
        }),
    },
    runtimeStrategy: 'CORE_PYTHON',
    capabilities: {
        cpu: true,
        gpu: false,
        presetVoices: true,
        voiceClone: false,
        speed: true,
        emotion: false,
        expressionTags: false,
        voiceDesign: false,
        nativeBatch: true,
        streaming: false,
        edgeRate: true,
        voiceMode: true,
        volume: false,
        pauseScale: false,
    },
    strengths: [
        'Nhiều giọng / đa ngôn ngữ',
        'Không cần model local lớn',
        'Xuất MP3 sẵn',
    ],
    weaknesses: [
        'Bắt buộc có internet',
        'Phụ thuộc dịch vụ Microsoft Edge TTS',
    ],
    bestFor: [
        'Nội dung đa ngôn ngữ',
        'Khi không muốn chạy model local nặng',
    ],
    avoidWhen: [
        'Cần làm việc offline',
        'Môi trường không cho phép gọi mạng',
    ],
    license: {
        codeLicense: 'Khepree product (app) · edge-tts client',
        modelLicense: 'Microsoft Edge TTS online service terms',
        attentionRequired: true,
    },
    settings: {
        voiceSettingKey: 'edgeVoice',
        voiceModeSettingKey: 'edgeVoiceMode',
    },
    modelsSubdir: null,
    installMarker: null,
    badges: ['Online', 'Tiếng Việt', 'English', 'Đa ngôn ngữ', 'Nhẹ'],
});

register({
    id: 'supertonic',
    family: 'supertonic',
    displayName: 'Supertonic 3',
    subtitle: 'Đa ngôn ngữ · Nhẹ · Chạy CPU',
    description: 'TTS đa ngôn ngữ ONNX CPU (open-weight). Cài model optional trước khi Generate — không tải khi synthesize.',
    positioning: 'Phù hợp khi cần tiếng Việt cùng nhiều ngôn ngữ khác.',
    EngineClass: require('./supertonic-engine.cjs').SupertonicEngine,
    mode: 'supertonic-3',
    outputFormat: 'wav',
    bundled: false,
    optional: true,
    local: true,
    online: false,
    languages: ['vi', 'en', 'multi'],
    primaryLanguages: ['vi', 'en'],
    languageSupport: {
        vi: lang(LEVEL.SUPPORTED, {
            recommended: true,
            source: 'official',
            note: 'Supertonic 3 official weights hỗ trợ tiếng Việt (OpenRAIL HF).',
        }),
        en: lang(LEVEL.SUPPORTED, {
            recommended: true,
            source: 'official',
            note: 'English + multilingual ONNX.',
        }),
        multi: lang(LEVEL.SUPPORTED, {
            recommended: true,
            source: 'official',
            note: 'Đa ngôn ngữ theo upstream Supertonic 3.',
        }),
    },
    runtimeStrategy: 'CORE_PYTHON',
    runtimeId: 'core',
    capabilities: {
        cpu: true,
        gpu: false,
        presetVoices: true,
        voiceClone: false,
        speed: true,
        emotion: false,
        expressionTags: true,
        voiceDesign: false,
        nativeBatch: true,
        streaming: false,
        volume: false,
        pauseScale: false,
        languageSelect: true,
        totalSteps: true,
    },
    strengths: [
        'Chạy local.',
        'Không cần GPU.',
        'Hỗ trợ nhiều ngôn ngữ.',
        'Có tiếng Việt theo upstream hiện tại.',
        'Phù hợp laptop và PC phổ thông.',
        'Model nhỏ, tốt cho batch.',
        'ONNX runtime.',
    ],
    weaknesses: [
        'Không phải zero-shot clone engine local.',
        'Nếu ưu tiên clone giọng Việt, VieNeu phù hợp hơn.',
        'Ít khả năng tùy biến speaker hơn các model advanced.',
    ],
    bestFor: [
        'Máy không GPU.',
        'Cần tiếng Việt + ngôn ngữ khác.',
        'Muốn offline.',
        'Batch lớn.',
        'Ưu tiên tốc độ/tài nguyên.',
    ],
    avoidWhen: [
        'Clone giọng Việt → VieNeu.',
        'English expressive → Chatterbox.',
        'Voice design → Qwen Advanced.',
    ],
    license: {
        codeLicense: 'MIT (supertonic-py / Supertone Inc.)',
        modelLicense: 'OpenRAIL (Supertone/supertonic-3 on Hugging Face)',
        attentionRequired: true,
    },
    settings: {
        voiceSettingKey: 'supertonicVoice',
        langSettingKey: 'supertonicLang',
        stepsSettingKey: 'supertonicSteps',
    },
    modelsSubdir: 'supertonic',
    modelVariant: 'default',
    installMarker: null,
    badges: ['CPU', 'Offline', 'Tiếng Việt', 'English', 'Đa ngôn ngữ', 'Nhẹ', 'ONNX'],
});

register({
    id: 'kitten',
    family: 'kitten',
    displayName: 'KittenTTS',
    subtitle: 'Siêu nhẹ · CPU · Dành cho máy phổ thông',
    description: 'TTS ONNX siêu nhẹ (Developer Preview). English · cài từng variant Mini/Micro/Nano riêng — không tải khi synthesize.',
    positioning: 'English siêu nhẹ cho máy phổ thông.',
    EngineClass: require('./kitten-engine.cjs').KittenEngine,
    mode: null,
    outputFormat: 'wav',
    bundled: false,
    optional: true,
    local: true,
    online: false,
    languages: ['en'],
    primaryLanguages: ['en'],
    languageSupport: {
        en: lang(LEVEL.NATIVE, {
            recommended: true,
            source: 'official',
            note: 'KittenTTS phonemizer/en-us — English only (official).',
        }),
        vi: lang(LEVEL.UNSUPPORTED, {
            recommended: false,
            source: 'official',
            note: 'Không hỗ trợ tiếng Việt chính thức trên model Kitten đang dùng.',
        }),
    },
    runtimeStrategy: 'CORE_PYTHON',
    runtimeId: 'core',
    capabilities: {
        cpu: true,
        gpu: false,
        presetVoices: true,
        voiceClone: false,
        speed: true,
        emotion: false,
        expressionTags: false,
        voiceDesign: false,
        nativeBatch: true,
        streaming: false,
        volume: false,
        pauseScale: false,
        languageSelect: false,
        totalSteps: false,
        modelVariantSelect: true,
    },
    strengths: [
        'Model rất nhỏ.',
        'Không cần GPU.',
        'ONNX.',
        'Khởi động nhanh.',
        'Tốt cho preview.',
        'Có nhiều kích thước model để lựa chọn.',
    ],
    weaknesses: [
        'Project/model có thể vẫn ở trạng thái Developer Preview.',
        'Không tập trung voice cloning.',
        'Không phải lựa chọn tiếng Việt chính nếu upstream không hỗ trợ official.',
        'Variant nhỏ nhất có thể đánh đổi chất lượng/độ ổn định.',
    ],
    bestFor: [
        'Laptop văn phòng.',
        'Cần English nhanh.',
        'Preview.',
        'Máy ít tài nguyên.',
    ],
    avoidWhen: [
        'Tiếng Việt → VieNeu/Supertonic.',
        'Clone voice → VieNeu/Chatterbox.',
        'English expressive → Chatterbox.',
    ],
    license: {
        codeLicense: 'Apache-2.0 (KittenML/KittenTTS)',
        modelLicense: 'Apache-2.0 (KittenML kitten-tts-*-0.8 on Hugging Face)',
        attentionRequired: true,
    },
    settings: {
        voiceSettingKey: 'kittenVoice',
        variantSettingKey: 'kittenVariant',
        speedSettingKey: 'kittenSpeed',
    },
    modelsSubdir: 'kitten',
    modelVariant: 'mini',
    modelVariants: ['mini', 'micro', 'nano', 'nano-int8'],
    installMarker: null,
    // No Vietnamese badge — upstream phonemizer is en-us only
    badges: ['CPU', 'Offline', 'English', 'Nhẹ', 'ONNX', 'Preview'],
});

register({
    id: 'kokoro',
    family: 'kokoro',
    displayName: 'Kokoro',
    subtitle: 'English nhanh · Nhẹ · Local',
    description: 'Kokoro v1.0 qua kokoro-onnx (ONNX CPU). English narration nhẹ — model optional, không tải khi synthesize.',
    positioning: 'English nhanh và nhẹ.',
    EngineClass: require('./kokoro-engine.cjs').KokoroEngine,
    mode: null,
    outputFormat: 'wav',
    bundled: false,
    optional: true,
    local: true,
    online: false,
    languages: ['en'],
    primaryLanguages: ['en'],
    languageSupport: {
        en: lang(LEVEL.NATIVE, {
            recommended: true,
            source: 'official',
            note: 'Kokoro-82M / kokoro-onnx — English narration (official runtime path).',
        }),
        vi: lang(LEVEL.UNSUPPORTED, {
            recommended: false,
            source: 'official',
            note: 'Không hỗ trợ tiếng Việt chính thức trên runtime/model Khepree đang dùng.',
        }),
    },
    runtimeStrategy: 'CORE_PYTHON',
    runtimeId: 'core',
    capabilities: {
        cpu: true,
        gpu: false,
        presetVoices: true,
        voiceClone: false,
        speed: true,
        emotion: false,
        expressionTags: false,
        voiceDesign: false,
        nativeBatch: true,
        streaming: false,
        volume: false,
        pauseScale: false,
        languageSelect: false,
        totalSteps: false,
        modelVariantSelect: true,
    },
    strengths: [
        'Model nhỏ.',
        'English narration tốt so với footprint.',
        'Nhanh.',
        'Phù hợp CPU.',
        'Hợp preview và batch English.',
    ],
    weaknesses: [
        'Không instant voice clone.',
        'Không phải engine tiếng Việt chính.',
        'Điều khiển biểu cảm ít hơn Chatterbox/Qwen.',
        'Chất lượng phụ thuộc voice/runtime.',
    ],
    bestFor: [
        'English.',
        'Máy phổ thông.',
        'Muốn tốc độ.',
        'Không cần clone.',
    ],
    avoidWhen: [
        'Vietnamese → VieNeu/Supertonic.',
        'Clone English → Chatterbox.',
        'Ultra-light → có thể dùng Kitten.',
    ],
    license: {
        codeLicense: 'MIT (kokoro-onnx)',
        modelLicense: 'Apache-2.0 (hexgrad/Kokoro-82M)',
        attentionRequired: false,
    },
    settings: {
        voiceSettingKey: 'kokoroVoice',
        variantSettingKey: 'kokoroVariant',
        speedSettingKey: 'kokoroSpeed',
    },
    modelsSubdir: 'kokoro',
    modelVariant: 'int8',
    modelVariants: ['int8', 'fp32'],
    installMarker: null,
    // No Vietnamese — upstream VOICES.md has no vi
    badges: ['CPU', 'Offline', 'English', 'Nhẹ', 'ONNX'],
});

(() => {
    const piperPkg = require('./piper-package.cjs');
    const voiceKeys = piperPkg.catalogKeys();
    const langFamilies = new Set(
        piperPkg.listCatalogVoices().map((v) => v.languageFamily).filter(Boolean)
    );
    const languages = [];
    if (langFamilies.has('en')) languages.push('en');
    if (langFamilies.has('vi')) languages.push('vi');
    if (langFamilies.size > 2) languages.push('multi');

    register({
        id: 'piper',
        family: 'piper',
        displayName: 'Piper',
        subtitle: 'CPU cực nhẹ · Offline · Ổn định',
        description: 'OHF-Voice Piper (optional). Runtime GPLv3 — không bundle vào installer mặc định. Voices từ catalog official; mỗi voice có MODEL_CARD riêng.',
        positioning: 'CPU cực nhẹ; tiếng Việt khi đã cài voice VI.',
        EngineClass: require('./piper-engine.cjs').PiperEngine,
        mode: null,
        outputFormat: 'wav',
        bundled: false,
        optional: true,
        local: true,
        online: false,
        languages,
        primaryLanguages: languages.includes('en') ? ['en'] : [...languages].slice(0, 1),
        languageSupportDependsOnVoice: true,
        languageSupport: {
            en: lang(LEVEL.SUPPORTED, {
                recommended: true,
                source: 'official',
                note: 'Piper voice catalog có English voices official. Phụ thuộc voice đã cài.',
                dependsOnVoice: true,
            }),
            vi: lang(LEVEL.SUPPORTED, {
                recommended: false,
                source: 'official',
                note: 'Yêu cầu cài voice tiếng Việt (vi_VN-* trong catalog rhasspy/piper-voices).',
                dependsOnVoice: true,
            }),
            multi: lang(LEVEL.SUPPORTED, {
                recommended: true,
                source: 'official',
                note: 'Đa ngôn ngữ theo voice đã cài — không phải mọi locale cùng lúc.',
                dependsOnVoice: true,
            }),
        },
        runtimeStrategy: 'ISOLATED_PYTHON',
        runtimeId: 'piper',
        capabilities: {
            cpu: true,
            gpu: false,
            presetVoices: true,
            voiceClone: false,
            speed: true,
            emotion: false,
            expressionTags: false,
            voiceDesign: false,
            nativeBatch: true,
            streaming: false,
            volume: false,
            pauseScale: false,
            languageSelect: false,
            totalSteps: false,
            modelVariantSelect: true,
        },
        strengths: [
            'Chạy CPU.',
            'Không cần GPU.',
            'Nhẹ.',
            'Tốc độ tốt.',
            'Offline.',
            'Phù hợp máy cấu hình thấp và text dài.',
        ],
        weaknesses: [
            'Chất lượng tùy voice model.',
            'Không instant clone voice.',
            'Ít biểu cảm hơn AI TTS lớn.',
            'Engine/voice có vấn đề license cần xem riêng.',
        ],
        bestFor: [
            'Máy văn phòng.',
            'Offline.',
            'Tốc độ.',
            'Đọc batch dài.',
        ],
        avoidWhen: [
            'Clone Việt → VieNeu.',
            'Multilingual nhẹ → Supertonic.',
            'English expressive → Chatterbox.',
        ],
        license: {
            codeLicense: 'GPLv3 (OHF-Voice/piper1-gpl)',
            modelLicense: 'Per-voice MODEL_CARD (rhasspy/piper-voices)',
            attentionRequired: true,
        },
        settings: {
            voiceSettingKey: 'piperVoice',
            variantSettingKey: 'piperVariant',
            speedSettingKey: 'piperSpeed',
        },
        modelsSubdir: 'piper',
        modelVariant: piperPkg.DEFAULT_VOICE,
        modelVariants: voiceKeys,
        installMarker: null,
        badges: ['CPU', 'Offline', 'Nhẹ', 'Đa ngôn ngữ', 'Optional'],
    });
})();

register({
    id: 'chatterbox',
    family: 'chatterbox',
    displayName: 'Chatterbox',
    subtitle: 'English · Nano / Turbo · clone + biểu cảm',
    description:
        'Resemble Chatterbox (Nano + Turbo). Isolated PyTorch — không vào core. '
        + 'Một runtime dùng chung; chọn variant Nano (CPU-friendly) hoặc Turbo (clone + biểu cảm mạnh).',
    positioning: 'English biểu cảm và clone giọng.',
    EngineClass: require('./chatterbox-engine.cjs').ChatterboxEngine,
    mode: null,
    outputFormat: 'wav',
    bundled: false,
    optional: true,
    local: true,
    online: false,
    languages: ['en'],
    primaryLanguages: ['en'],
    languageSupport: {
        en: lang(LEVEL.NATIVE, {
            recommended: true,
            source: 'official',
            note: 'Resemble Chatterbox Nano/Turbo — English expressive/clone (official).',
        }),
        vi: lang(LEVEL.UNSUPPORTED, {
            recommended: false,
            source: 'official',
            note: 'Variant Nano/Turbo đang dùng không hỗ trợ tiếng Việt chính thức.',
        }),
    },
    variantLanguageSupport: {
        nano: {
            en: lang(LEVEL.NATIVE, {
                recommended: true,
                source: 'official',
                note: 'Chatterbox Nano — English lightweight/expressive.',
            }),
            vi: lang(LEVEL.UNSUPPORTED, {
                recommended: false,
                source: 'official',
                note: 'Nano không support Vietnamese official.',
            }),
        },
        turbo: {
            en: lang(LEVEL.NATIVE, {
                recommended: true,
                source: 'official',
                note: 'Chatterbox Turbo — English clone / higher fidelity.',
            }),
            vi: lang(LEVEL.UNSUPPORTED, {
                recommended: false,
                source: 'official',
                note: 'Turbo không support Vietnamese official.',
            }),
        },
    },
    runtimeStrategy: 'ISOLATED_PYTHON',
    runtimeId: 'chatterbox',
    capabilities: {
        cpu: true,
        gpu: true,
        presetVoices: false,
        voiceClone: true,
        speed: false,
        emotion: false,
        expressionTags: true,
        voiceDesign: false,
        nativeBatch: true,
        streaming: false,
        volume: false,
        pauseScale: false,
        languageSelect: false,
        totalSteps: false,
        modelVariantSelect: true,
    },
    strengths: [
        'English voice clone + expression (Turbo) hoặc CPU-friendly (Nano).',
        'Paralinguistic tags theo upstream.',
        'Một isolated runtime dùng chung Nano và Turbo.',
        'Phù hợp dialogue / character / narration.',
    ],
    weaknesses: [
        'Không Vietnamese official.',
        'Runtime PyTorch nặng hơn ONNX engines.',
        'Turbo nặng hơn Nano — GPU giúp trải nghiệm tốt hơn.',
    ],
    bestFor: [
        'English clone / character (Turbo).',
        'CPU nhẹ / on-device (Nano).',
        'Dialogue và narration sáng tạo.',
    ],
    avoidWhen: [
        'Vietnamese → VieNeu.',
        'English thuần tốc độ nhẹ → Kokoro/Kitten.',
    ],
    license: {
        codeLicense: 'MIT (resemble-ai/chatterbox)',
        modelLicense: 'MIT (ResembleAI/chatterbox-nano · chatterbox-turbo)',
        attentionRequired: false,
    },
    settings: {
        voiceSettingKey: 'chatterboxRef',
        variantSettingKey: 'chatterboxVariant',
        speedSettingKey: null,
    },
    modelsSubdir: 'chatterbox',
    modelVariant: 'nano',
    modelVariants: ['nano', 'turbo'],
    installMarker: null,
    badges: ['CPU', 'GPU', 'Offline', 'English', 'Clone', 'Biểu cảm', 'Optional'],
});

register({
    id: 'qwen3',
    family: 'qwen3',
    displayName: 'Qwen3-TTS 0.6B',
    subtitle: 'Clone và điều khiển giọng nâng cao',
    description:
        'Qwen3-TTS 0.6B (CustomVoice + Base). Isolated PyTorch — không vào core. '
        + 'Preset speakers / voice clone theo official API. Không VoiceDesign (1.7B). '
        + '10 ngôn ngữ official — không Vietnamese.',
    positioning: 'Model nâng cao cho các ngôn ngữ được hỗ trợ.',
    EngineClass: require('./qwen3-engine.cjs').Qwen3Engine,
    mode: null,
    outputFormat: 'wav',
    bundled: false,
    optional: true,
    local: true,
    online: false,
    languages: ['zh', 'en', 'ja', 'ko', 'de', 'fr', 'ru', 'pt', 'es', 'it'],
    primaryLanguages: ['zh', 'en'],
    languageSupport: {
        zh: lang(LEVEL.SUPPORTED, { recommended: true, source: 'official' }),
        en: lang(LEVEL.SUPPORTED, { recommended: true, source: 'official' }),
        ja: lang(LEVEL.SUPPORTED, { recommended: true, source: 'official' }),
        ko: lang(LEVEL.SUPPORTED, { recommended: true, source: 'official' }),
        de: lang(LEVEL.SUPPORTED, { recommended: true, source: 'official' }),
        fr: lang(LEVEL.SUPPORTED, { recommended: true, source: 'official' }),
        ru: lang(LEVEL.SUPPORTED, { recommended: true, source: 'official' }),
        pt: lang(LEVEL.SUPPORTED, { recommended: true, source: 'official' }),
        es: lang(LEVEL.SUPPORTED, { recommended: true, source: 'official' }),
        it: lang(LEVEL.SUPPORTED, { recommended: true, source: 'official' }),
        vi: lang(LEVEL.UNSUPPORTED, {
            recommended: false,
            source: 'official',
            note: 'Checkpoint Qwen3-TTS 0.6B hiện tại không quảng cáo tiếng Việt chính thức.',
        }),
        multi: lang(LEVEL.SUPPORTED, {
            recommended: true,
            source: 'official',
            note: 'Đa ngôn ngữ theo official Qwen3-TTS language list (không gồm VI).',
        }),
    },
    variantLanguageSupport: {
        '0.6b-custom': {
            vi: lang(LEVEL.UNSUPPORTED, {
                recommended: false,
                source: 'official',
                note: '0.6B CustomVoice — không Vietnamese official.',
            }),
        },
        '0.6b-base': {
            vi: lang(LEVEL.UNSUPPORTED, {
                recommended: false,
                source: 'official',
                note: '0.6B Base clone — không Vietnamese official.',
            }),
        },
    },
    runtimeStrategy: 'ISOLATED_PYTHON',
    runtimeId: 'qwen3',
    capabilities: {
        cpu: true,
        gpu: true,
        presetVoices: true,
        voiceClone: true,
        speed: false,
        emotion: false,
        expressionTags: false,
        voiceDesign: false,
        nativeBatch: true,
        streaming: false,
        volume: false,
        pauseScale: false,
        languageSelect: true,
        totalSteps: false,
        modelVariantSelect: true,
    },
    strengths: [
        'Voice cloning.',
        'Custom speakers.',
        'Điều khiển phong cách nâng cao.',
        'Phù hợp người dùng có GPU.',
    ],
    weaknesses: [
        'Nặng hơn model ONNX.',
        'Runtime lớn.',
        'Load chậm hơn.',
        'Không phải Vietnamese engine chính thức nếu upstream chưa support.',
        'Voice Design hoàn chỉnh cần model khác/lớn hơn.',
    ],
    bestFor: [
        'Advanced voice cloning.',
        'Ngôn ngữ được official hỗ trợ.',
        'GPU PC.',
    ],
    avoidWhen: [
        'Vietnamese → VieNeu/Supertonic.',
        'CPU → Supertonic/Kokoro/Kitten.',
        'English expressive đơn giản hơn → Chatterbox.',
    ],
    license: {
        codeLicense: 'Apache-2.0 (QwenLM/Qwen3-TTS · qwen-tts)',
        modelLicense: 'Apache-2.0 (Qwen/Qwen3-TTS-12Hz-0.6B-*)',
        attentionRequired: false,
    },
    settings: {
        voiceSettingKey: 'qwen3Voice',
        variantSettingKey: 'qwen3Variant',
        speedSettingKey: null,
        langSettingKey: 'qwen3Lang',
    },
    modelsSubdir: 'qwen3',
    modelVariant: '0.6b-custom',
    modelVariants: ['0.6b-custom', '0.6b-base'],
    installMarker: null,
    badges: ['GPU', 'Offline', 'Clone', 'Multilingual', 'Optional'],
});

register({
    id: 'spark',
    family: 'spark',
    displayName: 'Spark-TTS 0.5B',
    subtitle: 'Clone giọng nâng cao · Speaker controls',
    description:
        'SparkAudio Spark-TTS 0.5B. Isolated PyTorch — không Conda / không Gradio. '
        + 'Zero-shot voice cloning + gender/pitch/speed. Official: Chinese + English.',
    positioning: 'Clone giọng nâng cao cho Chinese và English.',
    EngineClass: require('./spark-engine.cjs').SparkEngine,
    mode: null,
    outputFormat: 'wav',
    bundled: false,
    optional: true,
    local: true,
    online: false,
    languages: ['zh', 'en'],
    primaryLanguages: ['zh', 'en'],
    languageSupport: {
        zh: lang(LEVEL.SUPPORTED, {
            recommended: true,
            source: 'official',
            note: 'Spark-TTS 0.5B official: Chinese.',
        }),
        en: lang(LEVEL.SUPPORTED, {
            recommended: true,
            source: 'official',
            note: 'Spark-TTS 0.5B official: English.',
        }),
        vi: lang(LEVEL.UNSUPPORTED, {
            recommended: false,
            source: 'official',
            note: 'Checkpoint Spark-TTS 0.5B không hỗ trợ tiếng Việt chính thức.',
        }),
    },
    runtimeStrategy: 'ISOLATED_PYTHON',
    runtimeId: 'spark',
    capabilities: {
        cpu: true,
        gpu: true,
        presetVoices: false,
        voiceClone: true,
        speed: false,
        emotion: false,
        expressionTags: false,
        voiceDesign: false,
        nativeBatch: true,
        streaming: false,
        volume: false,
        pauseScale: false,
        languageSelect: true,
        totalSteps: false,
        modelVariantSelect: false,
        speakerControls: true,
        voiceMode: true,
    },
    strengths: [
        'Voice cloning.',
        'Điều khiển speaker.',
        'Phù hợp advanced voice creation.',
        'Hỗ trợ ngôn ngữ official của Spark.',
    ],
    weaknesses: [
        'Model/runtime nặng hơn.',
        'GPU khuyến nghị.',
        'Không phải Vietnamese engine nếu upstream không support.',
        'Cài đặt lớn hơn lightweight models.',
    ],
    bestFor: [
        'Advanced voice clone.',
        'PC có GPU.',
        'Cần speaker controls.',
    ],
    avoidWhen: [
        'Vietnamese → VieNeu.',
        'CPU → Supertonic/Kokoro/Kitten.',
        'English expression → Chatterbox.',
    ],
    license: {
        codeLicense: 'Apache-2.0 (SparkAudio/Spark-TTS)',
        modelLicense: 'Apache-2.0 (SparkAudio/Spark-TTS-0.5B)',
        attentionRequired: false,
    },
    settings: {
        voiceSettingKey: 'sparkMode',
        voiceModeSettingKey: 'sparkMode',
        variantSettingKey: null,
        speedSettingKey: null,
        langSettingKey: 'sparkLang',
    },
    modelsSubdir: 'spark',
    modelVariant: '0.5b',
    modelVariants: ['0.5b'],
    installMarker: null,
    badges: ['GPU', 'Offline', 'Clone', 'Chinese', 'English', 'Optional'],
});

register({
    id: 'gpt-sovits',
    family: 'gpt-sovits',
    category: 'voice-lab',
    displayName: 'GPT-SoVITS',
    subtitle: 'Voice Lab · Clone giọng chuyên sâu',
    description:
        'GPT-SoVITS inference (RVC-Boss) — Voice Lab. Isolated PyTorch, không Gradio WebUI, không training trong app. '
        + 'Reference audio/text/lang + GPT/SoVITS checkpoint. Ngôn ngữ theo upstream/checkpoint (không quảng cáo Vietnamese).',
    positioning: 'Voice Lab nâng cao — checkpoint và reference do bạn chọn.',
    EngineClass: require('./gpt-sovits-engine.cjs').GptSovitsEngine,
    mode: null,
    outputFormat: 'wav',
    bundled: false,
    optional: true,
    local: true,
    online: false,
    languages: ['zh', 'en', 'ja', 'yue', 'ko'],
    primaryLanguages: ['zh', 'en'],
    languageSupportDependsOnCheckpoint: true,
    languageSupport: {
        zh: lang(LEVEL.SUPPORTED, {
            recommended: true,
            source: 'official',
            note: 'Upstream GPT-SoVITS v2 language set gồm zh — phụ thuộc checkpoint.',
            dependsOnCheckpoint: true,
        }),
        en: lang(LEVEL.SUPPORTED, {
            recommended: true,
            source: 'official',
            note: 'Upstream gồm en — phụ thuộc checkpoint.',
            dependsOnCheckpoint: true,
        }),
        ja: lang(LEVEL.SUPPORTED, {
            recommended: true,
            source: 'official',
            dependsOnCheckpoint: true,
        }),
        yue: lang(LEVEL.SUPPORTED, {
            recommended: true,
            source: 'official',
            dependsOnCheckpoint: true,
        }),
        ko: lang(LEVEL.SUPPORTED, {
            recommended: true,
            source: 'official',
            dependsOnCheckpoint: true,
        }),
        vi: lang(LEVEL.UNSUPPORTED, {
            recommended: false,
            source: 'community',
            note: 'Không gắn Vietnamese official chỉ vì community checkpoint. License determined by model provider.',
            dependsOnCheckpoint: true,
        }),
    },
    runtimeStrategy: 'ISOLATED_PYTHON',
    runtimeId: 'gpt-sovits',
    capabilities: {
        cpu: true,
        gpu: true,
        presetVoices: false,
        voiceClone: true,
        speed: true,
        emotion: false,
        expressionTags: false,
        voiceDesign: false,
        nativeBatch: true,
        streaming: false,
        volume: false,
        pauseScale: false,
        languageSelect: true,
        totalSteps: false,
        modelVariantSelect: false,
        speakerControls: false,
        voiceMode: false,
        voiceProfiles: true,
        customCheckpoints: true,
    },
    strengths: [
        'Voice cloning nâng cao.',
        'Custom checkpoints.',
        'Hệ sinh thái cộng đồng lớn.',
        'Có thể mở rộng sang training/fine-tuning sau này.',
    ],
    weaknesses: [
        'Phức tạp.',
        'Nhiều dependency.',
        'Không phù hợp người mới.',
        'Model/checkpoint dễ gây nhầm.',
        'Nặng hơn TTS thông thường.',
    ],
    bestFor: [
        'Người dùng nâng cao.',
        'Có reference audio.',
        'Muốn dùng checkpoint riêng.',
    ],
    avoidWhen: [
        'Instant Vietnamese clone → VieNeu.',
        'English clone dễ dùng → Chatterbox.',
    ],
    license: {
        codeLicense: 'MIT (RVC-Boss/GPT-SoVITS — verify upstream)',
        modelLicense: 'User-provided checkpoints (community / own)',
        attentionRequired: true,
    },
    settings: {
        voiceSettingKey: 'gptSovitsProfile',
        voiceModeSettingKey: null,
        variantSettingKey: null,
        speedSettingKey: null,
        langSettingKey: 'gptSovitsTextLang',
    },
    modelsSubdir: 'gpt-sovits',
    modelVariant: 'infer',
    modelVariants: ['infer'],
    installMarker: null,
    badges: ['Voice Lab', 'GPU', 'Offline', 'Clone', 'Nâng cao', 'Optional'],
});

for (const entry of engines.values()) {
    assertRequiredMetadata(entry);
}

/** @param {string} engineId @param {string} languageCode @param {string|null} [variant] */
function getLanguageSupport(engineId, languageCode, variant = null) {
    const entry = getEngine(engineId);
    if (!entry) return null;
    return langSupport.resolveLanguageSupport(entry, languageCode, variant);
}

/** @param {string} engineId @param {string|null} [variant] */
function getVietnameseSupport(engineId, variant = null) {
    return getLanguageSupport(engineId, 'vi', variant);
}

/**
 * @param {string} engineId
 * @param {string} languageCode
 * @param {{ includeExperimental?: boolean, variant?: string|null }} [opts]
 */
function supportsLanguage(engineId, languageCode, opts = {}) {
    const entry = getEngine(engineId);
    if (!entry) return false;
    return langSupport.supportsLanguage(entry, languageCode, {
        includeExperimental: opts.includeExperimental === true,
        variant: opts.variant ?? null,
    });
}

/**
 * Engines that support `languageCode`, sorted native → supported → experimental → unsupported.
 * @param {string} languageCode
 * @param {{
 *   includeExperimental?: boolean,
 *   includeUnsupported?: boolean,
 *   variantOf?: (entry: object) => string|null,
 *   installStateOf?: (entry: object) => string|null,
 * }} [options]
 */
function getEnginesByLanguage(languageCode, options = {}) {
    const includeExperimental = options.includeExperimental === true;
    const includeUnsupported = options.includeUnsupported === true;
    const variantOf = typeof options.variantOf === 'function' ? options.variantOf : () => null;
    const installStateOf = typeof options.installStateOf === 'function'
        ? options.installStateOf
        : () => null;

    const filtered = listEngines().filter((entry) => {
        const info = langSupport.resolveLanguageSupport(
            entry,
            languageCode,
            variantOf(entry)
        );
        if (!info) return false;
        if (info.level === langSupport.LEVEL.NATIVE || info.level === langSupport.LEVEL.SUPPORTED) {
            return true;
        }
        if (includeExperimental && info.level === langSupport.LEVEL.EXPERIMENTAL) return true;
        if (includeUnsupported && info.level === langSupport.LEVEL.UNSUPPORTED) return true;
        return false;
    });

    return langSupport.sortEnginesByLanguage(filtered, languageCode, {
        variantOf,
        installStateOf,
    });
}

module.exports = {
    INSTALL,
    ID_ALIASES,
    /** @deprecated use ID_ALIASES */
    LEGACY_ID_ALIASES: ID_ALIASES,
    REQUIRED_FIELDS,
    register,
    resolveId,
    getEngine,
    listEngines,
    hasEngine,
    get,
    list,
    listPublic,
    modelsDirFor,
    assertRequiredMetadata,
    // Prompt 25 — language support API
    LEVEL: langSupport.LEVEL,
    VI_LABELS: langSupport.VI_LABELS,
    VISUAL_INTENT: langSupport.VISUAL_INTENT,
    getLanguageSupport,
    getVietnameseSupport,
    supportsLanguage,
    getEnginesByLanguage,
    vietnameseLabel: langSupport.vietnameseLabel,
    visualIntent: langSupport.visualIntent,
    sortEnginesByLanguage: langSupport.sortEnginesByLanguage,
};
