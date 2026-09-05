/**
 * Engine selector model + UI contract (Prompt 26).
 * Run: node src/batch/engine-selector.selfcheck.mjs
 */
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
    DEFAULT_FILTER,
    FILTERS,
    LEVEL,
    VI_LABEL,
    buildCardBadges,
    compatCardMessage,
    contextRecommendLabel,
    filterBySearch,
    groupEngines,
    installStatus,
    matchesFilter,
    matchesSearch,
    needsInstall,
    viLevel,
} from './engine-selector-model.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const mock = [
    {
        id: 'vieneu',
        displayName: 'VieNeu Turbo',
        recommended: true,
        bundled: true,
        local: true,
        online: false,
        positioning: 'Khuyên dùng nếu nội dung chính là tiếng Việt.',
        languageSupport: { vi: { level: 'native', recommended: true, label: VI_LABEL.native } },
        capabilities: { cpu: true, gpu: true, voiceClone: false },
        strengths: ['Tiếng Việt'],
        weaknesses: ['Nặng'],
        bestFor: ['Batch VI'],
        badges: ['Offline'],
    },
    {
        id: 'supertonic',
        displayName: 'Supertonic 3',
        bundled: false,
        installState: 'NOT_INSTALLED',
        optional: true,
        local: true,
        online: false,
        languageSupport: {
            vi: { level: 'supported', recommended: true },
            multi: { level: 'supported' },
        },
        languages: ['vi', 'en', 'multi'],
        capabilities: { cpu: true, gpu: false },
        badges: ['Đa ngôn ngữ', 'Nhẹ'],
        positioning: 'Phù hợp khi cần tiếng Việt cùng nhiều ngôn ngữ khác.',
    },
    {
        id: 'exp-vi',
        displayName: 'Experimental VI',
        languageSupport: { vi: { level: 'experimental' } },
        capabilities: { cpu: true },
        badges: [],
        strengths: ['thử nghiệm'],
    },
    {
        id: 'kokoro',
        displayName: 'Kokoro',
        optional: true,
        installState: 'INSTALLED',
        local: true,
        online: false,
        languageSupport: {
            vi: { level: 'unsupported' },
            en: { level: 'native', recommended: true },
        },
        capabilities: { cpu: true, gpu: false },
        badges: ['Nhẹ', 'English'],
        positioning: 'English nhanh và nhẹ.',
        strengths: ['English'],
    },
    {
        id: 'lab',
        displayName: 'Voice Lab X',
        category: 'voice-lab',
        languageSupport: { vi: { level: 'unsupported' }, en: { level: 'supported' } },
        capabilities: { cpu: true, gpu: true, voiceClone: true },
        badges: ['Voice Lab', 'Nâng cao'],
    },
];

assert.strictEqual(DEFAULT_FILTER, 'vi');
assert.ok(FILTERS.some((f) => f.id === 'vi'));
assert.ok(FILTERS.some((f) => f.id === 'all'));
assert.ok(FILTERS.some((f) => f.id === 'en'));
assert.ok(FILTERS.some((f) => f.id === 'clone'));
assert.ok(FILTERS.some((f) => f.id === 'no-gpu'));
assert.ok(FILTERS.some((f) => f.id === 'advanced'));
assert.ok(FILTERS.some((f) => f.id === 'installed'));

assert.strictEqual(viLevel(mock[0]), LEVEL.NATIVE);
assert.strictEqual(viLevel(mock[1]), LEVEL.SUPPORTED);
assert.strictEqual(viLevel(mock[2]), LEVEL.EXPERIMENTAL);
assert.strictEqual(viLevel(mock[3]), LEVEL.UNSUPPORTED);

// Tab Tiếng Việt — no unsupported by default
const viGroups = groupEngines(mock, 'vi');
const viIds = viGroups.flatMap((g) => g.engines.map((e) => e.id));
assert.ok(viIds.includes('vieneu'));
assert.ok(viIds.includes('supertonic'));
assert.ok(viIds.includes('exp-vi'));
assert.ok(!viIds.includes('kokoro'));
assert.ok(viGroups.some((g) => g.id === 'vi-native'));
assert.ok(viGroups.some((g) => g.id === 'vi-supported'));
assert.ok(viGroups.some((g) => g.id === 'vi-experimental'));

