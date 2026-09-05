/**
 * Pure Engine Selector model — grouping, badges, search, install labels.
 * No DOM. Driven by registry languageSupport (Prompt 25/26).
 */

export const LEVEL = Object.freeze({
    NATIVE: 'native',
    SUPPORTED: 'supported',
    EXPERIMENTAL: 'experimental',
    UNSUPPORTED: 'unsupported',
});

export const VI_LABEL = Object.freeze({
    [LEVEL.NATIVE]: 'Tốt cho tiếng Việt',
    [LEVEL.SUPPORTED]: 'Có tiếng Việt',
    [LEVEL.EXPERIMENTAL]: 'Tiếng Việt thử nghiệm',
    [LEVEL.UNSUPPORTED]: 'Không hỗ trợ tiếng Việt chính thức',
});

export const VI_BADGE = Object.freeze({
    [LEVEL.NATIVE]: { text: '🇻🇳 Tốt cho tiếng Việt', tone: 'vi-native' },
    [LEVEL.SUPPORTED]: { text: '🇻🇳 Có tiếng Việt', tone: 'vi-supported' },
    [LEVEL.EXPERIMENTAL]: { text: '🧪 Tiếng Việt thử nghiệm', tone: 'vi-experimental' },
    [LEVEL.UNSUPPORTED]: { text: 'Không hỗ trợ tiếng Việt chính thức', tone: 'vi-unsupported' },
});

/** Default filter tabs (VN-first). */
export const FILTERS = Object.freeze([
    { id: 'vi', label: '🇻🇳 Tiếng Việt' },
    { id: 'all', label: 'Tất cả' },
    { id: 'en', label: 'English' },
    { id: 'multi', label: 'Đa ngôn ngữ' },
    { id: 'clone', label: 'Clone giọng' },
    { id: 'no-gpu', label: 'Máy không GPU' },
    { id: 'advanced', label: 'Nâng cao' },
    { id: 'installed', label: 'Đã cài' },
]);

export const DEFAULT_FILTER = 'vi';

const MAX_BADGES = 5;

export function viSupport(engine) {
    return engine?.languageSupport?.vi || null;
}

export function viLevel(engine) {
    const lv = viSupport(engine)?.level;
    if (lv === LEVEL.NATIVE || lv === LEVEL.SUPPORTED
        || lv === LEVEL.EXPERIMENTAL || lv === LEVEL.UNSUPPORTED) {
        return lv;
    }
    // Legacy fallback: languages[] only (never invent native)
    if ((engine?.languages || []).includes('vi')) return LEVEL.SUPPORTED;
    return LEVEL.UNSUPPORTED;
}

export function enLevel(engine) {
    const lv = engine?.languageSupport?.en?.level;
    if (lv === LEVEL.NATIVE || lv === LEVEL.SUPPORTED
        || lv === LEVEL.EXPERIMENTAL || lv === LEVEL.UNSUPPORTED) {
        return lv;
    }
    if ((engine?.languages || []).some((l) => l === 'en' || l === 'multi')) {
        return LEVEL.SUPPORTED;
    }
    return LEVEL.UNSUPPORTED;
}

export function isMultilingual(engine) {
    if (engine?.languageSupport?.multi?.level === LEVEL.NATIVE
        || engine?.languageSupport?.multi?.level === LEVEL.SUPPORTED) {
        return true;
    }
    return (engine?.languages || []).includes('multi')
        || (engine?.badges || []).some((b) => /đa ngôn ngữ|multilingual/i.test(String(b)));
}

export function isAdvanced(engine) {
    if (engine?.category === 'voice-lab') return true;
    if (Boolean(engine?.experimental)) return true;
    if ((engine?.badges || []).some((b) => /voice lab/i.test(String(b)))) return true;
    // Heavy optional clone engines without official VI — advanced path, not beginner VI picks
    const caps = engine?.capabilities || {};
    if ((caps.voiceClone || caps.customCheckpoints) && viLevel(engine) === LEVEL.UNSUPPORTED && !isLight(engine)) {
        return true;
    }
    return false;
}

