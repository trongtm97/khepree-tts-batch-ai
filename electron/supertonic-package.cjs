/**
 * Supertonic 3 optional model package (HuggingFace Supertone/supertonic-3).
 * Registers with Model Download Manager — install before synthesize.
 *
 * Sources:
 * - https://huggingface.co/Supertone/supertonic-3
 * - https://supertone-inc.github.io/supertonic-py/
 */
const mdl = require('./model-download-manager.cjs');

const HF = 'https://huggingface.co/Supertone/supertonic-3/resolve/main';

const ONNX_FILES = [
    'onnx/duration_predictor.onnx',
    'onnx/text_encoder.onnx',
    'onnx/vector_estimator.onnx',
    'onnx/vocoder.onnx',
    'onnx/tts.json',
    'onnx/unicode_indexer.json',
];

const VOICE_STYLES = [
    'F1', 'F2', 'F3', 'F4', 'F5',
    'M1', 'M2', 'M3', 'M4', 'M5',
].map((n) => `voice_styles/${n}.json`);

const EXTRA = ['config.json', 'LICENSE'];

function buildFiles() {
    return [...ONNX_FILES, ...VOICE_STYLES, ...EXTRA].map((relativePath) => ({
        relativePath,
        url: `${HF}/${relativePath}`,
        // No invented checksums — verify non-empty + presence via manager
    }));
}

function registerSupertonicPackage() {
    mdl.registerPackage({
        engineId: 'supertonic',
        variant: 'default',
        version: 'supertonic-3',
        files: buildFiles(),
    });
}

module.exports = {
    HF,
    ONNX_FILES,
    VOICE_STYLES,
    registerSupertonicPackage,
    buildFiles,
};
