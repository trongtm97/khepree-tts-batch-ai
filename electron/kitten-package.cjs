/**
 * KittenTTS optional model packages (one download per variant).
 * Official models: https://github.com/KittenML/KittenTTS
 * HF: KittenML/kitten-tts-{mini,micro,nano,nano-int8}-0.8
 */
const mdl = require('./model-download-manager.cjs');

/** @type {ReadonlyArray<{ id: string, label: string, repo: string, onnx: string }>} */
const VARIANTS = Object.freeze([
    {
        id: 'mini',
        label: 'Mini (80M · ~80MB)',
        repo: 'KittenML/kitten-tts-mini-0.8',
        onnx: 'kitten_tts_mini_v0_8.onnx',
    },
    {
        id: 'micro',
        label: 'Micro (40M · ~41MB)',
        repo: 'KittenML/kitten-tts-micro-0.8',
        onnx: 'kitten_tts_micro_v0_8.onnx',
    },
    {
        id: 'nano',
        label: 'Nano (15M · fp32)',
        // Official docs also cite kitten-tts-nano-0.8; HF stores weights as nano-0.8-fp32
        repo: 'KittenML/kitten-tts-nano-0.8-fp32',
        onnx: 'kitten_tts_nano_v0_8.onnx',
    },
    {
        id: 'nano-int8',
        label: 'Nano INT8 (15M · ~25MB)',
        repo: 'KittenML/kitten-tts-nano-0.8-int8',
        onnx: 'kitten_tts_nano_v0_8.onnx',
    },
]);

function hfUrl(repo, file) {
    return `https://huggingface.co/${repo}/resolve/main/${file}`;
}

function filesFor(variant) {
    return [
        { relativePath: 'config.json', url: hfUrl(variant.repo, 'config.json') },
        { relativePath: variant.onnx, url: hfUrl(variant.repo, variant.onnx) },
        { relativePath: 'voices.npz', url: hfUrl(variant.repo, 'voices.npz') },
    ];
}

function registerKittenPackages() {
    for (const v of VARIANTS) {
        mdl.registerPackage({
            engineId: 'kitten',
            variant: v.id,
            version: `kitten-tts-${v.id}-0.8`,
            files: filesFor(v),
        });
    }
}

function listVariants() {
    return VARIANTS.map((v) => ({ id: v.id, label: v.label, repo: v.repo }));
}

module.exports = {
    VARIANTS,
    registerKittenPackages,
    listVariants,
    filesFor,
};