export function isLight(engine) {
    return (engine?.badges || []).some((b) => /nhẹ|light|nano|preview/i.test(String(b)))
        || /nano|mini|micro|light/i.test(String(engine?.displayName || ''))
        || /nano|mini|micro|light|yếu/i.test(String(engine?.positioning || ''));
}

export function installStatus(engine) {
    if (engine?.bundled) return { id: 'bundled', label: 'Bundled' };
    const st = engine?.installState;
    if (st === 'INSTALLING') return { id: 'installing', label: 'Đang tải' };
    if (st === 'BROKEN') return { id: 'broken', label: 'Lỗi model' };
    if (st === 'INSTALLED') return { id: 'installed', label: 'Đã cài' };
    if (engine?.optional) return { id: 'missing', label: 'Chưa cài' };
    return { id: 'installed', label: 'Đã cài' };
}

export function needsInstall(engine) {
    const st = installStatus(engine);
    return st.id === 'missing' || st.id === 'broken' || st.id === 'installing';
}

/** Map hardware advisor level → short card sentence (no CUDA CC). */
export function compatCardMessage(advice) {
    if (!advice) return '';
    const level = advice.level;
    if (level === 'RECOMMENDED') return '✓ Rất phù hợp với máy của bạn';
    if (level === 'SUPPORTED') return advice.message || 'Máy của bạn hỗ trợ engine này';
    if (level === 'MAY_BE_SLOW') {
        return 'Có thể chạy nhưng batch lớn có thể chậm';
    }
    if (level === 'NOT_RECOMMENDED') {
        return advice.message?.includes('GPU') || advice.message?.includes('gpu')
            ? 'GPU được khuyến nghị'
            : (advice.message || 'GPU được khuyến nghị');
    }
    if (level === 'UNAVAILABLE') {
        if (advice.reasons?.includes('not-installed')) return '';
        return advice.message || 'Không khả dụng trên máy này';
    }
    return advice.message || '';
}

/**
 * Context recommendation pill (not global "best").
 * @param {object} engine
 * @param {string} filterId
 */
export function contextRecommendLabel(engine, filterId) {
    const vi = viLevel(engine);
    if ((filterId === 'vi' || filterId === 'all') && vi === LEVEL.NATIVE && engine.recommended) {
        return 'Khuyên dùng cho tiếng Việt';
    }
    if ((filterId === 'en' || filterId === 'no-gpu')
        && (enLevel(engine) === LEVEL.NATIVE || enLevel(engine) === LEVEL.SUPPORTED)
        && isLight(engine)
        && !engine.online) {
        return 'Khuyên dùng máy nhẹ';
    }
    return null;
}

/**
 * Priority badges for cards (language first). Cap at MAX_BADGES.
 * @returns {{ text: string, tone: string }[]}
 */
export function buildCardBadges(engine, { filterId = 'vi' } = {}) {
    const out = [];
    const push = (text, tone) => {
        if (!text || out.some((b) => b.text === text)) return;
        if (out.length >= MAX_BADGES) return;
        out.push({ text, tone });
    };

    const vi = viLevel(engine);
    const en = enLevel(engine);
    const caps = engine?.capabilities || {};

    if (vi === LEVEL.NATIVE || vi === LEVEL.SUPPORTED || vi === LEVEL.EXPERIMENTAL) {
        push(VI_BADGE[vi].text, VI_BADGE[vi].tone);
    } else if (filterId === 'all' || filterId === 'en' || filterId === 'advanced') {
        // unsupported: show muted label only when not on VI tab (VI tab hides these)
        if (en === LEVEL.NATIVE || en === LEVEL.SUPPORTED) {
            push('🇬🇧 English', 'lang-en');
        }
    }

    if (isMultilingual(engine) && out.length < MAX_BADGES) {
        push('🌐 Đa ngôn ngữ', 'lang-multi');
    } else if ((en === LEVEL.NATIVE || en === LEVEL.SUPPORTED)
        && vi !== LEVEL.NATIVE && vi !== LEVEL.SUPPORTED
        && !out.some((b) => b.tone === 'lang-en')) {
        push('🇬🇧 English', 'lang-en');
    }

    if (caps.cpu !== false) push('💻 CPU', 'cap-cpu');
    if (caps.gpu) push('⚡ GPU', 'cap-gpu');
    if (caps.voiceClone) push('🎙 Clone giọng', 'cap-clone');
    if (caps.emotion || caps.expressionTags) push('🎭 Biểu cảm', 'cap-emotion');
    if (isLight(engine)) push('🪶 Nhẹ', 'cap-light');
    if (engine?.online) push('☁ Online', 'cap-online');
    else if (engine?.local !== false) push('🔒 Offline', 'cap-offline');
    if (isAdvanced(engine)) push('⚙ Nâng cao', 'cap-advanced');

    return out.slice(0, MAX_BADGES);
}

