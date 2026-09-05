import { getEdgeSynthOptions } from './settings.js';
import { formatKhepreeAccessError } from './khepree-access-messages.js';

export class EdgeTTSService {
    constructor() {
        this.ready = false;
        this.voices = [];
        this.voiceMode = 'vietnamese';
    }

    async init(voiceMode, appSettings = {}) {
        const mode = voiceMode || appSettings.edgeVoiceMode || 'vietnamese';
        const result = await window.api.edgeInit({
            voiceMode: mode,
            pythonPath: appSettings.pythonPath,
        });
        if (result?.error) throw new Error(result.error);
        this.ready = true;
        this.voiceMode = result.voiceMode || mode;
        this.voices = result.voices || [];
        return this.voices;
    }

    async synthesize(text, voiceName, appSettings = {}, overrides = {}) {
        if (!this.ready) throw new Error('Edge TTS chưa sẵn sàng');
        const options = {
            ...getEdgeSynthOptions(appSettings),
            ...overrides,
        };
        const result = await window.api.edgeSynthesize({
            text,
            voice: voiceName,
            options,
        });
        if (result?.error) throw new Error(formatKhepreeAccessError(result.error));
        const raw = result.buffer;
        const bytes = raw?.data ? new Uint8Array(raw.data) : new Uint8Array(raw);
        const ext = result.format || 'mp3';
        return new Blob([bytes], { type: ext === 'wav' ? 'audio/wav' : 'audio/mpeg' });
    }

    dispose() {
        this.ready = false;
        this.voices = [];
    }
}

export default EdgeTTSService;
