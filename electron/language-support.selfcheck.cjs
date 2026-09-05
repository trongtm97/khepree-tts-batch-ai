/**
 * Self-check: language support metadata (Prompt 25).
 * Run: node electron/language-support.selfcheck.cjs
 */
const assert = require('assert');
const registry = require('./engine-registry.cjs');
const ls = require('./language-support.cjs');

const { LEVEL, VI_LABELS, VISUAL_INTENT } = ls;

// --- level enum ---
assert.deepStrictEqual(
    Object.values(LEVEL).sort(),
    ['experimental', 'native', 'supported', 'unsupported']
);

// --- VieNeu → vi native ---
const viTurbo = registry.getVietnameseSupport('vieneu');
assert.strictEqual(viTurbo.level, LEVEL.NATIVE);
assert.strictEqual(viTurbo.recommended, true);
assert.strictEqual(viTurbo.label, VI_LABELS[LEVEL.NATIVE]);
assert.strictEqual(viTurbo.label, 'Tốt cho tiếng Việt');
assert.ok(registry.supportsLanguage('vieneu', 'vi'));

const viNano = registry.getVietnameseSupport('v3nano');
assert.strictEqual(viNano.level, LEVEL.NATIVE);
assert.strictEqual(registry.getVietnameseSupport('vieneu-nano')?.level, LEVEL.NATIVE);

// --- Supertonic / Edge → vi supported ---
assert.strictEqual(registry.getVietnameseSupport('supertonic').level, LEVEL.SUPPORTED);
assert.strictEqual(registry.getVietnameseSupport('edge').level, LEVEL.SUPPORTED);
assert.ok(registry.supportsLanguage('supertonic', 'vi'));

// --- unsupported models ---
for (const id of ['kitten', 'kokoro', 'chatterbox', 'qwen3', 'spark', 'gpt-sovits']) {
    const vi = registry.getVietnameseSupport(id);
    assert.strictEqual(vi.level, LEVEL.UNSUPPORTED, `${id} vi must be unsupported`);
    assert.strictEqual(registry.supportsLanguage(id, 'vi'), false);
    assert.strictEqual(vi.label, 'Không hỗ trợ tiếng Việt chính thức');
}

// --- Piper: supported but voice-dependent ---
const piperVi = registry.getVietnameseSupport('piper');
assert.strictEqual(piperVi.level, LEVEL.SUPPORTED);
assert.strictEqual(piperVi.dependsOnVoice, true);
assert.ok(/voice|voice tiếng Việt/i.test(piperVi.note));
assert.strictEqual(registry.getEngine('piper').languageSupportDependsOnVoice, true);

// --- GPT-SoVITS checkpoint flag ---
assert.strictEqual(registry.getEngine('gpt-sovits').languageSupportDependsOnCheckpoint, true);
assert.strictEqual(registry.getVietnameseSupport('gpt-sovits').dependsOnCheckpoint, true);

// --- experimental (synthetic; no fake registry engine) ---
const experimentalEntry = {
    languageSupport: {
        vi: ls.freezeOne('vi', {
            level: LEVEL.EXPERIMENTAL,
            recommended: false,
            source: 'community',
            note: 'Community checkpoint only.',
        }),
    },
};
const exp = ls.resolveLanguageSupport(experimentalEntry, 'vi');
assert.strictEqual(exp.level, LEVEL.EXPERIMENTAL);
assert.strictEqual(exp.label, 'Tiếng Việt thử nghiệm');
assert.strictEqual(ls.supportsLanguage(experimentalEntry, 'vi'), false);
assert.strictEqual(ls.supportsLanguage(experimentalEntry, 'vi', { includeExperimental: true }), true);
assert.strictEqual(ls.visualIntent(LEVEL.EXPERIMENTAL), VISUAL_INTENT[LEVEL.EXPERIMENTAL]);
assert.strictEqual(ls.visualIntent(LEVEL.EXPERIMENTAL), 'warning');

// --- sort order ---
const sorted = registry.getEnginesByLanguage('vi', { includeUnsupported: true });
const levels = sorted.map((e) => registry.getVietnameseSupport(e.id).level);
const order = levels.map((l) => ls.LEVEL_ORDER[l]);
for (let i = 1; i < order.length; i++) {
    assert.ok(order[i] >= order[i - 1], `sort must be non-decreasing: ${levels.join(',')}`);
}
const natives = sorted.filter((e) => registry.getVietnameseSupport(e.id).level === LEVEL.NATIVE);
assert.deepStrictEqual(natives.map((e) => e.id), ['v3nano', 'vieneu']); // displayName: Nano < Turbo
assert.ok(natives.length >= 1);
assert.strictEqual(sorted[0].id, 'v3nano');