const unsupportedVi = groupEngines(mock, 'vi', { showUnsupportedVi: true });
assert.ok(unsupportedVi[0].engines.every((e) => viLevel(e) === LEVEL.UNSUPPORTED));

// Tab Tất cả — sectioned
const allGroups = groupEngines(mock, 'all');
assert.ok(allGroups.some((g) => /Tốt cho tiếng Việt/i.test(g.title)));
assert.ok(allGroups.some((g) => /English/i.test(g.title)));
assert.ok(allGroups.some((g) => /Nâng cao|Voice Lab/i.test(g.title)));

// Filters
assert.ok(matchesFilter(mock[3], 'en'));
assert.ok(matchesFilter(mock[4], 'clone'));
assert.ok(matchesFilter(mock[4], 'advanced'));
assert.ok(!matchesFilter(mock[1], 'installed'));
assert.ok(matchesFilter(mock[0], 'installed'));

// Search
assert.ok(matchesSearch(mock[0], 'tiếng việt'));
assert.ok(matchesSearch(mock[4], 'clone'));
assert.ok(matchesSearch(mock[3], 'máy yếu'));
assert.strictEqual(filterBySearch(mock, 'tiếng việt').some((e) => e.id === 'kokoro'), false);

// Install
assert.strictEqual(installStatus(mock[0]).label, 'Bundled');
assert.strictEqual(installStatus(mock[1]).label, 'Chưa cài');
assert.ok(needsInstall(mock[1]));
assert.ok(!needsInstall(mock[0]));
assert.strictEqual(installStatus({ installState: 'INSTALLING', optional: true }).label, 'Đang tải');
assert.strictEqual(installStatus({ installState: 'BROKEN', optional: true }).label, 'Lỗi model');

// Badges prioritize language, capped
const badges = buildCardBadges(mock[0], { filterId: 'vi' });
assert.ok(badges[0].text.includes('Tốt cho tiếng Việt') || badges[0].tone === 'vi-native');
assert.ok(badges.length <= 5);

const kokoroBadges = buildCardBadges(mock[3], { filterId: 'en' });
assert.ok(kokoroBadges.some((b) => /English/i.test(b.text)));

assert.strictEqual(
    contextRecommendLabel(mock[0], 'vi'),
    'Khuyên dùng cho tiếng Việt'
);
assert.strictEqual(contextRecommendLabel(mock[1], 'vi'), null);

assert.ok(compatCardMessage({ level: 'RECOMMENDED' }).includes('phù hợp'));
assert.ok(compatCardMessage({ level: 'MAY_BE_SLOW' }).includes('chậm'));

// UI source contract
const src = fs.readFileSync(path.join(__dirname, 'engine-selector.js'), 'utf8');
for (const needle of [
    'MẠNH VỀ',
    'HẠN CHẾ',
    'Chi tiết',
    'ENGINE ĐANG DÙNG',
    'adviseAllEngines',
    'DEFAULT_FILTER',
    'buildCardBadges',
    'groupEngines',
    'never auto-download',
    'No fake star',
    'btn-show-unsupported-vi',
    'Xem các model không hỗ trợ tiếng Việt',
    'onContentLanguage',
    'userPickedFilter',
]) {
    assert.ok(src.includes(needle), `missing in engine-selector.js: ${needle}`);
}

const html = fs.readFileSync(path.join(__dirname, '../../batch.html'), 'utf8');
assert.ok(html.includes('engine-filters'));
assert.ok(html.includes('engine-selector-search'));
assert.ok(html.includes('ENGINE ĐANG DÙNG'));
assert.ok(html.includes('btn-change-engine'));

const tab = fs.readFileSync(path.join(__dirname, 'tts-tab.js'), 'utf8');
assert.ok(tab.includes('isAnyBatchRunning'));
assert.ok(tab.includes('không thể đổi engine'));

// Very long description must not break grouping
const long = {
    ...mock[0],
    id: 'long',
    description: 'x'.repeat(4000),
    positioning: 'y'.repeat(200),
};
assert.strictEqual(groupEngines([long], 'vi')[0].engines[0].id, 'long');

console.log('engine-selector.selfcheck: ok');
