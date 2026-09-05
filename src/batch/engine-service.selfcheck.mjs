/**
 * Self-check: pure option builders for EngineService (no Electron).
 * Run: node src/batch/engine-service.selfcheck.mjs
 */
import assert from 'assert';
import {
    buildInitOptions,
    buildSynthOptions,
} from './engine-service.js';
import { getEngineMeta } from './engine-meta.js';

const settings = {
    pythonPath: '',
    device: 'cpu',
    threads: 4,
    speed: 1.2,
    edgeVoiceMode: 'vietnamese',
    edgeRate: 10,
    edgePitch: 0,
    edgeVolume: 0,
    stripHash: true,
    useSeaG2p: true,
    silenceLinePunct: 0.3,
    volume: 1,
};

for (const id of ['vieneu', 'v3nano', 'edge']) {
    const meta = getEngineMeta(id);
    assert.ok(meta, id);

    const initOpts = buildInitOptions(meta, {}, settings);
    if (meta.capabilities.voiceMode) {
        assert.ok(initOpts.voiceMode, `${id} voiceMode`);
        assert.ok(!initOpts.mode, `${id} should not set worker mode`);
    } else {
        assert.ok(initOpts.mode, `${id} mode`);
        assert.ok(initOpts.engineOptions, `${id} engineOptions`);
    }

    const synthOpts = buildSynthOptions(meta, settings, { stripHash: false });
    if (meta.capabilities.edgeRate) {
        assert.ok('edgeRate' in synthOpts, `${id} edgeRate`);
        assert.strictEqual(synthOpts.stripHash, false);
    } else {
        assert.ok('speed' in synthOpts, `${id} speed`);
        assert.strictEqual(synthOpts.stripHash, false);
    }

    assert.strictEqual(
        meta.outputFormat,
        id === 'edge' ? 'mp3' : 'wav',
        `${id} outputFormat`
    );
}

// overrides win
const edgeMeta = getEngineMeta('edge');
const o = buildInitOptions(edgeMeta, { voiceMode: 'multilingual' }, settings);
assert.strictEqual(o.voiceMode, 'multilingual');

const nanoMeta = getEngineMeta('v3nano');
const n = buildInitOptions(nanoMeta, { mode: 'v3nano' }, settings);
assert.strictEqual(n.mode, 'v3nano');

console.log('engine-service.selfcheck: ok');
