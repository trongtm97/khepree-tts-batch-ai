/**
 * Kokoro optional model packages (kokoro-onnx model-files-v1.1).
 * Docs: docs/engines/kokoro.md
 * Release: https://github.com/thewh1teagle/kokoro-onnx/releases/tag/model-files-v1.1
 */
const mdl = require('./model-download-manager.cjs');

const RELEASE = 'https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.1';

/** @type {ReadonlyArray<{ id: string, label: string, onnx: string, voices: string }>} */
const VARIANTS = Object.freeze([
    {
        id: 'int8',
        label: 'INT8 (~80MB · mặc định · CPU)',
        onnx: 'kokoro-v1.0.int8.onnx',
        voices: 'voices-v1.0.bin',
    },
    {
        id: 'fp32',
        label: 'FP32 (~310MB · chất lượng cao hơn)',
        onnx: 'kokoro-v1.0.onnx',
        voices: 'voices-v1.0.bin',
    },
]);

function filesFor(variant) {
    return [
        { relativePath: variant.onnx, url: `${RELEASE}/${variant.onnx}` },
        { relativePath: variant.voices, url: `${RELEASE}/${variant.voices}` },
    ];
}

function registerKokoroPackages() {
    for (const v of VARIANTS) {
        mdl.registerPackage({
            engineId: 'kokoro',
            variant: v.id,
            version: `kokoro-onnx-v1.0-${v.id}`,
            files: filesFor(v),
        });
    }
}

function listVariants() {
    return VARIANTS.map((v) => ({ id: v.id, label: v.label }));
}

module.exports = {
    VARIANTS,
    registerKokoroPackages,
    listVariants,
    filesFor,
};
