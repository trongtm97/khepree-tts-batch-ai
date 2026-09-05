/**
 * Prompt 27 — language detect + mismatch suggestion selfcheck.
 * Run: node src/batch/language-detect.selfcheck.mjs
 */
import assert from 'assert';
import {
    LANG,
    detectTextLanguage,
    detectJobsLanguage,
    sampleJobTexts,
    evaluateLanguageMismatch,
    suggestEnginesForLanguage,
    resolveContentLanguage,
    shouldGateOnMismatch,
    filterIdForLanguage,
} from './language-detect.js';

// Vietnamese with diacritics
{
    const r = detectTextLanguage('Xin chào các bạn, hôm nay chúng ta sẽ học tiếng Việt thật vui.');
    assert.strictEqual(r.language, LANG.VI);
    assert.ok(r.confidence >= 0.5);
}

// Vietnamese without diacritics (conservative)
{
    const r = detectTextLanguage('xin chao cac ban hom nay chung ta se hoc bai moi rat vui');
    assert.ok(r.language === LANG.VI || r.language === LANG.UNKNOWN || r.language === LANG.MIXED);
    if (r.language === LANG.VI) assert.ok(r.confidence < 0.85, 'plain VI must not fake high confidence');
}

// English
{
    const r = detectTextLanguage('Hello everyone, today we will learn about the English language and more.');
    assert.strictEqual(r.language, LANG.EN);
}

// Chinese
{
    const r = detectTextLanguage('今天我们学习中文，这是一个简单的句子。');
    assert.strictEqual(r.language, LANG.ZH);
}

// Japanese (kana)
{
    const r = detectTextLanguage('こんにちは、今日は日本語を勉強します。ありがとうございます。');
    assert.strictEqual(r.language, LANG.JA);
}

// Korean
{
    const r = detectTextLanguage('안녕하세요 오늘은 한국어를 공부합니다 감사합니다');
    assert.strictEqual(r.language, LANG.KO);
}

// Mixed vi/en
{
    const r = detectTextLanguage(
        'Xin chào các bạn. This chapter explains the product workflow for English readers và phần tiếng Việt.'
    );
    assert.ok([LANG.MIXED, LANG.VI, LANG.EN].includes(r.language));
}

// Numbers only / short
{
    assert.strictEqual(detectTextLanguage('12345 67890').language, LANG.UNKNOWN);
    assert.strictEqual(detectTextLanguage('OK').language, LANG.UNKNOWN);
    assert.strictEqual(detectTextLanguage('AI').language, LANG.UNKNOWN);
    assert.strictEqual(detectTextLanguage('Hello').language, LANG.UNKNOWN);
    assert.strictEqual(detectTextLanguage('').language, LANG.UNKNOWN);
}

// Sampling 10k rows — must not concatenate all
{
    const jobs = [];
    for (let i = 0; i < 10000; i++) {
        jobs.push({ text: `Dòng ${i}: Xin chào đây là nội dung tiếng Việt số ${i} với dấu đầy đủ.` });
    }
    const sample = sampleJobTexts(jobs, { maxChars: 8000 });
    assert.ok(sample.length <= 8000);
    assert.ok(sample.length < 50000);
    const t0 = Date.now();
    const r = detectJobsLanguage(jobs);
    const ms = Date.now() - t0;
    assert.strictEqual(r.language, LANG.VI);
    assert.ok(ms < 2000, `10k sample detect too slow: ${ms}ms`);
}

