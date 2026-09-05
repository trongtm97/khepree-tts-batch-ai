/**
 * Lightweight local language detection (no LLM, no network, no Python).
 * Heuristic script + stopword scoring — UX-grade, not research LID.
 */

export const LANG = Object.freeze({
    VI: 'vi',
    EN: 'en',
    ZH: 'zh',
    JA: 'ja',
    KO: 'ko',
    MIXED: 'mixed',
    UNKNOWN: 'unknown',
});

export const LANG_LABEL = Object.freeze({
    [LANG.VI]: 'Tiếng Việt',
    [LANG.EN]: 'English',
    [LANG.ZH]: 'Chinese',
    [LANG.JA]: 'Japanese',
    [LANG.KO]: 'Korean',
    [LANG.MIXED]: 'Hỗn hợp / Đa ngôn ngữ',
    [LANG.UNKNOWN]: 'Chưa xác định',
    auto: 'Tự động',
});

const MIN_SIGNAL_CHARS = 12;
const SAMPLE_MAX_CHARS = 8000;
const SAMPLE_HEAD = 40;
const SAMPLE_MID = 25;
const SAMPLE_TAIL = 25;

/** Common Vietnamese function words (no diacritics) — conservative. */
const VI_PLAIN = new Set([
    'xin', 'chao', 'cac', 'ban', 'hom', 'nay', 'chung', 'toi', 'minh', 'chungta',
    'khong', 'duoc', 'cua', 'voi', 'cho', 'trong', 'tren', 'duoi', 'nhung', 'nhieu',
    'nguoi', 'viec', 'lam', 'noi', 'dung', 'thoi', 'gian', 'homnay', 'homqua',
    'cam', 'on', 'rat', 'vui', 'duoc', 'hay', 'thi', 'neu', 'vi', 'vi', 'sao',
    'bao', 'nhieu', 'cai', 'nay', 'kia', 'day', 'do', 'se', 'da', 'dang', 'van',
    'con', 'ma', 'la', 'va', 'hoac', 'nhu', 'the', 'nao', 'gi', 'ai', 'dau',
]);

const EN_STOP = new Set([
    'the', 'and', 'for', 'that', 'with', 'this', 'from', 'have', 'was', 'are',
    'you', 'your', 'not', 'but', 'they', 'will', 'can', 'been', 'been', 'about',
    'what', 'when', 'where', 'which', 'their', 'there', 'been', 'into', 'more',
]);