export function matchesFilter(engine, filterId, { showUnsupportedVi = false } = {}) {
    if (!engine) return false;
    switch (filterId) {
    case 'vi': {
        const lv = viLevel(engine);
        if (showUnsupportedVi) return lv === LEVEL.UNSUPPORTED;
        return lv === LEVEL.NATIVE || lv === LEVEL.SUPPORTED || lv === LEVEL.EXPERIMENTAL;
    }
    case 'all':
        return true;
    case 'en':
        return enLevel(engine) === LEVEL.NATIVE || enLevel(engine) === LEVEL.SUPPORTED;
    case 'multi':
        return isMultilingual(engine);
    case 'clone':
        return Boolean(engine.capabilities?.voiceClone);
    case 'no-gpu':
        return engine.capabilities?.cpu !== false;
    case 'advanced':
        return isAdvanced(engine);
    case 'installed':
        return engine.bundled || engine.installState === 'INSTALLED';
    default:
        return true;
    }
}

const LEVEL_ORDER = {
    [LEVEL.NATIVE]: 0,
    [LEVEL.SUPPORTED]: 1,
    [LEVEL.EXPERIMENTAL]: 2,
    [LEVEL.UNSUPPORTED]: 3,
};

export function sortByViThenName(a, b) {
    const oa = LEVEL_ORDER[viLevel(a)] ?? 9;
    const ob = LEVEL_ORDER[viLevel(b)] ?? 9;
    if (oa !== ob) return oa - ob;
    const ra = viSupport(a)?.recommended ? 0 : 1;
    const rb = viSupport(b)?.recommended ? 0 : 1;
    if (ra !== rb) return ra - rb;
    const ba = a.bundled || a.installState === 'INSTALLED' ? 0 : 1;
    const bb = b.bundled || b.installState === 'INSTALLED' ? 0 : 1;
    if (ba !== bb) return ba - bb;
    return String(a.displayName || a.id).localeCompare(String(b.displayName || b.id), 'vi');
}

/**
 * @returns {{ id: string, title: string, engines: object[] }[]}
 */
