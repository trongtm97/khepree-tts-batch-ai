/**
 * AUTO recommender — guidance + installed + hardware + local bench + preference.
 * Never auto-downloads models. Never invents quality scores.
 */
const { adviseEngine, COMPAT } = require('./model-compatibility.cjs');

/** Default product guidance (not measured quality). */
const DEFAULT_GUIDANCE = Object.freeze({
    'vi-general': Object.freeze([
        { engineId: 'vieneu', reason: 'Vietnamese general → VieNeu.' },
    ]),
    'vi-clone': Object.freeze([
        { engineId: 'vieneu', reason: 'Vietnamese clone → VieNeu.' },
    ]),
    'vi-multilingual-cpu': Object.freeze([
        { engineId: 'vieneu', reason: 'Vietnamese multilingual CPU → VieNeu (default).' },
        { engineId: 'supertonic', reason: 'Vietnamese multilingual CPU → Supertonic (alt use case).' },
    ]),
    'en-light': Object.freeze([
        { engineId: 'kokoro', reason: 'English lightweight → Kokoro.' },
        { engineId: 'kitten', reason: 'English lightweight → Kitten.' },
    ]),
    'en-expressive': Object.freeze([
        { engineId: 'chatterbox', variant: 'nano', reason: 'English expressive → Chatterbox.' },
    ]),
    'en-clone': Object.freeze([
        { engineId: 'chatterbox', variant: 'turbo', reason: 'English clone → Chatterbox Turbo.' },
    ]),
    advanced: Object.freeze([
        { engineId: 'qwen3', reason: 'Advanced → Qwen3.' },
        { engineId: 'spark', reason: 'Advanced → Spark.' },
    ]),
});

const TASKS = Object.freeze([
    { id: 'vi-general', label: 'Vietnamese · tổng quát', language: 'vi' },
    { id: 'vi-clone', label: 'Vietnamese · clone', language: 'vi' },
    { id: 'vi-multilingual-cpu', label: 'Vietnamese · multilingual CPU', language: 'vi' },
    { id: 'en-light', label: 'English · nhẹ', language: 'en' },
    { id: 'en-expressive', label: 'English · biểu cảm', language: 'en' },
    { id: 'en-clone', label: 'English · clone', language: 'en' },
    { id: 'advanced', label: 'Advanced (Qwen/Spark)', language: 'multi' },
]);

function isInstalled(engine) {
    if (!engine) return false;
    if (engine.bundled) return true;
    return engine.installState === 'INSTALLED';
}

function benchSummary(record) {
    if (!record?.ok) return null;
    const initSec = Number(record.initMs) / 1000;
    const factor = Number(record.medianRealtimeFactor);
    return {
        initSec: Number.isFinite(initSec) ? initSec : null,
        realtimeFactor: Number.isFinite(factor) ? factor : null,
        medianRtf: Number.isFinite(Number(record.medianRtf)) ? Number(record.medianRtf) : null,
        successCount: record.successCount || 0,
        errorCount: record.errorCount || 0,
    };
}

function formatLocalMetrics(summary) {
    if (!summary) return null;
    const lines = ['Đo trên máy của bạn'];
    if (summary.initSec != null) {
        lines.push(`Khởi động: ${summary.initSec.toFixed(1)} giây`);
    }
    if (summary.realtimeFactor != null) {
        lines.push(`Tốc độ: ${summary.realtimeFactor.toFixed(1)}× realtime`);
    }
    return lines.length > 1 ? lines.join('\n') : null;
}

/**
 * @param {object} opts
 * @param {string} opts.task
 * @param {string} [opts.language]
 * @param {object[]} opts.engines — public catalog
 * @param {object} opts.hardware
 * @param {object[]} opts.benchResults — latestByEngine for fingerprint
 * @param {string} [opts.userPreference] — preferred engine id
 */
function recommend(opts = {}) {
    const task = opts.task || 'vi-general';
    const guidance = DEFAULT_GUIDANCE[task] || DEFAULT_GUIDANCE['vi-general'];
    const engines = Array.isArray(opts.engines) ? opts.engines : [];
    const byId = new Map(engines.map((e) => [e.id, e]));
    const benchByKey = new Map();
    for (const r of opts.benchResults || []) {
        benchByKey.set(`${r.engineId}::${r.variant || 'default'}`, r);
    }

    const ranked = [];
    for (const g of guidance) {
        const engine = byId.get(g.engineId);
        const variant = g.variant
            || engine?.modelVariant
            || (Array.isArray(engine?.modelVariants) && engine.modelVariants[0])
            || 'default';
        const advice = adviseEngine(engine, opts.hardware, { variant });
        const installed = isInstalled(engine);
        const bench = benchByKey.get(`${g.engineId}::${variant}`)
            || benchByKey.get(`${g.engineId}::default`)
            || null;
        const summary = benchSummary(bench);
        ranked.push({
            engineId: g.engineId,
            variant,
            reason: g.reason,
            installed,
            needsInstall: !installed,
            // AUTO never downloads — UI may only suggest install
            autoDownload: false,
            compatLevel: advice.level,
            compatMessage: advice.message,
            available: advice.level !== COMPAT.UNAVAILABLE,
            localMetrics: summary,
            localMetricsText: formatLocalMetrics(summary),
            medianRtf: summary?.medianRtf ?? null,
            preferenceBoost: opts.userPreference && opts.userPreference === g.engineId ? 1 : 0,
        });
    }

    // Sort: available+installed first, then lower RTF (if measured), then preference, then guidance order
    ranked.sort((a, b) => {
        const aOk = a.available && a.installed ? 0 : a.available ? 1 : 2;
        const bOk = b.available && b.installed ? 0 : b.available ? 1 : 2;
        if (aOk !== bOk) return aOk - bOk;
        const aR = a.medianRtf == null ? Number.POSITIVE_INFINITY : a.medianRtf;
        const bR = b.medianRtf == null ? Number.POSITIVE_INFINITY : b.medianRtf;
        if (aR !== bR) return aR - bR;
        return (b.preferenceBoost || 0) - (a.preferenceBoost || 0);
    });

    const bestInstalled = ranked.find((r) => r.installed && r.available) || null;
    const bestOverall = ranked[0] || null;
    const suggestInstall = bestOverall && !bestOverall.installed
        ? {
            engineId: bestOverall.engineId,
            variant: bestOverall.variant,
            reason: `Model phù hợp nhất chưa cài — đề xuất cài ${bestOverall.engineId}`
                + (bestOverall.variant && bestOverall.variant !== 'default'
                    ? ` (${bestOverall.variant})`
                    : '')
                + '. AUTO không tự download.',
        }
        : null;

    return {
        ok: true,
        task,
        language: opts.language || TASKS.find((t) => t.id === task)?.language || null,
        guidance: [...guidance],
        candidates: ranked,
        pick: bestInstalled
            ? {
                engineId: bestInstalled.engineId,
                variant: bestInstalled.variant,
                reason: bestInstalled.reason,
                localMetricsText: bestInstalled.localMetricsText,
                fromBenchmark: Boolean(bestInstalled.localMetrics),
            }
            : null,
        suggestInstall,
        autoDownload: false,
    };
}

module.exports = {
    DEFAULT_GUIDANCE,
    TASKS,
    recommend,
    benchSummary,
    formatLocalMetrics,
    isInstalled,
};
