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
    edgeInit: (d) => ipcRenderer.invoke('edge:init', d),
    edgeReload: () => ipcRenderer.invoke('edge:reload'),
    edgeSynthesize: (d) => ipcRenderer.invoke('edge:synthesize', d),

    saveAudio: (data) => ipcRenderer.invoke('tts:saveAudio', data),
    openPath: (p) => ipcRenderer.invoke('shell:openPath', p),
    showItemInFolder: (p) => ipcRenderer.invoke('shell:showItemInFolder', p),
    openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),

    ttsSynthesize: (d) => ipcRenderer.invoke('tts:synthesize', d),

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
