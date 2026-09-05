/**
 * Language support metadata helpers for Engine Registry.
 * Levels only: native | supported | experimental | unsupported.
 * No fake quality scores. No UI/CSS colors here — visualIntent tokens only.
 */

const LEVEL = Object.freeze({
    NATIVE: 'native',
    SUPPORTED: 'supported',
    EXPERIMENTAL: 'experimental',
    UNSUPPORTED: 'unsupported',
});

/** Sort priority: lower = better for that language. */
const LEVEL_ORDER = Object.freeze({
    [LEVEL.NATIVE]: 0,
    [LEVEL.SUPPORTED]: 1,
    [LEVEL.EXPERIMENTAL]: 2,
    [LEVEL.UNSUPPORTED]: 3,
});

/** Canonical Vietnamese UI labels (Prompt 25). */
const VI_LABELS = Object.freeze({
    [LEVEL.NATIVE]: 'Tốt cho tiếng Việt',
    [LEVEL.SUPPORTED]: 'Có tiếng Việt',
    [LEVEL.EXPERIMENTAL]: 'Tiếng Việt thử nghiệm',
    [LEVEL.UNSUPPORTED]: 'Không hỗ trợ tiếng Việt chính thức',
});

/** Design-token intents — UI maps these to colors; registry stays color-free. */
const VISUAL_INTENT = Object.freeze({
    [LEVEL.NATIVE]: 'positive-prominent',
    [LEVEL.SUPPORTED]: 'positive',
    [LEVEL.EXPERIMENTAL]: 'warning',
    [LEVEL.UNSUPPORTED]: 'muted-negative',
});

function isLevel(v) {
    return Object.values(LEVEL).includes(v);
}

function defaultLabel(langCode, level) {
    const code = String(langCode || '').toLowerCase();
    if (code === 'vi') return VI_LABELS[level] || VI_LABELS[LEVEL.UNSUPPORTED];
    if (code === 'en') {
        if (level === LEVEL.NATIVE) return 'Tốt cho English';
        if (level === LEVEL.SUPPORTED) return 'Có hỗ trợ English';
        if (level === LEVEL.EXPERIMENTAL) return 'English thử nghiệm';
        return 'Không hỗ trợ English chính thức';
    }
    if (code === 'multi' || code === 'multilingual') {
        if (level === LEVEL.NATIVE || level === LEVEL.SUPPORTED) return 'Đa ngôn ngữ';
        if (level === LEVEL.EXPERIMENTAL) return 'Đa ngôn ngữ thử nghiệm';
        return 'Không đa ngôn ngữ chính thức';
    }
    if (level === LEVEL.NATIVE) return `Tốt cho ${code}`;
    if (level === LEVEL.SUPPORTED) return `Có hỗ trợ ${code}`;
    if (level === LEVEL.EXPERIMENTAL) return `${code} thử nghiệm`;
    return `Không hỗ trợ ${code} chính thức`;
}

/**
 * @param {string} level
 * @param {object} [opts]
 */
function lang(level, opts = {}) {
    if (!isLevel(level)) throw new Error(`Invalid language support level: ${level}`);
    return {
        level,
        recommended: opts.recommended === true,
        label: opts.label || null,
        note: opts.note || '',
        source: opts.source || 'official',
        dependsOnVoice: Boolean(opts.dependsOnVoice),
        dependsOnCheckpoint: Boolean(opts.dependsOnCheckpoint),
    };
}

function freezeOne(code, raw = {}) {
    const level = isLevel(raw.level) ? raw.level : LEVEL.UNSUPPORTED;
    return Object.freeze({
        level,
        recommended: Boolean(raw.recommended),
        label: raw.label || defaultLabel(code, level),
        note: String(raw.note || ''),
        source: String(raw.source || 'unknown'),
        dependsOnVoice: Boolean(raw.dependsOnVoice),
        dependsOnCheckpoint: Boolean(raw.dependsOnCheckpoint),
    });
}

function freezeLanguageSupport(map = {}) {
    const out = {};
    for (const [code, raw] of Object.entries(map || {})) {
        out[String(code).toLowerCase()] = freezeOne(String(code).toLowerCase(), raw);
    }
    return Object.freeze(out);
}

