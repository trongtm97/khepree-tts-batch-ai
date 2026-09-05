/**
 * Guard: BatchController must not grow per-engine booleans.
 * Run: node src/batch/tts-tab-engine.selfcheck.cjs
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, 'tts-tab.js'), 'utf8');

const forbidden = [
    /\bisEdge\b/,
    /\bisNano\b/,
    /\bisPiper\b/,
    /\bisKokoro\b/,
    /\bisChatterbox\b/,
    /\bisKitten\b/,
    /new TTSService\b/,
    /new EdgeTTSService\b/,
];

for (const re of forbidden) {
    assert.ok(!re.test(src), `forbidden pattern in tts-tab.js: ${re}`);
}

assert.ok(src.includes('EngineService'), 'must use EngineService');
assert.ok(src.includes('applyEngine'), 'must bind engine via applyEngine');
assert.ok(src.includes('getEngineMeta'), 'must read engine metadata');
assert.ok(src.includes('this.caps'), 'must use capabilities');
assert.ok(src.includes('this.audioFormat'), 'must use outputFormat via audioFormat');
assert.ok(src.includes('this.voiceKey'), 'must use settings voice key');

// Meta contract for the three shipping engines
const metaPath = path.join(__dirname, 'engine-meta.js');
const metaSrc = fs.readFileSync(metaPath, 'utf8');
for (const id of ['vieneu', 'v3nano', 'edge', 'supertonic', 'kitten', 'kokoro', 'piper', 'chatterbox', 'qwen3', 'spark', 'gpt-sovits']) {
    assert.ok(metaSrc.includes(`${id}:`) || metaSrc.includes(`'${id}'`), `engine-meta missing ${id}`);
}
assert.ok(metaSrc.includes("voice: 'voice'"));
assert.ok(metaSrc.includes("voice: 'voiceNano'"));
assert.ok(metaSrc.includes("voice: 'edgeVoice'"));
assert.ok(metaSrc.includes("outputFormat: 'wav'"));
assert.ok(metaSrc.includes("outputFormat: 'mp3'"));

console.log('tts-tab-engine.selfcheck: ok');