const supportedOnly = registry.getEnginesByLanguage('vi');
assert.ok(supportedOnly.every((e) => {
    const lv = registry.getVietnameseSupport(e.id).level;
    return lv === LEVEL.NATIVE || lv === LEVEL.SUPPORTED;
}));
assert.ok(!supportedOnly.some((e) => e.id === 'kokoro'));

// --- unknown engine / language ---
assert.strictEqual(registry.getLanguageSupport('nope', 'vi'), null);
assert.strictEqual(registry.getVietnameseSupport('nope'), null);
assert.strictEqual(registry.supportsLanguage('nope', 'vi'), false);

const unknownLang = registry.getLanguageSupport('vieneu', 'xx-unknown');
assert.strictEqual(unknownLang.level, LEVEL.UNSUPPORTED);
assert.strictEqual(unknownLang.source, 'inferred');

// --- variant override (Chatterbox nano/turbo both unsupported VI; EN native) ---
const cbFamily = registry.getLanguageSupport('chatterbox', 'en');
assert.strictEqual(cbFamily.level, LEVEL.NATIVE);
const cbNanoVi = registry.getLanguageSupport('chatterbox', 'vi', 'nano');
const cbTurboVi = registry.getLanguageSupport('chatterbox', 'vi', 'turbo');
assert.strictEqual(cbNanoVi.level, LEVEL.UNSUPPORTED);
assert.strictEqual(cbTurboVi.level, LEVEL.UNSUPPORTED);
assert.ok(/Nano/.test(cbNanoVi.note) || /nano/i.test(cbNanoVi.note));
assert.ok(/Turbo/.test(cbTurboVi.note) || /turbo/i.test(cbTurboVi.note));

// Variant can differ: synthetic override stronger than family
const variantOverrideEntry = {
    languageSupport: {
        vi: ls.freezeOne('vi', { level: LEVEL.UNSUPPORTED, source: 'official' }),
    },
    variantLanguageSupport: {
        'vi-community': {
            vi: ls.freezeOne('vi', {
                level: LEVEL.EXPERIMENTAL,
                source: 'community',
                note: 'Variant-only VI.',
            }),
        },
    },
};
assert.strictEqual(ls.resolveLanguageSupport(variantOverrideEntry, 'vi').level, LEVEL.UNSUPPORTED);
assert.strictEqual(
    ls.resolveLanguageSupport(variantOverrideEntry, 'vi', 'vi-community').level,
    LEVEL.EXPERIMENTAL
);

// --- primaryLanguages ≠ full languages (qwen3) ---
const qwen = registry.getEngine('qwen3');
assert.ok(qwen.languages.length > qwen.primaryLanguages.length);
assert.deepStrictEqual([...qwen.primaryLanguages], ['zh', 'en']);
assert.ok(!qwen.primaryLanguages.includes('vi'));

// --- labels + visual intent ---
assert.strictEqual(registry.vietnameseLabel(LEVEL.NATIVE), 'Tốt cho tiếng Việt');
assert.strictEqual(registry.vietnameseLabel(LEVEL.SUPPORTED), 'Có tiếng Việt');
assert.strictEqual(registry.vietnameseLabel(LEVEL.EXPERIMENTAL), 'Tiếng Việt thử nghiệm');
assert.strictEqual(registry.vietnameseLabel(LEVEL.UNSUPPORTED), 'Không hỗ trợ tiếng Việt chính thức');
assert.strictEqual(registry.visualIntent(LEVEL.NATIVE), 'positive-prominent');
assert.strictEqual(registry.visualIntent(LEVEL.SUPPORTED), 'positive');
assert.strictEqual(registry.visualIntent(LEVEL.UNSUPPORTED), 'muted-negative');

// --- BC: old consumers (languages[], listPublic, EngineClass) ---
const pub = registry.listPublic();
assert.ok(pub.every((e) => Array.isArray(e.languages)));
assert.ok(pub.every((e) => e.languageSupport && typeof e.languageSupport === 'object'));
assert.ok(pub.every((e) => Array.isArray(e.primaryLanguages)));
assert.ok(registry.getEngine('vieneu').EngineClass);
assert.ok(registry.getEngine('edge').languages.includes('vi'));
assert.ok(registry.hasEngine('vieneu-turbo'));

console.log('language-support.selfcheck: PASS');