const VI_DIACritic_RE = /[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/i;
const HAN_RE = /[\u4e00-\u9fff]/;
const HIRA_KATA_RE = /[\u3040-\u30ff]/;
const HANGUL_RE = /[\uac00-\ud7af]/;
const LATIN_WORD_RE = /[a-zA-ZÀ-ỹđĐ]{2,}/g;

function emptyResult(language = LANG.UNKNOWN) {
    return {
        language,
        confidence: 0,
        distribution: null,
        sampleChars: 0,
        reason: 'empty',
    };
}

/**
 * Sample job texts: head + mid + tail, capped by total characters.
 * @param {{ text?: string }[]} jobs
 */
export function sampleJobTexts(jobs, {
    maxChars = SAMPLE_MAX_CHARS,
    head = SAMPLE_HEAD,
    mid = SAMPLE_MID,
    tail = SAMPLE_TAIL,
} = {}) {
    const list = (jobs || []).filter((j) => String(j?.text || '').trim());
    if (!list.length) return '';

    const pick = new Set();
    const n = list.length;
    for (let i = 0; i < Math.min(head, n); i++) pick.add(i);
    for (let i = Math.max(0, n - tail); i < n; i++) pick.add(i);
    if (n > head + tail && mid > 0) {
        const start = head;
        const end = Math.max(start, n - tail);
        const span = end - start;
        if (span > 0) {
            const step = Math.max(1, Math.floor(span / mid));
            for (let i = start; i < end && pick.size < head + mid + tail; i += step) {
                pick.add(i);
            }
        }
    }

    let out = '';
    const idxs = [...pick].sort((a, b) => a - b);
    for (const i of idxs) {
        const t = String(list[i].text || '').trim();
        if (!t) continue;
        if (out.length + t.length + 1 > maxChars) {
            out += (out ? '\n' : '') + t.slice(0, Math.max(0, maxChars - out.length));
            break;
        }
        out += (out ? '\n' : '') + t;
    }
    return out;
}

function scoreText(text) {
    const raw = String(text || '');
    let han = 0;
    let hira = 0;
    let hangul = 0;
    let latin = 0;
    let viMarks = 0;
    let other = 0;

    for (const ch of raw) {
        if (/\s|\d|[.,;:!?…\-–—"'“”‘’()[\]{}]/.test(ch)) continue;
        if (HAN_RE.test(ch)) { han += 1; continue; }
        if (HIRA_KATA_RE.test(ch)) { hira += 1; continue; }
        if (HANGUL_RE.test(ch)) { hangul += 1; continue; }
        if (/[a-zA-ZÀ-ỹđĐ]/.test(ch)) {
            latin += 1;
            if (VI_DIACritic_RE.test(ch)) viMarks += 1;
            continue;
        }
        if (ch.trim()) other += 1;
    }

    const letters = han + hira + hangul + latin;
    const words = (raw.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').match(LATIN_WORD_RE) || [])
        .map((w) => w.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/g, 'd'));

    let viPlainHits = 0;
    let enHits = 0;
    for (const w of words) {
        if (VI_PLAIN.has(w)) viPlainHits += 1;
        if (EN_STOP.has(w)) enHits += 1;
    }

    return {
        han, hira, hangul, latin, viMarks, other, letters,
        wordCount: words.length,
        viPlainHits,
        enHits,
    };
}

/**
 * Detect language of a text blob.
 * @returns {{ language: string, confidence: number, distribution: object|null, sampleChars: number, reason: string }}
 */
export function detectTextLanguage(text) {
    const raw = String(text || '').trim();
    if (!raw) return emptyResult();

    const s = scoreText(raw);
    if (s.letters < MIN_SIGNAL_CHARS && s.wordCount < 4) {
        return {
            language: LANG.UNKNOWN,
            confidence: 0,
            distribution: null,
            sampleChars: raw.length,
            reason: 'too-short',
        };
    }

    // Script-dominant non-Latin
    const scriptTotal = s.han + s.hira + s.hangul + s.latin;
    if (scriptTotal > 0) {
        if (s.hira / scriptTotal >= 0.15 || (s.hira > 8 && s.hira >= s.han * 0.2)) {
            const conf = Math.min(0.95, 0.55 + s.hira / scriptTotal);
            return pack(LANG.JA, conf, s, raw.length, 'kana');
        }
        if (s.hangul / scriptTotal >= 0.25) {
            return pack(LANG.KO, Math.min(0.95, 0.55 + s.hangul / scriptTotal), s, raw.length, 'hangul');
        }
        if (s.han / scriptTotal >= 0.35 && s.hira < 3) {
            return pack(LANG.ZH, Math.min(0.95, 0.5 + s.han / scriptTotal), s, raw.length, 'han');
        }
    }

    // Latin: Vietnamese diacritics are strong signal
    if (s.latin >= MIN_SIGNAL_CHARS) {
        const diacRatio = s.viMarks / Math.max(1, s.latin);
        if (diacRatio >= 0.08 || s.viMarks >= 6) {
            const conf = Math.min(0.97, 0.55 + diacRatio * 2 + Math.min(0.2, s.viPlainHits * 0.03));
            return pack(LANG.VI, conf, s, raw.length, 'vi-diacritics');
        }

        const viPlainRatio = s.viPlainHits / Math.max(1, s.wordCount);
        const enRatio = s.enHits / Math.max(1, s.wordCount);

        // Undiacritized Vietnamese — conservative
        if (viPlainRatio >= 0.22 && s.viPlainHits >= 4 && viPlainRatio > enRatio + 0.05) {
            return pack(LANG.VI, Math.min(0.72, 0.4 + viPlainRatio), s, raw.length, 'vi-plain');
        }

        if (enRatio >= 0.12 || (s.enHits >= 3 && enRatio > viPlainRatio)) {
            return pack(LANG.EN, Math.min(0.9, 0.45 + enRatio), s, raw.length, 'en-stopwords');
        }

        // Both noticeable → mixed
        if (viPlainHitsSignificant(s) && enRatio >= 0.08) {
            return pack(LANG.MIXED, 0.5, s, raw.length, 'vi-en-mix-latin');
        }
    }

    // Mixed scripts
    const active = [s.han > 5, s.hira > 5, s.hangul > 5, s.latin > 20].filter(Boolean).length;
    if (active >= 2) {
        return pack(LANG.MIXED, 0.55, s, raw.length, 'multi-script');
    }

    if (s.letters < MIN_SIGNAL_CHARS) {
        return {
            language: LANG.UNKNOWN,
            confidence: 0,
            distribution: null,
            sampleChars: raw.length,
            reason: 'low-signal',
        };
    }

    return {
        language: LANG.UNKNOWN,
        confidence: 0.2,
        distribution: buildDistribution(s),
        sampleChars: raw.length,
        reason: 'uncertain',
    };
}

function viPlainHitsSignificant(s) {
    return s.viPlainHits >= 3 && s.viPlainHits / Math.max(1, s.wordCount) >= 0.12;
}

function pack(language, confidence, s, sampleChars, reason) {
    return {
        language,
        confidence: Math.round(confidence * 1000) / 1000,
        distribution: buildDistribution(s),
        sampleChars,
        reason,
    };
}

/** Character-mass distribution among scored scripts — only when meaningful. */
function buildDistribution(s) {
    const total = s.han + s.hira + s.hangul + s.latin;
    if (total < MIN_SIGNAL_CHARS) return null;
    const pct = (n) => Math.round((n / total) * 1000) / 10;
    const dist = {};
    if (s.latin) {
        // Approximate VI vs EN share within Latin by stopword / diacritic weight
        const viW = s.viMarks * 2 + s.viPlainHits * 3;
        const enW = s.enHits * 3;
        const wSum = viW + enW;
        if (wSum > 0 && s.latin / total > 0.2) {
            const latinPct = pct(s.latin);
            const viShare = viW / wSum;
            dist[LANG.VI] = Math.round(latinPct * viShare * 10) / 10;
            dist[LANG.EN] = Math.round(latinPct * (1 - viShare) * 10) / 10;
        } else {
            dist.latin = pct(s.latin);
        }
    }
    if (s.han) dist[LANG.ZH] = pct(s.han);
    if (s.hira) dist[LANG.JA] = pct(s.hira);
    if (s.hangul) dist[LANG.KO] = pct(s.hangul);
    return Object.keys(dist).length ? dist : null;
}

/**
 * Detect language from a batch of jobs (sampled).
 */
export function detectJobsLanguage(jobs, sampleOpts) {
    const sample = sampleJobTexts(jobs, sampleOpts);
    if (!sample.trim()) return emptyResult();
    return detectTextLanguage(sample);
}

export function resolveContentLanguage({
    override = 'auto',
    detected = null,
} = {}) {
    const o = String(override || 'auto').toLowerCase();
    if (o && o !== 'auto') {
        return {
            language: o,
            confidence: 1,
            distribution: detected?.distribution || null,
            sampleChars: detected?.sampleChars || 0,
            reason: 'user-override',
            source: 'user',
            detectedLanguage: detected?.language || LANG.UNKNOWN,
        };
    }
    if (!detected || detected.language === LANG.UNKNOWN) {
        return {
            language: LANG.UNKNOWN,
            confidence: detected?.confidence || 0,
            distribution: detected?.distribution || null,
            sampleChars: detected?.sampleChars || 0,
            reason: detected?.reason || 'unknown',
            source: 'auto',
            detectedLanguage: LANG.UNKNOWN,
        };
    }
    return {
        ...detected,
        source: 'auto',
        detectedLanguage: detected.language,
    };
}

function engineLangLevel(engine, langCode) {
    const code = String(langCode || '').toLowerCase();
    if (!code || code === LANG.UNKNOWN) return null;
    if (code === LANG.MIXED) return null;
    const info = engine?.languageSupport?.[code];
    if (info?.level) return info.level;
    if ((engine?.languages || []).includes(code) || (engine?.languages || []).includes('multi')) {
        return 'supported';
    }
    return 'unsupported';
}

/**
 * @returns {{ severity: 'none'|'info'|'warn'|'strong', message: string, engineLevel: string|null }}
 */
export function evaluateLanguageMismatch(contentLanguage, engine, {
    preferClone = false,
} = {}) {
    const lang = contentLanguage?.language || LANG.UNKNOWN;
    if (!engine || lang === LANG.UNKNOWN) {
        return { severity: 'none', message: '', engineLevel: null };
    }

    if (lang === LANG.MIXED) {
        const vi = engineLangLevel(engine, LANG.VI);
        const en = engineLangLevel(engine, LANG.EN);
        const multi = engine?.languageSupport?.multi?.level
            || ((engine?.languages || []).includes('multi') ? 'supported' : null);
        if (multi === 'native' || multi === 'supported'
            || (vi && vi !== 'unsupported' && en && en !== 'unsupported')) {
            return {
                severity: 'info',
                message: 'Nội dung của bạn có nhiều ngôn ngữ. Model hiện tại hỗ trợ một phần.',
                engineLevel: multi || vi || en,
            };
        }
        if (en && en !== 'unsupported' && (!vi || vi === 'unsupported')) {
            return {
                severity: 'warn',
                message: 'Nội dung của bạn có nhiều ngôn ngữ. Phần tiếng Việt trong batch có thể đọc không chính xác.',
                engineLevel: en,
            };
        }
        if (vi && vi !== 'unsupported' && (!en || en === 'unsupported')) {
            return {
                severity: 'warn',
                message: 'Nội dung của bạn có nhiều ngôn ngữ. Phần English có thể đọc không chính xác.',
                engineLevel: vi,
            };
        }
        return {
            severity: 'warn',
            message: 'Nội dung của bạn có nhiều ngôn ngữ. Model hiện tại có thể không phù hợp toàn bộ batch.',
            engineLevel: null,
        };
    }

    const level = engineLangLevel(engine, lang);
    if (!level || level === 'native') {
        return { severity: 'none', message: '', engineLevel: level };
    }
    if (level === 'supported') {
        return {
            severity: 'info',
            message: lang === LANG.VI ? 'Model hỗ trợ tiếng Việt.' : `Model hỗ trợ ${LANG_LABEL[lang] || lang}.`,
            engineLevel: level,
        };
    }
    if (level === 'experimental') {
        return {
            severity: preferClone
                ? 'warn'
                : 'warn',
            message: lang === LANG.VI
                ? 'Model này chỉ hỗ trợ tiếng Việt ở mức thử nghiệm. Kết quả có thể không ổn định.'
                : `Model chỉ hỗ trợ ${LANG_LABEL[lang] || lang} ở mức thử nghiệm.`,
            engineLevel: level,
        };
    }
    // unsupported
    return {
        severity: 'strong',
        message: lang === LANG.VI
            ? 'Model hiện không hỗ trợ tiếng Việt chính thức.'
            : `Model hiện không hỗ trợ ${LANG_LABEL[lang] || lang} chính thức.`,
        engineLevel: 'unsupported',
    };
}

const LEVEL_RANK = Object.freeze({
    native: 0,
    supported: 1,
    experimental: 2,
    unsupported: 9,
});

/**
 * Rank engines for a content language. Does not auto-install.
 * @param {object[]} engines — registry public entries
 */
export function suggestEnginesForLanguage(engines, contentLanguage, {
    adviceById = {},
    preferClone = false,
    limit = 3,
    excludeId = null,
} = {}) {
    const lang = contentLanguage?.language || LANG.UNKNOWN;
    if (lang === LANG.UNKNOWN) return [];

    const list = (engines || []).filter((e) => e && e.id !== excludeId);

    const scored = list.map((e) => {
        let level;
        if (lang === LANG.MIXED) {
            const multi = e.languageSupport?.multi?.level;
            const vi = engineLangLevel(e, LANG.VI);
            const en = engineLangLevel(e, LANG.EN);
            if (multi === 'native' || multi === 'supported') level = multi === 'native' ? 'native' : 'supported';
            else if (vi && vi !== 'unsupported' && en && en !== 'unsupported') level = 'supported';
            else if (vi && vi !== 'unsupported') level = vi;
            else if (en && en !== 'unsupported') level = en;
            else level = 'unsupported';
        } else {
            level = engineLangLevel(e, lang) || 'unsupported';
        }
        if (level === 'unsupported') return null;

        const advice = adviceById[e.id] || adviceById[e.family];
        const installed = e.bundled || e.installState === 'INSTALLED' ? 0 : 1;
        const compat = advice?.level === 'RECOMMENDED' ? 0
            : advice?.level === 'SUPPORTED' ? 1
                : advice?.level === 'MAY_BE_SLOW' ? 2
                    : advice?.level === 'NOT_RECOMMENDED' ? 3
                        : 4;
        const cpuOk = e.capabilities?.cpu !== false ? 0 : 1;
        const cloneMatch = preferClone
            ? (e.capabilities?.voiceClone ? 0 : 1)
            : 0;
        const recommended = e.recommended ? 0 : 1;
        const rank = LEVEL_RANK[level] ?? 9;

        return {
            engine: e,
            level,
            score: [rank, installed, cloneMatch, compat, cpuOk, recommended],
        };
    }).filter(Boolean);

    scored.sort((a, b) => {
        for (let i = 0; i < a.score.length; i++) {
            if (a.score[i] !== b.score[i]) return a.score[i] - b.score[i];
        }
        return String(a.engine.displayName || '').localeCompare(String(b.engine.displayName || ''), 'vi');
    });

    return scored.slice(0, limit);
}

export function filterIdForLanguage(language) {
    if (language === LANG.VI) return 'vi';
    if (language === LANG.EN) return 'en';
    if (language === LANG.MIXED) return 'multi';
    return null;
}

export function shouldGateOnMismatch(severity, {
    warningsEnabled = true,
} = {}) {
    if (!warningsEnabled) return false;
    if (!severity) return false;
    return severity === 'warn' || severity === 'strong';
}