export function groupEngines(engines, filterId, opts = {}) {
    const list = (engines || []).filter((e) => matchesFilter(e, filterId, opts));
    const sorted = [...list].sort(sortByViThenName);

    if (filterId === 'vi' && !opts.showUnsupportedVi) {
        const sections = [
            {
                id: 'vi-native',
                title: '🇻🇳 Tốt cho tiếng Việt',
                engines: sorted.filter((e) => viLevel(e) === LEVEL.NATIVE),
            },
            {
                id: 'vi-supported',
                title: '🌐 Có hỗ trợ tiếng Việt',
                engines: sorted.filter((e) => viLevel(e) === LEVEL.SUPPORTED),
            },
            {
                id: 'vi-experimental',
                title: '🧪 Tiếng Việt thử nghiệm',
                engines: sorted.filter((e) => viLevel(e) === LEVEL.EXPERIMENTAL),
            },
        ];
        return sections.filter((s) => s.engines.length);
    }

    if (filterId === 'vi' && opts.showUnsupportedVi) {
        return [{
            id: 'vi-unsupported',
            title: 'Không hỗ trợ tiếng Việt chính thức',
            engines: sorted,
        }];
    }

    if (filterId === 'all') {
        const sections = [
            {
                id: 'all-native',
                title: '🇻🇳 Tốt cho tiếng Việt',
                engines: sorted.filter((e) => viLevel(e) === LEVEL.NATIVE),
            },
            {
                id: 'all-vi-multi',
                title: '🌐 Có tiếng Việt / Đa ngôn ngữ',
                engines: sorted.filter((e) => {
                    const lv = viLevel(e);
                    return lv === LEVEL.SUPPORTED || lv === LEVEL.EXPERIMENTAL;
                }),
            },
            {
                id: 'all-en',
                title: '🇬🇧 English & ngôn ngữ khác',
                engines: sorted.filter((e) => {
                    if (isAdvanced(e)) return false;
                    return viLevel(e) === LEVEL.UNSUPPORTED;
                }),
            },
            {
                id: 'all-advanced',
                title: '⚙ Nâng cao / Voice Lab',
                engines: sorted.filter((e) => isAdvanced(e)),
            },
        ];
        // Avoid duplicates across sections: assign each engine once (first match)
        const seen = new Set();
        return sections.map((s) => ({
            ...s,
            engines: s.engines.filter((e) => {
                if (seen.has(e.id)) return false;
                seen.add(e.id);
                return true;
            }),
        })).filter((s) => s.engines.length);
    }

    return [{ id: filterId, title: '', engines: sorted }];
}

const SEARCH_ALIASES = Object.freeze([
    { re: /tiếng\s*việt|vietnamese|\bvi\b/i, tags: ['vi', 'vietnamese', 'tiếng việt'] },
    { re: /clone|nhân\s*bản|giọng/i, tags: ['clone', 'voiceclone'] },
    { re: /máy\s*yếu|nhẹ|light|nano|yếu/i, tags: ['light', 'nhẹ', 'cpu'] },
    { re: /english|\ben\b|anh/i, tags: ['en', 'english'] },
    { re: /đa\s*ngôn\s*ngữ|multi/i, tags: ['multi', 'đa ngôn ngữ'] },
    { re: /gpu|nvidia/i, tags: ['gpu'] },
    { re: /offline|ngoại\s*tuyến/i, tags: ['offline'] },
    { re: /online|mạng|internet/i, tags: ['online'] },
]);

export function searchHaystack(engine) {
    const vi = viSupport(engine);
    const parts = [
        engine.displayName,
        engine.subtitle,
        engine.positioning,
        engine.description,
        ...(engine.languages || []),
        ...(engine.primaryLanguages || []),
        ...(engine.badges || []),
        ...(engine.strengths || []),
        ...(engine.weaknesses || []),
        ...(engine.bestFor || []),
        ...(engine.avoidWhen || []),
        vi?.label,
        vi?.level,
        vi?.note,
        engine.capabilities?.voiceClone ? 'clone voiceclone' : '',
        engine.capabilities?.gpu ? 'gpu' : '',
        engine.capabilities?.cpu !== false ? 'cpu' : '',
        engine.online ? 'online' : 'offline',
        isLight(engine) ? 'nhẹ light máy yếu' : '',
        isMultilingual(engine) ? 'đa ngôn ngữ multilingual multi' : '',
        isAdvanced(engine) ? 'nâng cao voice lab advanced' : '',
        viLevel(engine) !== LEVEL.UNSUPPORTED ? 'tiếng việt vietnamese vi' : '',
    ];
    return parts.filter(Boolean).join(' ').toLowerCase();
}

export function matchesSearch(engine, query) {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return true;
    const hay = searchHaystack(engine);
    if (hay.includes(q)) return true;
    for (const alias of SEARCH_ALIASES) {
        if (alias.re.test(q) && alias.tags.some((t) => hay.includes(t))) return true;
    }
    // token AND
    const tokens = q.split(/\s+/).filter(Boolean);
    return tokens.every((t) => hay.includes(t));
}

export function filterBySearch(engines, query) {
    return (engines || []).filter((e) => matchesSearch(e, query));
}

/** Strengths/weaknesses preview (collapsed rest in details). */
export function previewList(items, max = 3) {
    const list = Array.isArray(items) ? items : [];
    return list.slice(0, max);
}
