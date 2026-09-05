/**
 * Load project-authored benchmark corpus (samples/benchmark/corpus.json).
 */
const fs = require('fs');
const path = require('path');
const paths = require('./paths.cjs');

function corpusPath() {
    return path.join(paths.getAppRoot(), 'samples', 'benchmark', 'corpus.json');
}

function loadCorpus() {
    const raw = JSON.parse(fs.readFileSync(corpusPath(), 'utf8'));
    const items = Array.isArray(raw.items) ? raw.items : [];
    return {
        version: raw.version || 1,
        description: raw.description || '',
        items: items.filter((it) => it && it.id && it.text),
    };
}

module.exports = { corpusPath, loadCorpus };
