/**
 * Self-check: Engine Registry (canonical ids vieneu | v3nano | edge).
 * Run: node electron/engine-registry.selfcheck.cjs
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const registry = require('./engine-registry.cjs');
const { EnginePoolManager } = require('./engine-pool-manager.cjs');
const { createJobsStore } = require('./jobs-store.cjs');
const { EnginePool } = require('./engine-pool.cjs');

// --- list / get / has ---
const listed = registry.listEngines();
assert.strictEqual(listed.length, 11, 'list must have 11 engines');
const ids = listed.map((e) => e.id).sort();
assert.deepStrictEqual(ids, ['chatterbox', 'edge', 'gpt-sovits', 'kitten', 'kokoro', 'piper', 'qwen3', 'spark', 'supertonic', 'v3nano', 'vieneu']);

assert.ok(registry.hasEngine('vieneu'));
assert.ok(registry.hasEngine('v3nano'));
assert.ok(registry.hasEngine('edge'));
assert.ok(registry.hasEngine('supertonic'));
assert.ok(registry.hasEngine('kitten'));
assert.ok(registry.hasEngine('kokoro'));
assert.ok(registry.hasEngine('piper'));
assert.ok(registry.hasEngine('chatterbox'));
assert.ok(registry.hasEngine('qwen3'));
assert.ok(registry.hasEngine('spark'));
assert.ok(registry.hasEngine('gpt-sovits'));
assert.ok(registry.hasEngine('chatterbox-nano'));
assert.ok(registry.hasEngine('chatterbox-turbo'));
assert.strictEqual(registry.resolveId('chatterbox'), 'chatterbox');
assert.strictEqual(registry.resolveId('chatterbox-nano'), 'chatterbox');
assert.strictEqual(registry.resolveId('chatterbox-turbo'), 'chatterbox');
assert.strictEqual(registry.resolveId('qwen3-tts'), 'qwen3');
assert.strictEqual(registry.resolveId('spark-tts'), 'spark');
assert.strictEqual(registry.resolveId('gptsovits'), 'gpt-sovits');
assert.strictEqual(registry.hasEngine('nope'), false);
assert.strictEqual(registry.getEngine('nope'), null);
assert.strictEqual(registry.getEngine(''), null);
assert.strictEqual(registry.getEngine(undefined), null);

// aliases still resolve
assert.strictEqual(registry.resolveId('vieneu-turbo'), 'vieneu');
assert.strictEqual(registry.resolveId('vieneu-nano'), 'v3nano');
assert.strictEqual(registry.getEngine('vieneu-turbo')?.id, 'vieneu');

const turbo = registry.getEngine('vieneu');
const nano = registry.getEngine('v3nano');
const edge = registry.getEngine('edge');
const st = registry.getEngine('supertonic');
const kitten = registry.getEngine('kitten');
const kokoro = registry.getEngine('kokoro');
const piper = registry.getEngine('piper');
const cbn = registry.getEngine('chatterbox');
const qwen3 = registry.getEngine('qwen3');
const spark = registry.getEngine('spark');
const gsv = registry.getEngine('gpt-sovits');

assert.strictEqual(turbo.EngineClass.name, 'VieNeuEngine');
assert.strictEqual(nano.EngineClass.name, 'VieNeuEngine');
assert.strictEqual(edge.EngineClass.name, 'EdgeTTSEngine');
assert.strictEqual(st.EngineClass.name, 'SupertonicEngine');
assert.strictEqual(kitten.EngineClass.name, 'KittenEngine');
assert.strictEqual(kokoro.EngineClass.name, 'KokoroEngine');
assert.strictEqual(piper.EngineClass.name, 'PiperEngine');
assert.strictEqual(cbn.EngineClass.name, 'ChatterboxEngine');
assert.strictEqual(qwen3.EngineClass.name, 'Qwen3Engine');
assert.strictEqual(spark.EngineClass.name, 'SparkEngine');
assert.strictEqual(gsv.EngineClass.name, 'GptSovitsEngine');
assert.strictEqual(turbo.mode, 'v3turbo');
assert.strictEqual(nano.mode, 'v3nano');
assert.strictEqual(turbo.outputFormat, 'wav');
assert.strictEqual(nano.outputFormat, 'wav');
assert.strictEqual(edge.outputFormat, 'mp3');
assert.strictEqual(st.outputFormat, 'wav');
assert.strictEqual(kitten.outputFormat, 'wav');
assert.strictEqual(kokoro.outputFormat, 'wav');
assert.strictEqual(piper.outputFormat, 'wav');
assert.strictEqual(cbn.outputFormat, 'wav');
assert.strictEqual(turbo.bundled, true);
assert.strictEqual(nano.bundled, true);
assert.strictEqual(edge.online, true);
assert.strictEqual(edge.local, false);
assert.strictEqual(st.optional, true);
assert.strictEqual(st.bundled, false);
assert.strictEqual(st.capabilities.voiceClone, false);
assert.strictEqual(st.capabilities.cpu, true);
assert.ok(st.license.codeLicense.includes('MIT'));
assert.ok(st.license.modelLicense.includes('OpenRAIL'));
assert.ok(!/zero-shot/i.test(st.strengths.join(' ')));
assert.strictEqual(kitten.optional, true);
assert.strictEqual(kitten.capabilities.voiceClone, false);
assert.strictEqual(kitten.capabilities.modelVariantSelect, true);
assert.deepStrictEqual([...kitten.modelVariants], ['mini', 'micro', 'nano', 'nano-int8']);
assert.ok(kitten.languages.includes('en'));
assert.ok(!kitten.languages.includes('vi'));
assert.ok(!(kitten.badges || []).some((b) => /việt|vietnamese/i.test(b)));
assert.ok(kitten.license.codeLicense.includes('Apache'));
assert.strictEqual(kokoro.optional, true);
assert.strictEqual(kokoro.capabilities.voiceClone, false);
assert.strictEqual(kokoro.capabilities.modelVariantSelect, true);
assert.deepStrictEqual([...kokoro.modelVariants], ['int8', 'fp32']);
assert.strictEqual(kokoro.modelVariant, 'int8');
assert.ok(kokoro.languages.includes('en'));
assert.ok(!kokoro.languages.includes('vi'));
assert.ok(!(kokoro.badges || []).some((b) => /việt|vietnamese/i.test(b)));
assert.ok(kokoro.license.codeLicense.includes('MIT'));
assert.ok(kokoro.license.modelLicense.includes('Apache'));
assert.ok(/English/i.test(kokoro.subtitle));
assert.ok(!/tiếng việt|vietnamese/i.test(kokoro.subtitle));
assert.strictEqual(piper.optional, true);
assert.strictEqual(piper.bundled, false);
assert.strictEqual(piper.license.attentionRequired, true);
assert.ok(/GPL/i.test(piper.license.codeLicense));
assert.strictEqual(piper.runtimeStrategy, 'ISOLATED_PYTHON');
assert.strictEqual(piper.modelVariant, 'en_US-lessac-medium');
assert.ok(piper.modelVariants.includes('en_US-lessac-medium'));
assert.ok(piper.modelVariants.includes('vi_VN-vivos-x_low'));
assert.ok(piper.capabilities.cpu);
assert.ok(!piper.capabilities.voiceClone);
assert.strictEqual(cbn.optional, true);
assert.strictEqual(cbn.family, 'chatterbox');
assert.strictEqual(cbn.runtimeStrategy, 'ISOLATED_PYTHON');
assert.strictEqual(cbn.runtimeId, 'chatterbox');
assert.strictEqual(cbn.modelVariant, 'nano');
assert.deepStrictEqual([...cbn.modelVariants], ['nano', 'turbo']);
assert.strictEqual(cbn.capabilities.modelVariantSelect, true);
assert.strictEqual(cbn.capabilities.expressionTags, true);
assert.strictEqual(cbn.capabilities.voiceClone, true);
assert.ok(cbn.languages.includes('en'));
assert.ok(!cbn.languages.includes('vi'));
assert.ok(!(cbn.badges || []).some((b) => /việt|vietnamese/i.test(b)));
assert.ok(/MIT/i.test(cbn.license.codeLicense));

assert.strictEqual(qwen3.optional, true);
assert.strictEqual(qwen3.family, 'qwen3');
assert.strictEqual(qwen3.runtimeStrategy, 'ISOLATED_PYTHON');
assert.strictEqual(qwen3.runtimeId, 'qwen3');
assert.deepStrictEqual([...qwen3.modelVariants], ['0.6b-custom', '0.6b-base']);
assert.strictEqual(qwen3.capabilities.voiceDesign, false);
assert.strictEqual(qwen3.capabilities.languageSelect, true);
assert.ok(!qwen3.languages.includes('vi'));
assert.ok(!(qwen3.badges || []).some((b) => /việt|vietnamese/i.test(b)));
assert.ok(/Apache/i.test(qwen3.license.codeLicense));

assert.strictEqual(spark.optional, true);
assert.strictEqual(spark.family, 'spark');
assert.strictEqual(spark.runtimeStrategy, 'ISOLATED_PYTHON');
assert.strictEqual(spark.runtimeId, 'spark');
assert.strictEqual(spark.capabilities.voiceClone, true);
assert.strictEqual(spark.capabilities.speakerControls, true);
assert.ok(!spark.languages.includes('vi'));
assert.ok(!(spark.badges || []).some((b) => /việt|vietnamese/i.test(b)));
assert.ok(/Apache/i.test(spark.license.codeLicense));

assert.strictEqual(gsv.optional, true);
assert.strictEqual(gsv.family, 'gpt-sovits');
assert.strictEqual(gsv.category, 'voice-lab');
assert.strictEqual(gsv.runtimeStrategy, 'ISOLATED_PYTHON');
assert.strictEqual(gsv.runtimeId, 'gpt-sovits');
assert.strictEqual(gsv.capabilities.voiceClone, true);
assert.strictEqual(gsv.capabilities.customCheckpoints, true);
assert.ok(!gsv.languages.includes('vi'));
assert.ok(!(gsv.badges || []).some((b) => /việt|vietnamese/i.test(b)));
assert.ok((gsv.badges || []).includes('Voice Lab'));
assert.strictEqual(gsv.license.attentionRequired, true);

// required metadata
for (const entry of listed) {
    registry.assertRequiredMetadata(entry);
    for (const key of registry.REQUIRED_FIELDS) {
        assert.ok(entry[key] !== undefined && entry[key] !== null, `${entry.id}.${key}`);
    }
    assert.ok(Array.isArray(entry.strengths));
    assert.ok(Array.isArray(entry.weaknesses));
    assert.ok(Array.isArray(entry.bestFor));
    assert.ok(Array.isArray(entry.avoidWhen));
    assert.ok(entry.license.codeLicense !== undefined);
    assert.ok(entry.license.modelLicense !== undefined);
    assert.ok(typeof entry.license.attentionRequired === 'boolean');
    assert.ok(entry.settings.voiceSettingKey);
    assert.ok(entry.runtimeStrategy);
    assert.ok(entry.capabilities.cpu !== undefined);
}

assert.strictEqual(turbo.settings.voiceSettingKey, 'voice');
assert.strictEqual(nano.settings.voiceSettingKey, 'voiceNano');
assert.strictEqual(edge.settings.voiceSettingKey, 'edgeVoice');
assert.strictEqual(edge.settings.voiceModeSettingKey, 'edgeVoiceMode');

const pub = registry.listPublic(() => 'INSTALLED');
assert.ok(!('EngineClass' in pub[0]));
assert.strictEqual(pub.length, 11);

// --- Pool manager still keyed by canonical id ---
const mgr = new EnginePoolManager();
const p1 = mgr.getPool('vieneu', 2);
const p2 = mgr.getPool('vieneu-turbo', 2);
assert.strictEqual(p1, p2);
assert.ok(p1 instanceof EnginePool);
mgr.shutdownAll();

// --- Jobs: canonical files match legacy names ---
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jobs-reg-'));
function readJsonFile(filePath, fallback) {
    try {
        if (!fs.existsSync(filePath)) return fallback;
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (_) {
        return fallback;
    }
}
function writeJsonFile(filePath, value) {
    fs.writeFileSync(filePath, JSON.stringify(value || [], null, 2), 'utf8');
}
const store = createJobsStore(tmp, { readJsonFile, writeJsonFile });

writeJsonFile(path.join(tmp, 'tts-jobs.json'), [{ id: 'L1', text: 'legacy' }]);
writeJsonFile(path.join(tmp, 'tts-jobs-vieneu.json'), [{ id: 'T1', text: 'turbo-legacy' }]);
writeJsonFile(path.join(tmp, 'tts-jobs-v3nano.json'), [{ id: 'N1', text: 'nano-legacy' }]);
writeJsonFile(path.join(tmp, 'tts-jobs-edge.json'), [{ id: 'E1', text: 'edge-legacy' }]);

assert.strictEqual(store.loadJobs('vieneu')[0].text, 'turbo-legacy');
assert.strictEqual(store.loadJobs('v3nano')[0].text, 'nano-legacy');
assert.strictEqual(store.loadJobs('edge')[0].text, 'edge-legacy');

// Nano must not inherit ultra-legacy tts-jobs.json
fs.rmSync(path.join(tmp, 'tts-jobs-v3nano.json'), { force: true });
assert.strictEqual(store.loadJobs('v3nano').length, 0);

// alias id loads same store
store.saveJobs('vieneu-turbo', [{ id: 'A1', text: 'via-alias' }]);
assert.strictEqual(store.loadJobs('vieneu')[0].text, 'via-alias');

fs.rmSync(tmp, { recursive: true, force: true });

// renderer meta ids match
const metaPath = path.join(__dirname, '..', 'src', 'batch', 'engine-meta.js');
const metaSrc = fs.readFileSync(metaPath, 'utf8');
for (const id of ids) {
    assert.ok(metaSrc.includes(`${id}:`) || metaSrc.includes(`'${id}'`), `meta missing ${id}`);
}

console.log('engine-registry.selfcheck: ok');
