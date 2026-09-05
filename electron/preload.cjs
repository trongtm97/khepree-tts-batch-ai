const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
    getAppInfo: () => ipcRenderer.invoke('app:info'),
    loadSettings: () => ipcRenderer.invoke('settings:load'),
    saveSettings: (s) => ipcRenderer.invoke('settings:save', s),

    selectFolder: (opts) => ipcRenderer.invoke('dialog:selectFolder', opts),
    selectFiles: (filters) => ipcRenderer.invoke('dialog:selectFiles', filters),

    importFolder: (p) => ipcRenderer.invoke('import:folder', p),
    importExcel: (p) => ipcRenderer.invoke('import:excel', p),
    importTxt: (p) => ipcRenderer.invoke('import:txt', p),
    chunkText: (d) => ipcRenderer.invoke('chunk:text', d),
    downloadTemplate: () => ipcRenderer.invoke('import:downloadTemplate'),
    openBundledTemplate: () => ipcRenderer.invoke('import:openBundledTemplate'),

    listModels: () => ipcRenderer.invoke('tts:listModels'),
    ttsInit: (d) => ipcRenderer.invoke('tts:init', d),
    ttsReload: () => ipcRenderer.invoke('tts:reload'),
    ttsSynthesize: (d) => ipcRenderer.invoke('tts:synthesize', d),
    edgeInit: (d) => ipcRenderer.invoke('edge:init', d),
    edgeReload: () => ipcRenderer.invoke('edge:reload'),
    edgeSynthesize: (d) => ipcRenderer.invoke('edge:synthesize', d),

    /** Generic engine API (preferred) */
    listEngines: () => ipcRenderer.invoke('engine:list'),
    engineInit: (d) => ipcRenderer.invoke('engine:init', d),
    engineSynthesize: (d) => ipcRenderer.invoke('engine:synthesize', d),
    engineReload: (engineId) => ipcRenderer.invoke('engine:reload', engineId),
    engineUnload: (engineId) => ipcRenderer.invoke('engine:unload', engineId),
    engineStatus: (engineId) => ipcRenderer.invoke('engine:status', engineId),

    /** Compat aliases used by earlier renderer code */
    engineList: () => ipcRenderer.invoke('engine:list'),
    engineGetStatus: (engineId) => ipcRenderer.invoke('engine:status', engineId),

    /** Optional model download (explicit install only — never auto on Generate) */
    modelGetStatus: (engineId, variant) =>
        ipcRenderer.invoke('model:getStatus', { engineId, variant }),
    modelInstall: (engineId, variant) =>
        ipcRenderer.invoke('model:install', { engineId, variant }),
    modelCancel: (engineId, variant) =>
        ipcRenderer.invoke('model:cancel', { engineId, variant }),
    modelVerify: (engineId, variant) =>
        ipcRenderer.invoke('model:verify', { engineId, variant }),
    modelUninstall: (engineId, variant) =>
        ipcRenderer.invoke('model:uninstall', { engineId, variant }),
    onModelDownloadProgress: (cb) => {
        const handler = (_, d) => cb(d);
        ipcRenderer.on('model:download-progress', handler);
        return () => ipcRenderer.removeListener('model:download-progress', handler);
    },

    /** Piper optional (GPLv3) — explicit install only */
    piperListCatalog: () => ipcRenderer.invoke('piper:listCatalog'),
    piperVoiceLicense: (variant) => ipcRenderer.invoke('piper:voiceLicense', { variant }),
    piperInstallRuntime: () => ipcRenderer.invoke('piper:installRuntime'),
    piperUninstallRuntime: () => ipcRenderer.invoke('piper:uninstallRuntime'),
    piperInstallOptional: (variant) => ipcRenderer.invoke('piper:installOptional', { variant }),
    piperUninstallAll: () => ipcRenderer.invoke('piper:uninstallAll'),

    chatterboxListTags: () => ipcRenderer.invoke('chatterbox:listTags'),
    chatterboxInstallOptional: (variant) => ipcRenderer.invoke('chatterbox:installOptional', {
        variant: typeof variant === 'string' ? variant : variant?.variant,
    }),
    chatterboxUninstallAll: () => ipcRenderer.invoke('chatterbox:uninstallAll'),
    chatterboxRuntimeStatus: () => ipcRenderer.invoke('chatterbox:runtimeStatus'),

    qwen3ListLanguages: () => ipcRenderer.invoke('qwen3:listLanguages'),
    qwen3ListSpeakers: () => ipcRenderer.invoke('qwen3:listSpeakers'),
    qwen3InstallOptional: (variant) => ipcRenderer.invoke('qwen3:installOptional', {
        variant: typeof variant === 'string' ? variant : variant?.variant,
    }),
    qwen3UninstallAll: () => ipcRenderer.invoke('qwen3:uninstallAll'),
    qwen3RuntimeStatus: () => ipcRenderer.invoke('qwen3:runtimeStatus'),

    sparkListLanguages: () => ipcRenderer.invoke('spark:listLanguages'),
    sparkInstallOptional: () => ipcRenderer.invoke('spark:installOptional'),
    sparkUninstallAll: () => ipcRenderer.invoke('spark:uninstallAll'),
    sparkRuntimeStatus: () => ipcRenderer.invoke('spark:runtimeStatus'),

    gptSovitsListLanguages: () => ipcRenderer.invoke('gptSovits:listLanguages'),
    gptSovitsInstallOptional: () => ipcRenderer.invoke('gptSovits:installOptional'),
    gptSovitsUninstallAll: () => ipcRenderer.invoke('gptSovits:uninstallAll'),
    gptSovitsRuntimeStatus: () => ipcRenderer.invoke('gptSovits:runtimeStatus'),
    gptSovitsListProfiles: () => ipcRenderer.invoke('gptSovits:listProfiles'),
    gptSovitsCreateProfile: (d) => ipcRenderer.invoke('gptSovits:createProfile', d),
    gptSovitsDeleteProfile: (d) => ipcRenderer.invoke('gptSovits:deleteProfile', d),

    /** Hardware profile + engine compatibility (advisor) */
    getHardwareProfile: (opts) => ipcRenderer.invoke('hardware:getProfile', opts || {}),
    adviseEngine: (engineId, variant) => ipcRenderer.invoke('hardware:advise', { engineId, variant }),
    adviseAllEngines: () => ipcRenderer.invoke('hardware:adviseAll'),

    /** Local benchmark + AUTO recommender (never auto-download) */
    benchmarkListTasks: () => ipcRenderer.invoke('benchmark:listTasks'),
    benchmarkGetCorpus: () => ipcRenderer.invoke('benchmark:getCorpus'),
    benchmarkGetResults: (opts) => ipcRenderer.invoke('benchmark:getResults', opts || {}),
    benchmarkRun: (opts) => ipcRenderer.invoke('benchmark:run', opts || {}),
    benchmarkRecommend: (opts) => ipcRenderer.invoke('benchmark:recommend', opts || {}),
    onBenchmarkProgress: (cb) => {
        const handler = (_, d) => cb(d);
        ipcRenderer.on('benchmark:progress', handler);
        return () => ipcRenderer.removeListener('benchmark:progress', handler);
    },
    onBenchmarkDone: (cb) => {
        const handler = (_, d) => cb(d);
        ipcRenderer.on('benchmark:done', handler);
        return () => ipcRenderer.removeListener('benchmark:done', handler);
    },

    saveAudio: (data) => ipcRenderer.invoke('tts:saveAudio', data),
    openPath: (p) => ipcRenderer.invoke('shell:openPath', p),
    showItemInFolder: (p) => ipcRenderer.invoke('shell:showItemInFolder', p),
    openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),

    saveJobs: (engine, jobs) => ipcRenderer.invoke('jobs:save', { engine, jobs }),
    loadJobs: (engine) => ipcRenderer.invoke('jobs:load', engine),

    historyAdd: (e) => ipcRenderer.invoke('history:add', e),
    historyList: () => ipcRenderer.invoke('history:list'),

    onLog: (cb) => ipcRenderer.on('log:message', (_, d) => cb(d)),

    khepreeGetState: () => ipcRenderer.invoke('khepree:getState'),
    khepreeStartLogin: () => ipcRenderer.invoke('khepree:startLogin'),
    khepreeLogout: () => ipcRenderer.invoke('khepree:logout'),
    khepreeOpenProductPage: () => ipcRenderer.invoke('khepree:openProductPage'),
    khepreeRefreshOffers: () => ipcRenderer.invoke('khepree:refreshOffers'),
    khepreeStartCheckout: (d) => ipcRenderer.invoke('khepree:startCheckout', d),
    khepreeRefreshMe: () => ipcRenderer.invoke('khepree:refreshMe'),
    onKhepreeState: (cb) => {
        const handler = (_, d) => cb(d);
        ipcRenderer.on('khepree:state', handler);
        return () => ipcRenderer.removeListener('khepree:state', handler);
    },
});
