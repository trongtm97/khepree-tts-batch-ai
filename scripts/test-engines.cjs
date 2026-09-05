const { app } = require('electron');
const paths = require('../electron/paths.cjs');
const { EdgeTTSEngine } = require('../electron/edge-engine.cjs');
const { VieNeuEngine } = require('../electron/vieneu-engine.cjs');

app.whenReady().then(async () => {
    try {
        console.log('Python:', paths.resolvePythonCmd(''));
        console.log('App root:', paths.getAppRoot());

        const edge = new EdgeTTSEngine();
        const edgeRes = await edge.init('vietnamese', '');
        console.log('Edge OK:', edgeRes.voices?.length, 'voices');
        edge.stop();

        const vieneu = new VieNeuEngine();
        const vRes = await vieneu.init('v3turbo', '', { device: 'cpu', threads: 4 });
        console.log('VieNeu Turbo OK:', vRes.mode, vRes.voices?.length, 'voices');
        vieneu.stop();

        const nano = new VieNeuEngine();
        const nRes = await nano.init('v3nano', '', { device: 'cpu', threads: 4 });
        console.log('VieNeu Nano OK:', nRes.mode, nRes.voices?.length, 'voices');
        nano.stop();

        console.log('ALL ENGINES OK');
        app.quit();
    } catch (e) {
        console.error('FAIL:', e.message);
        app.quit();
        process.exit(1);
    }
});