function freezeVariantLanguageSupport(map = {}) {
    const out = {};
    for (const [variant, support] of Object.entries(map || {})) {
        out[variant] = freezeLanguageSupport(support);
    }
    return Object.freeze(out);
}

/**
 * Merge engine.languageSupport with optional variantLanguageSupport[variant].
 * Missing language → synthetic unsupported (not invented as supported).
 */
function resolveLanguageSupport(entry, languageCode, variant = null) {
    if (!entry) return null;
    const code = String(languageCode || '').toLowerCase().trim();
    if (!code) return null;

    let base = entry.languageSupport?.[code] || null;
    if (variant && entry.variantLanguageSupport?.[variant]?.[code]) {
        base = entry.variantLanguageSupport[variant][code];
    }
    if (base) return base;

    return freezeOne(code, {
        level: LEVEL.UNSUPPORTED,
        recommended: false,
        source: 'inferred',
        note: 'Không có metadata chính thức cho ngôn ngữ này trên engine/variant hiện tại.',
    });
}

function getVietnameseSupport(entry, variant = null) {
    return resolveLanguageSupport(entry, 'vi', variant);
}

function supportsLanguage(entry, languageCode, {
    includeExperimental = false,
    variant = null,
} = {}) {
    const info = resolveLanguageSupport(entry, languageCode, variant);
    if (!info) return false;
    if (info.level === LEVEL.NATIVE || info.level === LEVEL.SUPPORTED) return true;
    if (includeExperimental && info.level === LEVEL.EXPERIMENTAL) return true;
    return false;
}

function compareLanguageLevel(a, b) {
    const oa = LEVEL_ORDER[a?.level] ?? 99;
    const ob = LEVEL_ORDER[b?.level] ?? 99;
    if (oa !== ob) return oa - ob;
    const ra = a?.recommended ? 0 : 1;
    const rb = b?.recommended ? 0 : 1;
    if (ra !== rb) return ra - rb;
    return 0;
}

/**
 * Sort engines for a language: native → supported → experimental → unsupported,
 * then recommended, bundled/installed, displayName. No quality score.
 */
function sortEnginesByLanguage(entries, languageCode, {
    variantOf = () => null,
    installStateOf = () => null,
} = {}) {
    const code = String(languageCode || '').toLowerCase();
    return [...(entries || [])].sort((ea, eb) => {
        const va = variantOf(ea);
        const vb = variantOf(eb);
        const sa = resolveLanguageSupport(ea, code, va);
        const sb = resolveLanguageSupport(eb, code, vb);
        const byLevel = compareLanguageLevel(sa, sb);
        if (byLevel !== 0) return byLevel;

        const instA = ea.bundled || installStateOf(ea) === 'INSTALLED' ? 0 : 1;
        const instB = eb.bundled || installStateOf(eb) === 'INSTALLED' ? 0 : 1;
        if (instA !== instB) return instA - instB;

        return String(ea.displayName || ea.id || '')
            .localeCompare(String(eb.displayName || eb.id || ''), 'vi');
    });
}

function vietnameseLabel(level) {
    return VI_LABELS[level] || VI_LABELS[LEVEL.UNSUPPORTED];
}

function visualIntent(level) {
    return VISUAL_INTENT[level] || VISUAL_INTENT[LEVEL.UNSUPPORTED];
}

function derivePrimaryLanguages(languageSupport, languages) {
    const fromSupport = Object.entries(languageSupport || {})
        .filter(([, s]) => s.recommended && (s.level === LEVEL.NATIVE || s.level === LEVEL.SUPPORTED))
        .map(([code]) => code);
    if (fromSupport.length) return fromSupport;
    return [...(languages || [])];
}

module.exports = {
    LEVEL,
    LEVEL_ORDER,
    VI_LABELS,
    VISUAL_INTENT,
    lang,
    freezeLanguageSupport,
    freezeVariantLanguageSupport,
    freezeOne,
    resolveLanguageSupport,
    getVietnameseSupport,
    supportsLanguage,
    compareLanguageLevel,
    sortEnginesByLanguage,
    vietnameseLabel,
    visualIntent,
    defaultLabel,
    derivePrimaryLanguages,
    isLevel,
};
