/**
 * Installer contract audit — optional models must not ship in electron-builder.
 * Run: node electron/installer-audit.selfcheck.cjs
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const extras = pkg.build?.extraResources || [];

const modelEntries = extras.filter((e) =>
    String(e.to || '').replace(/\\/g, '/').startsWith('models')
    || String(e.from || '').replace(/\\/g, '/').includes('models')
);

assert.ok(modelEntries.length >= 1, 'must ship VieNeu models');
for (const e of modelEntries) {
    const from = String(e.from || '').replace(/\\/g, '/');
    const to = String(e.to || '').replace(/\\/g, '/');
    // Must be narrow: models/vieneu — never entire models/
    assert.ok(
        from === 'models/vieneu' || from.endsWith('/models/vieneu'),
        `optional-safe models from= expected models/vieneu, got ${from}`
    );
    assert.ok(
        to === 'models/vieneu' || to.endsWith('/models/vieneu'),
        `optional-safe models to= expected models/vieneu, got ${to}`
    );
    assert.notStrictEqual(from, 'models', 'must not copy entire models/ tree');
}

const bundleReq = fs.readFileSync(path.join(root, 'python', 'requirements-bundle.txt'), 'utf8');
const active = bundleReq.split('\n').filter((l) => l.trim() && !l.trim().startsWith('#')).join('\n');
assert.ok(!/^\s*torch\b/im.test(active), 'core bundle must not include torch');
assert.ok(!/^\s*gradio\b/im.test(active), 'core bundle must not include gradio');
assert.ok(!/chatterbox|qwen3|spark|gpt.?sovits|piper-tts/i.test(active), 'heavy optional engines not in core reqs');

const notices = path.join(root, 'THIRD_PARTY_NOTICES.md');
assert.ok(fs.existsSync(notices), 'THIRD_PARTY_NOTICES.md required for release');

console.log('installer-audit.selfcheck: ok');
console.log('  models extraResources → models/vieneu only');
console.log('  core requirements: no torch/gradio/heavy optional');
