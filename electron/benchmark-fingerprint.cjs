/**
 * Hardware fingerprint for local benchmark result keys.
 * Stable subset only — no timestamps.
 */
const crypto = require('crypto');

function hardwareFingerprint(profile = {}) {
    const payload = {
        os: profile.os?.platform || '',
        arch: profile.os?.arch || '',
        cpu: profile.cpu?.name || '',
        cores: Number(profile.cpu?.cores) || 0,
        ramGb: Number(profile.ram?.totalGb) || 0,
        nvidia: Boolean(profile.gpu?.nvidia),
        gpu: profile.gpu?.name || '',
        vramMb: profile.gpu?.vramTrusted ? (Number(profile.gpu?.vramMb) || 0) : null,
    };
    const raw = JSON.stringify(payload);
    return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16);
}

module.exports = { hardwareFingerprint };
