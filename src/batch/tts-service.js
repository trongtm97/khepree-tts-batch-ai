/**
 * VieNeu-TTS client (Electron IPC)
 */
import { getEngineOptions, getSynthOptions } from './settings.js';
import { formatKhepreeAccessError } from './khepree-access-messages.js';

export class TTSService {
    constructor() {
        this.ready = false;
        this.voices = [];
        this.mode = null;
    }

    async init(mode, appSettings = {}) {
        if (this.mode && this.mode !== mode) this.dispose();
        const result = await window.api.ttsInit({
            mode,
            engineOptions: getEngineOptions(appSettings),
        });
        if (result?.error) throw new Error(result.error);
        this.ready = true;
        this.mode = result.mode || mode;
        this.voices = result.voices || [];
        return this.voices;
    }

    async synthesize(text, voiceName, appSettings = {}, overrides = {}) {
        if (!this.ready) throw new Error('Engine chưa sẵn sàng');
        const synthOptions = {
            ...getSynthOptions(appSettings),
            ...overrides,
        };
        const result = await window.api.ttsSynthesize({
            text,
            voice: voiceName,
            mode: this.mode,
            options: synthOptions,
        });
        if (result?.error) throw new Error(formatKhepreeAccessError(result.error));
        const raw = result.buffer;
        const bytes = raw?.data ? new Uint8Array(raw.data) : new Uint8Array(raw);
        return new Blob([bytes], { type: 'audio/wav' });
    }

    dispose() {
        this.ready = false;
        this.voices = [];
        this.mode = null;
    }
}

export default TTSService;
