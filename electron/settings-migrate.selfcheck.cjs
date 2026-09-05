/**
 * Self-check: settings engineSettings migration (P07).
 * Run: node electron/settings-migrate.selfcheck.cjs
 */
const assert = require('assert');
const {
    SETTINGS_SCHEMA_VERSION,
    migrateSettingsOnLoad,
    migrateSettingsOnSave,
} = require('./settings-migrate.cjs');

// --- legacy user VieNeu ---
{
    const loaded = migrateSettingsOnLoad({ voice: 'banmai', speed: 1.1 });
    assert.strictEqual(loaded.engineSettings.vieneu.voice, 'banmai');
    assert.strictEqual(loaded.voice, 'banmai');
    assert.ok(loaded.settingsSchemaVersion >= SETTINGS_SCHEMA_VERSION);
}

// --- legacy Nano ---
{
    const loaded = migrateSettingsOnLoad({ voiceNano: 'nano-a' });
    assert.strictEqual(loaded.engineSettings.v3nano.voice, 'nano-a');
    assert.strictEqual(loaded.voiceNano, 'nano-a');
}

// --- legacy Edge ---
{
    const loaded = migrateSettingsOnLoad({
        edgeVoice: 'vi-VN-NamMinhNeural',
        edgeVoiceMode: 'vietnamese',
        edgeRate: 15,
    });
    assert.strictEqual(loaded.engineSettings.edge.voice, 'vi-VN-NamMinhNeural');
    assert.strictEqual(loaded.engineSettings.edge.rate, 15);
    assert.strictEqual(loaded.edgeVoice, 'vi-VN-NamMinhNeural');
}

// --- new user defaults ---
{
    const loaded = migrateSettingsOnLoad({});
    assert.ok(loaded.engineSettings.vieneu);
    assert.ok(loaded.engineSettings.v3nano);
    assert.ok(loaded.engineSettings.edge);
    assert.strictEqual(loaded.engineSettings.edge.voiceMode, 'vietnamese');
}

// --- do not overwrite existing engineSettings from legacy on reload ---
{
    const first = migrateSettingsOnLoad({
        voice: 'legacy-voice',
        engineSettings: { vieneu: { voice: 'canonical-voice' } },
    });
    assert.strictEqual(first.engineSettings.vieneu.voice, 'canonical-voice');
    assert.strictEqual(first.voice, 'canonical-voice'); // mirrored out

    const second = migrateSettingsOnLoad(first);
    assert.strictEqual(second.engineSettings.vieneu.voice, 'canonical-voice');
}

// --- save folds flat edits into engineSettings ---
{
    const saved = migrateSettingsOnSave({
        voice: 'new-turbo',
        voiceNano: 'new-nano',
        edgeVoice: 'e1',
        edgeVoiceMode: 'multilingual',
        edgeRate: 5,
        edgePitch: 1,
        edgeVolume: -2,
        engineSettings: { vieneu: { voice: 'old' } },
    });
    assert.strictEqual(saved.engineSettings.vieneu.voice, 'new-turbo');
    assert.strictEqual(saved.engineSettings.v3nano.voice, 'new-nano');
    assert.strictEqual(saved.engineSettings.edge.voice, 'e1');
    assert.strictEqual(saved.engineSettings.edge.voiceMode, 'multilingual');
    assert.strictEqual(saved.engineSettings.edge.rate, 5);
    assert.strictEqual(saved.settingsSchemaVersion, SETTINGS_SCHEMA_VERSION);
    // mirrors still present
    assert.strictEqual(saved.voice, 'new-turbo');
    assert.strictEqual(saved.edgeVoiceMode, 'multilingual');
}

// --- restart simulation: save then load ---
{
    const saved = migrateSettingsOnSave({ voice: 'persist-me', edgeRate: 9 });
    const again = migrateSettingsOnLoad(JSON.parse(JSON.stringify(saved)));
    assert.strictEqual(again.engineSettings.vieneu.voice, 'persist-me');
    assert.strictEqual(again.engineSettings.edge.rate, 9);
    assert.strictEqual(again.voice, 'persist-me');
}

console.log('settings-migrate.selfcheck: ok');