// Compatibility matrix
const vieneu = {
    id: 'vieneu',
    displayName: 'VieNeu Turbo',
    recommended: true,
    bundled: true,
    languageSupport: { vi: { level: 'native', recommended: true } },
    capabilities: { cpu: true, gpu: true, voiceClone: false },
};
const supertonic = {
    id: 'supertonic',
    displayName: 'Supertonic 3',
    installState: 'INSTALLED',
    languageSupport: {
        vi: { level: 'supported' },
        multi: { level: 'supported' },
        en: { level: 'supported' },
    },
    capabilities: { cpu: true },
    languages: ['vi', 'en', 'multi'],
};
const experimental = {
    id: 'exp',
    displayName: 'Exp VI',
    languageSupport: { vi: { level: 'experimental' } },
    capabilities: { cpu: true },
};
const kokoro = {
    id: 'kokoro',
    displayName: 'Kokoro',
    installState: 'INSTALLED',
    languageSupport: {
        vi: { level: 'unsupported' },
        en: { level: 'native' },
    },
    capabilities: { cpu: true, voiceClone: false },
    badges: ['Nhẹ'],
};

assert.strictEqual(
    evaluateLanguageMismatch({ language: LANG.VI }, vieneu).severity,
    'none'
);
assert.strictEqual(
    evaluateLanguageMismatch({ language: LANG.VI }, supertonic).severity,
    'info'
);
assert.strictEqual(
    evaluateLanguageMismatch({ language: LANG.VI }, experimental).severity,
    'warn'
);
assert.strictEqual(
    evaluateLanguageMismatch({ language: LANG.VI }, kokoro).severity,
    'strong'
);
assert.ok(shouldGateOnMismatch('strong'));
assert.ok(shouldGateOnMismatch('warn'));
assert.ok(!shouldGateOnMismatch('info'));
assert.ok(!shouldGateOnMismatch('strong', { warningsEnabled: false }));

assert.strictEqual(
    evaluateLanguageMismatch({ language: LANG.EN }, kokoro).severity,
    'none'
);

const mixedFit = evaluateLanguageMismatch({ language: LANG.MIXED }, kokoro);
assert.strictEqual(mixedFit.severity, 'warn');
assert.ok(/nhiều ngôn ngữ|tiếng Việt/i.test(mixedFit.message));

// Suggestions dynamic — no hard-coded ids required beyond catalog input
{
    const sug = suggestEnginesForLanguage(
        [kokoro, supertonic, vieneu, experimental],
        { language: LANG.VI },
        { adviceById: { vieneu: { level: 'RECOMMENDED' } }, limit: 3 }
    );
    assert.ok(sug.length >= 1);
    assert.strictEqual(sug[0].engine.id, 'vieneu');
    assert.ok(sug.every((s) => s.level !== 'unsupported'));
}

{
    const sug = suggestEnginesForLanguage(
        [kokoro, vieneu],
        { language: LANG.EN },
        {}
    );
    assert.ok(sug.some((s) => s.engine.id === 'kokoro'));
}

// User override
{
    const det = detectTextLanguage('Hello there, this is clearly English text for testing.');
    const resolved = resolveContentLanguage({ override: 'vi', detected: det });
    assert.strictEqual(resolved.language, LANG.VI);
    assert.strictEqual(resolved.source, 'user');
}

assert.strictEqual(filterIdForLanguage(LANG.VI), 'vi');
assert.strictEqual(filterIdForLanguage(LANG.EN), 'en');
assert.strictEqual(filterIdForLanguage(LANG.MIXED), 'multi');
assert.strictEqual(filterIdForLanguage(LANG.UNKNOWN), null);

// UI wiring contract (no auto-switch / gate hooks)
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const dir = path.dirname(fileURLToPath(import.meta.url));
const tab = fs.readFileSync(path.join(dir, 'tts-tab.js'), 'utf8');
assert.ok(tab.includes('ensureLanguageGate'));
assert.ok(tab.includes('gateLanguageBeforeAction'));
assert.ok(tab.includes('refreshContentLanguage'));
assert.ok(tab.includes('sel-content-lang'));
assert.ok(!/auto.?switch engine|silently switch/i.test(tab));

const settings = fs.readFileSync(path.join(dir, 'settings.js'), 'utf8');
assert.ok(settings.includes('languageDetectionEnabled'));
assert.ok(settings.includes('languageMismatchWarnings'));

console.log('language-detect.selfcheck: ok');
