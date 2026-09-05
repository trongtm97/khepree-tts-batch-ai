import { EngineService } from './engine-service.js';
import { getEngineMeta, resolveEngineId } from './engine-meta.js';
import {
    LANG,
    LANG_LABEL,
    detectJobsLanguage,
    resolveContentLanguage,
} from './language-detect.js';
import { gateLanguageBeforeAction } from './language-mismatch.js';

const STATUS = {
    pending: { label: 'Chờ', cls: 'pending', row: 'row-pending' },
    running: { label: 'Đang chạy', cls: 'running', row: 'row-running' },
    done: { label: 'Hoàn thành', cls: 'done', row: 'row-done' },
    error: { label: 'Lỗi', cls: 'error', row: 'row-error' },
};

function uid() {
    return 'T' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 5).toUpperCase();
}

function escHtml(s) {
    if (!s) return '';
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
}

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

function randDelay(min, max) {
    const lo = Math.min(min, max);
    const hi = Math.max(min, max);
    return lo + Math.random() * (hi - lo);
}

function sanitizeDirName(name) {
    return String(name || '').replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, '_').slice(0, 120) || '';
}

function previewText(text, max = 120) {
    const t = String(text || '').replace(/\s+/g, ' ').trim();
    return t.length <= max ? t : `${t.slice(0, max)}…`;
}

/** Ba nốt ngắn báo batch hoàn tất (Web Audio — không cần file ngoài). */
async function playBatchCompleteSound() {
    try {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return;
        const ctx = new Ctx();
        if (ctx.state === 'suspended') await ctx.resume();

        const tones = [
            [523.25, 0, 0.12],
            [659.25, 0.1, 0.12],
            [783.99, 0.2, 0.28],
        ];
        const t0 = ctx.currentTime;
        for (const [freq, delay, dur] of tones) {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.value = freq;
            const start = t0 + delay;
            gain.gain.setValueAtTime(0, start);
            gain.gain.linearRampToValueAtTime(0.18, start + 0.015);
            gain.gain.exponentialRampToValueAtTime(0.001, start + dur);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(start);
            osc.stop(start + dur + 0.03);
        }
        setTimeout(() => ctx.close().catch(() => {}), 900);
    } catch (_) {
        /* Âm thanh không bắt buộc — bỏ qua nếu trình duyệt chặn */
    }
}

class BatchController {
    constructor(pane, app, options = {}) {
        this.pane = pane;
        this.app = app;
        this.applyEngine(options.engine || 'vieneu', options.mode);
        this.jobs = [];
        this.running = false;
        this.paused = false;
        this.stopRequested = false;
        this.outputDir = '';
        this._loadModelPromise = null;

        /** Prompt 27 — content language (batch-level) */
        this.contentLanguageOverride = 'auto';
        this.detectedLanguage = null;
        this._suppressLangWarnEngines = new Set();
        this._langDetectTimer = null;

        this.searchQuery = '';
        this.filterStatus = 'all';
        this.sortKey = 'order';
        this.sortDir = 'asc';

        this.volume = 1;
        this.pauseScale = 1;

        this.bindElements();
        this.bindEvents();
        this.ensureContentLangUi();
        this.initOutputLabel();
        this.syncSlidersFromSettings();
        this.renderGrid();
        this.populateModels();
        this.loadJobs();
    }

    /** Bind engineId → metadata + EngineService (no per-engine if/else). */
    applyEngine(engineId, modeOverride) {
        this.engineId = resolveEngineId(engineId);
        this.engine = this.engineId; // jobs IPC key (legacy field name)
        this.meta = getEngineMeta(this.engineId);
        this.caps = this.meta.capabilities || {};
        this.settingsKey = this.meta.settingsKey || {};
        this.voiceKey = this.settingsKey.voice || 'voice';
        this.voiceModeKey = this.settingsKey.voiceMode || null;
        this.rateKey = this.settingsKey.rate || null;
        this.pitchKey = this.settingsKey.pitch || null;
        this.volumeKey = this.settingsKey.volume || null;
        this.langKey = this.settingsKey.lang || null;
        this.stepsKey = this.settingsKey.steps || null;
        this.variantKey = this.settingsKey.variant || null;
        this.speedKey = this.settingsKey.speed || null;
        this.audioFormat = this.meta.outputFormat || 'wav';
        this.mode = modeOverride || this.meta.mode || this.meta.workerMode || null;
        if (this.tts) this.tts.dispose();
        this.tts = new EngineService(this.engineId);
    }

    bindElements() {
        this.gridBody = this.pane.querySelector('.grid-body');
        this.gridWrap = this.pane.querySelector('.grid-drop-zone');
        this.selVoiceMode = this.pane.querySelector('.sel-voice-mode');
        this.selVoice = this.pane.querySelector('.sel-voice');
        this.speedRange = this.pane.querySelector('.inp-speed-range');
        this.speedVal = this.pane.querySelector('.speed-val');
        this.volumeRange = this.pane.querySelector('.inp-volume-range');
        this.volumeVal = this.pane.querySelector('.volume-val');
        this.pauseRange = this.pane.querySelector('.inp-pause-range');
        this.pauseVal = this.pane.querySelector('.pause-val');
        this.edgeRateRange = this.pane.querySelector('.inp-edge-rate');
        this.edgeRateVal = this.pane.querySelector('.edge-rate-val');
        this.edgePitchRange = this.pane.querySelector('.inp-edge-pitch');
        this.edgePitchVal = this.pane.querySelector('.edge-pitch-val');
        this.edgeVolumeRange = this.pane.querySelector('.inp-edge-volume');
        this.edgeVolumeVal = this.pane.querySelector('.edge-volume-val');
        this.selLang = this.pane.querySelector('.sel-lang');
        this.selVariant = this.pane.querySelector('.sel-variant');
        this.stepsRange = this.pane.querySelector('.inp-steps-range');
        this.stepsVal = this.pane.querySelector('.steps-val');
        this.engineStatus = this.pane.querySelector('.engine-status-badge');
        this.logBody = this.pane.querySelector('.log-body');
        this.outputLabel = this.pane.querySelector('.tab-output-dir-label');
        this.inpSearch = this.pane.querySelector('.inp-search');
        this.selFilter = this.pane.querySelector('.sel-filter-status');
        this.pageInfo = this.pane.querySelector('.page-info');
    }

    bindEvents() {
        const q = (sel) => this.pane.querySelector(sel);
        q('.btn-import-folder')?.addEventListener('click', () => this.importFolder());
        q('.btn-import-excel')?.addEventListener('click', () => this.importExcel());
        q('.btn-import-txt')?.addEventListener('click', () => this.importTxt());
        q('.btn-export-jobs')?.addEventListener('click', () => this.exportJobs());
        q('.btn-add-row')?.addEventListener('click', () => this.addRow());
        q('.btn-delete-selected')?.addEventListener('click', () => this.deleteSelected());
        q('.btn-clear-all')?.addEventListener('click', () => this.clearAll());
        q('.btn-run')?.addEventListener('click', () => this.run());
        q('.btn-pause')?.addEventListener('click', () => this.pause());
        q('.btn-resume')?.addEventListener('click', () => this.resume());
        q('.btn-stop')?.addEventListener('click', () => this.stop());
        q('.btn-run-errors')?.addEventListener('click', () => this.runErrors());
        q('.btn-pick-tab-outputDir')?.addEventListener('click', () => this.pickOutputDir());
        q('.btn-change-engine')?.addEventListener('click', () => this.app.tabManager?.showSelector());
        q('.btn-install-variant')?.addEventListener('click', () => this.installSelectedVariant());
        q('.btn-pick-ref-wav')?.addEventListener('click', () => this.pickRefWav());
        q('.btn-pick-gpt-ckpt')?.addEventListener('click', () => this.pickGptCkpt());
        q('.btn-pick-sovits-ckpt')?.addEventListener('click', () => this.pickSovitsCkpt());
        q('.btn-save-voice-profile')?.addEventListener('click', () => this.saveGptSovitsProfile());
        q('.check-all')?.addEventListener('change', (e) => this.toggleAll(e.target.checked));
        q('.btn-toggle-log')?.addEventListener('click', (e) => {
            if (e.target.closest('.btn-clear-log')) return;
            q('.log-panel')?.classList.toggle('collapsed');
        });
        q('.btn-clear-log')?.addEventListener('click', () => { this.logBody.innerHTML = ''; });

        this.selVoice?.addEventListener('change', () => {
            this.app.settings[this.voiceKey] = this.selVoice.value;
            window.api.saveSettings(this.app.settings);
        });

        this.selVoiceMode?.addEventListener('change', () => this.onVoiceModeChange());

        this.selLang?.addEventListener('change', () => {
            if (!this.langKey) return;
            this.app.settings[this.langKey] = this.selLang.value;
            if (this.app.settings.engineSettings?.supertonic && this.engineId === 'supertonic') {
                this.app.settings.engineSettings.supertonic.lang = this.selLang.value;
            }
            if (this.app.settings.engineSettings?.qwen3 && this.engineId === 'qwen3') {
                this.app.settings.engineSettings.qwen3.lang = this.selLang.value;
            }
            if (this.app.settings.engineSettings?.spark && this.engineId === 'spark') {
                this.app.settings.engineSettings.spark.lang = this.selLang.value;
            }
            if (this.app.settings.engineSettings?.['gpt-sovits'] && this.engineId === 'gpt-sovits') {
                this.app.settings.engineSettings['gpt-sovits'].textLang = this.selLang.value;
            }
            window.api.saveSettings(this.app.settings);
            this.updateQwen3ViWarn();
            this.updateSparkViWarn();
            this.updateGptSovitsViWarn();
        });

        this.pane.querySelector('.sel-ref-lang')?.addEventListener('change', () => {
            if (this.engineId !== 'gpt-sovits') return;
            const v = this.pane.querySelector('.sel-ref-lang')?.value || 'zh';
            this.app.settings.gptSovitsRefLang = v;
            if (this.app.settings.engineSettings?.['gpt-sovits']) {
                this.app.settings.engineSettings['gpt-sovits'].refLang = v;
            }
            window.api.saveSettings(this.app.settings);
        });

        this.pane.querySelector('.sel-voice-profile')?.addEventListener('change', () => {
            if (this.engineId !== 'gpt-sovits') return;
            this.applyGptSovitsProfile(this.pane.querySelector('.sel-voice-profile')?.value);
        });

        this.pane.querySelector('.inp-instruct')?.addEventListener('change', () => {
            if (this.engineId !== 'qwen3') return;
            const v = this.pane.querySelector('.inp-instruct')?.value || '';
            this.app.settings.qwen3Instruct = v;
            if (this.app.settings.engineSettings?.qwen3) {
                this.app.settings.engineSettings.qwen3.instruct = v;
            }
            window.api.saveSettings(this.app.settings);
        });

        this.pane.querySelector('.inp-ref-text')?.addEventListener('change', () => {
            if (this.engineId === 'qwen3') {
                const v = this.pane.querySelector('.inp-ref-text')?.value || '';
                this.app.settings.qwen3RefText = v;
                if (this.app.settings.engineSettings?.qwen3) {
                    this.app.settings.engineSettings.qwen3.refText = v;
                }
                window.api.saveSettings(this.app.settings);
                return;
            }
            if (this.engineId === 'spark') {
                const v = this.pane.querySelector('.inp-ref-text')?.value || '';
                this.app.settings.sparkRefText = v;
                if (this.app.settings.engineSettings?.spark) {
                    this.app.settings.engineSettings.spark.refText = v;
                }
                window.api.saveSettings(this.app.settings);
                return;
            }
            if (this.engineId === 'gpt-sovits') {
                const v = this.pane.querySelector('.inp-ref-text')?.value || '';
                this.app.settings.gptSovitsRefText = v;
                if (this.app.settings.engineSettings?.['gpt-sovits']) {
                    this.app.settings.engineSettings['gpt-sovits'].refText = v;
                }
                window.api.saveSettings(this.app.settings);
            }
        });

        const saveSparkControl = (sel, flatKey, nestedKey) => {
            this.pane.querySelector(sel)?.addEventListener('change', () => {
                if (this.engineId !== 'spark') return;
                const v = this.pane.querySelector(sel)?.value || '';
                this.app.settings[flatKey] = v;
                if (this.app.settings.engineSettings?.spark) {
                    this.app.settings.engineSettings.spark[nestedKey] = v;
                }
                window.api.saveSettings(this.app.settings);
            });
        };
        saveSparkControl('.sel-gender', 'sparkGender', 'gender');
        saveSparkControl('.sel-pitch', 'sparkPitch', 'pitch');
        saveSparkControl('.sel-speed-level', 'sparkSpeedLevel', 'speedLevel');

        this.selVariant?.addEventListener('change', async () => {
            if (!this.variantKey) return;
            this.app.settings[this.variantKey] = this.selVariant.value;
            // Piper: variant id is the voice id. Chatterbox: do not overwrite ref path.
            if (this.voiceKey && this.engineId === 'piper') {
                this.app.settings[this.voiceKey] = this.selVariant.value;
            }
            const es = this.app.settings.engineSettings?.[this.engineId];
            if (es) {
                es.variant = this.selVariant.value;
                if (this.engineId === 'piper' && 'voice' in es) {
                    es.voice = this.selVariant.value;
                }
            }
            await window.api.saveSettings(this.app.settings);
            await this.updateVoiceLicenseHint();
            this.applyVariantProfileUi();
            this.applyQwen3VariantUi();
            await this.refreshCompatAdvice();
            await this.loadModel();
        });

        this.stepsRange?.addEventListener('input', () => this.updateStepsLabel());
        this.stepsRange?.addEventListener('change', () => {
            if (!this.stepsKey) return;
            const v = Number(this.stepsRange.value) || 8;
            this.app.settings[this.stepsKey] = v;
            if (this.app.settings.engineSettings?.supertonic) {
                this.app.settings.engineSettings.supertonic.steps = v;
            }
            window.api.saveSettings(this.app.settings);
        });

        this.speedRange?.addEventListener('input', () => this.updateSpeedLabel());
        this.speedRange?.addEventListener('change', () => {
            if (this.caps.languageSelect) {
                const v = Number(this.speedRange.value) || 1.05;
                this.app.settings.supertonicSpeed = v;
                if (this.app.settings.engineSettings?.supertonic) {
                    this.app.settings.engineSettings.supertonic.speed = v;
                }
                window.api.saveSettings(this.app.settings);
                return;
            }
            if (this.caps.modelVariantSelect && this.speedKey) {
                const v = Number(this.speedRange.value) || 1;
                this.app.settings[this.speedKey] = v;
                const es = this.app.settings.engineSettings?.[this.engineId];
                if (es) es.speed = v;
                window.api.saveSettings(this.app.settings);
            }
        });
        this.volumeRange?.addEventListener('input', () => this.updateVolumeLabel());
        this.pauseRange?.addEventListener('input', () => this.updatePauseLabel());
        this.edgeRateRange?.addEventListener('input', () => this.updateEdgeRateLabel());
        this.edgePitchRange?.addEventListener('input', () => this.updateEdgePitchLabel());
        this.edgeVolumeRange?.addEventListener('input', () => this.updateEdgeVolumeLabel());

        this.inpSearch?.addEventListener('input', () => {
            this.searchQuery = this.inpSearch.value.trim().toLowerCase();
            this.renderGrid();
        });

        this.selFilter?.addEventListener('change', () => {
            this.filterStatus = this.selFilter.value;
            this.renderGrid();
        });

        this.pane.querySelectorAll('.vb-grid th.sortable').forEach((th) => {
            th.addEventListener('click', () => this.toggleSort(th.dataset.sort, th));
        });

        this.gridWrap?.addEventListener('dragover', (e) => {
            e.preventDefault();
            this.gridWrap.classList.add('is-dragover');
        });
        this.gridWrap?.addEventListener('dragleave', () => this.gridWrap.classList.remove('is-dragover'));
        this.gridWrap?.addEventListener('drop', (e) => {
            e.preventDefault();
            this.gridWrap.classList.remove('is-dragover');
            this.handleFileDrop(e);
        });

        document.addEventListener('keydown', (e) => this.handleKeyboard(e));
    }

    handleKeyboard(e) {
        if (!this.isPaneActive()) return;
        const tag = e.target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
            if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); this.run(); }
            return;
        }
        if (e.key === 'Escape') this.stop();
        if (e.key === 'Delete') this.deleteSelected();
        if (e.key === 'a' && e.ctrlKey) {
            e.preventDefault();
            this.toggleAll(true);
        }
        if (e.key === 'Enter' && e.ctrlKey) this.run();
    }

    parseImportResult(result) {
        if (result?.error) return { error: result.error };
        const rows = Array.isArray(result) ? result : (result?.rows || []);
        return { rows };
    }

    logImportResult(rows, label) {
        rows.forEach((r) => this.addRow(r));
        this.log(`Import ${label}: ${rows.length} tác vụ.`);
        this.refreshContentLanguage({ notifySelector: true });
    }

    ensureContentLangUi() {
        if (this.pane.querySelector('.sel-content-lang')) return;
        const host = this.pane.querySelector('.vb-engine-now')
            || this.pane.querySelector('.vb-sticky-header .vb-header-row > div');
        if (!host) return;
        const wrap = document.createElement('div');
        wrap.className = 'vb-content-lang';
        wrap.innerHTML = `
          <label>Ngôn ngữ nội dung
            <select class="sel-content-lang" aria-label="Ngôn ngữ nội dung">
              <option value="auto">Tự động</option>
              <option value="vi">Tiếng Việt</option>
              <option value="en">English</option>
              <option value="zh">Chinese</option>
              <option value="ja">Japanese</option>
              <option value="ko">Korean</option>
              <option value="mixed">Hỗn hợp / Đa ngôn ngữ</option>
            </select>
          </label>
          <span class="vb-content-lang-hint" hidden></span>`;
        host.appendChild(wrap);
        const sel = wrap.querySelector('.sel-content-lang');
        sel.value = this.contentLanguageOverride || 'auto';
        sel.addEventListener('change', () => {
            this.contentLanguageOverride = sel.value || 'auto';
            this.syncContentLangHint();
            this.app.engineSelector?.onContentLanguage?.(
                this.getEffectiveContentLanguage(),
                { forceTab: false }
            );
        });
    }

    getEffectiveContentLanguage() {
        return resolveContentLanguage({
            override: this.contentLanguageOverride,
            detected: this.detectedLanguage,
        });
    }

    syncContentLangHint() {
        const hint = this.pane.querySelector('.vb-content-lang-hint');
        const sel = this.pane.querySelector('.sel-content-lang');
        if (sel && sel.value !== this.contentLanguageOverride) {
            sel.value = this.contentLanguageOverride || 'auto';
        }
        if (!hint) return;
        const eff = this.getEffectiveContentLanguage();
        if (!this.jobs.some((j) => String(j.text || '').trim())) {
            hint.hidden = true;
            hint.textContent = '';
            return;
        }
        if (eff.source === 'user') {
            hint.hidden = false;
            hint.textContent = `Đang dùng: ${LANG_LABEL[eff.language] || eff.language} (do bạn chọn)`;
            return;
        }
        if (eff.language === LANG.UNKNOWN) {
            hint.hidden = false;
            hint.textContent = 'Tự động: chưa xác định (text ngắn / ít tín hiệu)';
            return;
        }
        const conf = eff.confidence != null
            ? ` · độ tin cậy ${(eff.confidence * 100).toFixed(0)}%`
            : '';
        hint.hidden = false;
        hint.textContent = `Tự động: ${LANG_LABEL[eff.language] || eff.language}${conf}`;
    }

    refreshContentLanguage({ notifySelector = false } = {}) {
        if (this.app.settings?.languageDetectionEnabled === false) {
            this.detectedLanguage = null;
            this.syncContentLangHint();
            return;
        }
        clearTimeout(this._langDetectTimer);
        this._langDetectTimer = setTimeout(() => {
            this._runContentLanguageDetect({ notifySelector });
        }, 40);
    }

    _runContentLanguageDetect({ notifySelector = false } = {}) {
        const hasText = this.jobs.some((j) => String(j.text || '').trim());
        if (!hasText) {
            this.detectedLanguage = null;
            this.syncContentLangHint();
            return;
        }
        this.detectedLanguage = detectJobsLanguage(this.jobs);
        this.syncContentLangHint();
        if (notifySelector) {
            this.app.engineSelector?.onContentLanguage?.(
                this.getEffectiveContentLanguage(),
                { forceTab: false }
            );
        }
    }

    isLangWarnSuppressed(engineId) {
        return this._suppressLangWarnEngines.has(String(engineId || ''));
    }

    suppressLangWarnFor(engineId) {
        if (engineId) this._suppressLangWarnEngines.add(String(engineId));
    }

    async ensureLanguageGate({ preferClone = false } = {}) {
        return gateLanguageBeforeAction(this.app, this, { preferClone });
    }

    async handleFileDrop(e) {
        if (!this.isPaneActive()) return;
        const files = [...(e.dataTransfer?.files || [])].filter((f) => f.name.endsWith('.txt'));
        if (!files.length) return;
        const paths = files.map((f) => f.path).filter(Boolean);
        if (paths.length) {
            const { error, rows } = this.parseImportResult(await window.api.importTxt(paths));
            if (error) return alert(error);
            this.logImportResult(rows, 'kéo-thả TXT');
        }
    }

    updateSpeedLabel() {
        const v = Number(this.speedRange?.value) || 1;
        if (this.speedVal) this.speedVal.textContent = `${v.toFixed(2)}×`;
    }

    updateStepsLabel() {
        const v = Number(this.stepsRange?.value) || 8;
        if (this.stepsVal) this.stepsVal.textContent = String(v);
    }

    populateLangSelect() {
        if (!this.selLang || !this.caps.languageSelect) return;
        const langs = this.meta.languages || [
            { id: 'vi', label: 'Tiếng Việt (vi)' },
            { id: 'en', label: 'English (en)' },
            { id: 'na', label: 'Fallback (na)' },
        ];
        this.selLang.innerHTML = langs.map((l) =>
            `<option value="${escHtml(l.id)}">${escHtml(l.label)}</option>`).join('');
        const key = this.langKey;
        if (key) {
            const fallback = this.engineId === 'qwen3' ? 'Auto'
            : this.engineId === 'spark' ? 'Chinese'
            : this.engineId === 'gpt-sovits' ? 'zh'
                : 'vi';
            this.selLang.value = this.app.settings[key] || fallback;
        }
        this.updateQwen3ViWarn();
        this.updateSparkViWarn();
        this.updateGptSovitsViWarn();
    }

    async populateVariantSelect() {
        if (!this.selVariant || !this.caps.modelVariantSelect) return;
        let variants = this.meta.variants;
        if ((!variants || !variants.length) && this.meta.catalogDriven && window.api?.piperListCatalog) {
            try {
                const cat = await window.api.piperListCatalog();
                variants = (cat?.voices || []).map((v) => ({
                    id: v.id,
                    label: v.language
                        ? `${v.id} · ${v.language}`
                        : v.label || v.id,
                }));
            } catch (_) {
                variants = [{ id: 'en_US-lessac-medium', label: 'en_US-lessac-medium' }];
            }
        }
        if (!variants?.length) {
            variants = [
                { id: 'mini', label: 'Mini' },
                { id: 'micro', label: 'Micro' },
                { id: 'nano', label: 'Nano' },
                { id: 'nano-int8', label: 'Nano INT8' },
            ];
        }
        this.selVariant.innerHTML = variants.map((v) =>
            `<option value="${escHtml(v.id)}">${escHtml(v.label)}</option>`).join('');
        const key = this.variantKey;
        const defaultVariant = this.meta.variants?.[0]?.id
            || (this.engineId === 'piper' ? 'en_US-lessac-medium' : null)
            || variants[0]?.id
            || 'mini';
        if (key) {
            this.selVariant.value = this.app.settings[key] || defaultVariant;
        }
        await this.updateVoiceLicenseHint();
    }

    async updateVoiceLicenseHint() {
        const hint = this.pane.querySelector('.voice-license-hint');
        if (!hint) return;
        if (this.engineId !== 'piper' || !this.selVariant?.value) {
            hint.hidden = true;
            hint.textContent = '';
            return;
        }
        try {
            const res = await window.api?.piperVoiceLicense?.(this.selVariant.value);
            const lic = res?.license;
            if (lic) {
                hint.hidden = false;
                hint.textContent = `License voice: ${lic}`;
            } else {
                hint.hidden = false;
                hint.textContent = 'License voice: xem MODEL_CARD sau khi cài';
            }
        } catch (_) {
            hint.hidden = true;
        }
    }

    async installSelectedVariant() {
        const variant = this.selVariant?.value
            || (this.variantKey && this.app.settings[this.variantKey])
            || this.meta.variants?.[0]?.id
            || (this.engineId === 'piper' ? 'en_US-lessac-medium'
                : this.engineId === 'chatterbox' ? 'nano'
                    : this.engineId === 'qwen3' ? '0.6b-custom'
                        : 'mini');
        const btn = this.pane.querySelector('.btn-install-variant');
        if (btn) {
            btn.disabled = true;
            btn.textContent = 'Đang cài…';
        }
        try {
            if (this.engineId === 'piper') {
                const warn = this.meta.licenseInstallWarning
                    || 'Thành phần này sử dụng giấy phép riêng. Hãy xem thông tin giấy phép trước khi cài.';
                if (!confirm(`${warn}\n\nEngine: GPLv3 (OHF-Voice). Voice: xem MODEL_CARD.\nTiếp tục cài runtime + voice «${variant}»?`)) {
                    return;
                }
                const rt = await window.api?.piperInstallRuntime?.();
                if (rt?.error) {
                    alert(rt.error);
                    this.log(rt.error, 'error');
                    return;
                }
            }
            let res;
            if (this.engineId === 'chatterbox' || this.meta?.family === 'chatterbox') {
                res = await window.api?.chatterboxInstallOptional?.(variant);
            } else if (this.engineId === 'qwen3' || this.meta?.family === 'qwen3') {
                res = await window.api?.qwen3InstallOptional?.(variant);
            } else if (this.engineId === 'spark' || this.meta?.family === 'spark') {
                res = await window.api?.sparkInstallOptional?.();
            } else if (this.engineId === 'gpt-sovits' || this.meta?.family === 'gpt-sovits') {
                res = await window.api?.gptSovitsInstallOptional?.();
            } else {
                res = await window.api?.modelInstall?.(this.engineId, variant);
            }
            if (res?.error) {
                alert(res.error);
                this.log(res.error, 'error');
            } else {
                this.log(`Đã cài ${this.meta.displayName || this.engineId} variant: ${variant}`, 'success');
                await window.api?.saveSettings?.(this.app.settings);
                await this.app.engineSelector?.refresh?.();
                await this.updateVoiceLicenseHint();
                await this.loadModel();
            }
        } catch (e) {
            alert(e.message || String(e));
            this.log(e.message, 'error');
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.textContent = 'Cài variant';
            }
        }
    }

    applyVariantProfileUi() {
        const v = this.selVariant?.value || this.meta?.modelVariant || 'nano';
        const profile = this.meta?.variantProfiles?.[v];
        const sub = this.pane.querySelector('.engine-now-sub');
        if (sub && profile?.subtitle) sub.textContent = profile.subtitle;
    }

    applyQwen3VariantUi() {
        if (this.engineId !== 'qwen3') return;
        const v = this.selVariant?.value
            || (this.variantKey && this.app.settings[this.variantKey])
            || '0.6b-custom';
        const isBase = v === '0.6b-base';
        this.pane.querySelectorAll('.qwen3-custom-only').forEach((el) => {
            el.hidden = isBase;
        });
        this.pane.querySelectorAll('.qwen3-base-only').forEach((el) => {
            el.hidden = !isBase;
        });
        this.updateQwen3ViWarn();
    }

    updateQwen3ViWarn() {
        const el = this.pane.querySelector('.qwen3-vi-warn');
        if (!el) return;
        if (this.engineId !== 'qwen3') {
            el.hidden = true;
            el.textContent = '';
            return;
        }
        const lang = this.selLang?.value || this.app.settings.qwen3Lang || 'Auto';
        const msg = this.meta?.viWarn
            || 'Model này không hỗ trợ tiếng Việt chính thức. Khepree khuyên dùng VieNeu hoặc Supertonic.';
        if (lang === 'Vietnamese') {
            el.hidden = false;
            el.textContent = `${msg} (override: Unsupported — thử nghiệm)`;
            return;
        }
        el.hidden = true;
        el.textContent = '';
    }

    async refreshCompatAdvice() {
        const el = this.pane.querySelector('.engine-now-compat');
        if (!el || !window.api?.adviseEngine) return;
        try {
            const variant = this.selVariant?.value
                || (this.variantKey && this.app.settings[this.variantKey])
                || this.meta?.modelVariant;
            const res = await window.api.adviseEngine(this.engineId, variant);
            if (res?.ok && res.message) {
                el.hidden = false;
                el.textContent = `${res.level}: ${res.message}`;
            }
        } catch (_) { /* */ }
    }

    async pickRefWav() {
        const inp = this.pane.querySelector('.inp-ref-wav');
        if (!inp) return;
        try {
            const files = await window.api?.selectFiles?.([
                { name: 'Audio', extensions: ['wav', 'mp3', 'flac', 'ogg', 'm4a'] },
            ]);
            const p = Array.isArray(files) ? files[0] : files;
            if (!p) return;
            if (/^https?:\/\//i.test(String(p))) {
                alert('Reference audio chỉ chấp nhận file local — không URL.');
                return;
            }
            inp.value = p;
            const refKey = this.settingsKey.ref || this.voiceKey || 'chatterboxRef';
            this.app.settings[refKey] = p;
            this.app.settings.chatterboxRef = p;
            this.app.settings.chatterboxNanoRef = p;
            if (this.engineId === 'qwen3') {
                this.app.settings.qwen3Ref = p;
                if (this.app.settings.engineSettings?.qwen3) {
                    this.app.settings.engineSettings.qwen3.ref = p;
                }
            }
            if (this.engineId === 'spark') {
                this.app.settings.sparkRef = p;
                if (this.app.settings.engineSettings?.spark) {
                    this.app.settings.engineSettings.spark.ref = p;
                }
            }
            if (this.engineId === 'gpt-sovits') {
                this.app.settings.gptSovitsRef = p;
                if (this.app.settings.engineSettings?.['gpt-sovits']) {
                    this.app.settings.engineSettings['gpt-sovits'].ref = p;
                }
            }
            if (this.app.settings.engineSettings?.chatterbox) {
                this.app.settings.engineSettings.chatterbox.ref = p;
            }
            await window.api?.saveSettings?.(this.app.settings);
        } catch (e) {
            this.log(e.message || String(e), 'error');
        }
    }

    async pickGptCkpt() {
        if (this.engineId !== 'gpt-sovits') return;
        const inp = this.pane.querySelector('.inp-gpt-ckpt');
        if (!inp) return;
        try {
            const files = await window.api?.selectFiles?.([
                { name: 'GPT checkpoint', extensions: ['ckpt', 'pt', 'pth', 'safetensors'] },
            ]);
            const p = Array.isArray(files) ? files[0] : files;
            if (!p) return;
            inp.value = p;
            this.app.settings.gptSovitsGptCkpt = p;
            if (this.app.settings.engineSettings?.['gpt-sovits']) {
                this.app.settings.engineSettings['gpt-sovits'].gptCkpt = p;
            }
            await window.api?.saveSettings?.(this.app.settings);
            this.log(`GPT checkpoint: ${p}`);
        } catch (e) {
            this.log(e.message || String(e), 'error');
        }
    }

    async pickSovitsCkpt() {
        if (this.engineId !== 'gpt-sovits') return;
        const inp = this.pane.querySelector('.inp-sovits-ckpt');
        if (!inp) return;
        try {
            const files = await window.api?.selectFiles?.([
                { name: 'SoVITS checkpoint', extensions: ['pth', 'pt', 'ckpt', 'safetensors'] },
            ]);
            const p = Array.isArray(files) ? files[0] : files;
            if (!p) return;
            inp.value = p;
            this.app.settings.gptSovitsSovitsCkpt = p;
            if (this.app.settings.engineSettings?.['gpt-sovits']) {
                this.app.settings.engineSettings['gpt-sovits'].sovitsCkpt = p;
            }
            await window.api?.saveSettings?.(this.app.settings);
            this.log(`SoVITS checkpoint: ${p}`);
        } catch (e) {
            this.log(e.message || String(e), 'error');
        }
    }

    async refreshGptSovitsProfiles() {
        if (this.engineId !== 'gpt-sovits') return;
        const sel = this.pane.querySelector('.sel-voice-profile');
        if (!sel) return;
        let profiles = [];
        try {
            const res = await window.api?.gptSovitsListProfiles?.();
            profiles = res?.profiles || [];
        } catch (_) { /* */ }
        const cur = this.app.settings.gptSovitsProfile || '';
        sel.innerHTML = `<option value="">— Manual —</option>${
            profiles.map((p) =>
                `<option value="${escHtml(p.id)}">${escHtml(p.name)}</option>`).join('')
        }`;
        if (cur && profiles.some((p) => p.id === cur)) sel.value = cur;
    }

    async applyGptSovitsProfile(profileId) {
        if (this.engineId !== 'gpt-sovits') return;
        this.app.settings.gptSovitsProfile = profileId || '';
        if (this.app.settings.engineSettings?.['gpt-sovits']) {
            this.app.settings.engineSettings['gpt-sovits'].profile = profileId || '';
        }
        if (!profileId) {
            await window.api?.saveSettings?.(this.app.settings);
            return;
        }
        try {
            const res = await window.api?.gptSovitsListProfiles?.();
            const profile = (res?.profiles || []).find((p) => p.id === profileId);
            if (!profile) return;
            const set = (sel, val) => {
                const el = this.pane.querySelector(sel);
                if (el) el.value = val || '';
            };
            set('.inp-ref-wav', profile.refAudio);
            set('.inp-ref-text', profile.refText);
            set('.sel-ref-lang', profile.refLang);
            set('.sel-lang', profile.targetLang);
            set('.inp-gpt-ckpt', profile.gptCheckpoint);
            set('.inp-sovits-ckpt', profile.sovitsCheckpoint);
            this.app.settings.gptSovitsRef = profile.refAudio || '';
            this.app.settings.gptSovitsRefText = profile.refText || '';
            this.app.settings.gptSovitsRefLang = profile.refLang || 'zh';
            this.app.settings.gptSovitsTextLang = profile.targetLang || 'zh';
            this.app.settings.gptSovitsGptCkpt = profile.gptCheckpoint || '';
            this.app.settings.gptSovitsSovitsCkpt = profile.sovitsCheckpoint || '';
            const bucket = this.app.settings.engineSettings?.['gpt-sovits'];
            if (bucket) {
                bucket.ref = this.app.settings.gptSovitsRef;
                bucket.refText = this.app.settings.gptSovitsRefText;
                bucket.refLang = this.app.settings.gptSovitsRefLang;
                bucket.textLang = this.app.settings.gptSovitsTextLang;
                bucket.gptCkpt = this.app.settings.gptSovitsGptCkpt;
                bucket.sovitsCkpt = this.app.settings.gptSovitsSovitsCkpt;
            }
            await window.api?.saveSettings?.(this.app.settings);
            this.updateGptSovitsViWarn();
            this.log(`Voice profile: ${profile.name}`);
        } catch (e) {
            alert(e.message || String(e));
        }
    }

    async saveGptSovitsProfile() {
        if (this.engineId !== 'gpt-sovits') return;
        const name = this.pane.querySelector('.inp-profile-name')?.value?.trim() || '';
        const ack = Boolean(this.pane.querySelector('.chk-voice-ack')?.checked);
        const ackText = this.meta?.voiceProfileAck
            || 'Tôi có quyền sử dụng giọng/reference audio này.';
        if (!ack) {
            alert(`Cần xác nhận: "${ackText}"`);
            return;
        }
        const payload = {
            name,
            acknowledgement: true,
            refAudio: this.pane.querySelector('.inp-ref-wav')?.value || '',
            refText: this.pane.querySelector('.inp-ref-text')?.value || '',
            refLang: this.pane.querySelector('.sel-ref-lang')?.value || 'zh',
            targetLang: this.selLang?.value || 'zh',
            gptCheckpoint: this.pane.querySelector('.inp-gpt-ckpt')?.value || '',
            sovitsCheckpoint: this.pane.querySelector('.inp-sovits-ckpt')?.value || '',
        };
        try {
            const res = await window.api?.gptSovitsCreateProfile?.(payload);
            if (!res?.ok) {
                alert(res?.error || 'Không lưu được voice profile');
                return;
            }
            const ackEl = this.pane.querySelector('.chk-voice-ack');
            if (ackEl) ackEl.checked = false;
            const nameEl = this.pane.querySelector('.inp-profile-name');
            if (nameEl) nameEl.value = '';
            await this.refreshGptSovitsProfiles();
            const sel = this.pane.querySelector('.sel-voice-profile');
            if (sel && res.profile?.id) {
                sel.value = res.profile.id;
                await this.applyGptSovitsProfile(res.profile.id);
            }
            this.log(`Đã lưu voice profile: ${res.profile?.name}`);
        } catch (e) {
            alert(e.message || String(e));
        }
    }

    updateGptSovitsViWarn() {
        const el = this.pane.querySelector('.gpt-sovits-vi-warn');
        if (!el) return;
        if (this.engineId !== 'gpt-sovits') {
            el.hidden = true;
            el.textContent = '';
            return;
        }
        const lang = this.selLang?.value || this.app.settings.gptSovitsTextLang || 'zh';
        const msg = this.meta?.viWarn
            || 'GPT-SoVITS không quảng cáo tiếng Việt chính thức. Khepree khuyên dùng VieNeu.';
        if (lang === 'vi' || lang === 'vietnamese') {
            el.hidden = false;
            el.textContent = `${msg} (override: Unsupported — thử nghiệm)`;
            return;
        }
        el.hidden = true;
        el.textContent = '';
    }

    async populateExpressionTags() {
        const host = this.pane.querySelector('.expression-tag-helper');
        if (!host || !this.caps.expressionTags) return;
        let eventTags = [];
        let allTags = [];
        try {
            const res = await window.api?.chatterboxListTags?.();
            eventTags = res?.eventTags || [];
            allTags = res?.allTags || [];
        } catch (_) { /* */ }
        const primary = eventTags.length ? eventTags : allTags.slice(0, 9);
        const rest = allTags.filter((t) => !primary.includes(t));
        host.innerHTML = '';
        const addBtn = (tag) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'vb-btn vb-btn-ghost vb-btn-sm expression-tag-btn';
            b.textContent = tag;
            b.title = `Chèn ${tag} vào dòng đang chọn / ô văn bản`;
            b.addEventListener('click', () => this.insertExpressionTag(tag));
            host.appendChild(b);
        };
        primary.forEach(addBtn);
        rest.forEach(addBtn);
    }

    insertExpressionTag(tag) {
        const activeTa = this.pane.querySelector('.cell-text:focus');
        if (activeTa) {
            const start = activeTa.selectionStart ?? activeTa.value.length;
            const end = activeTa.selectionEnd ?? start;
            const v = activeTa.value;
            activeTa.value = `${v.slice(0, start)}${tag}${v.slice(end)}`;
            activeTa.dispatchEvent(new Event('input', { bubbles: true }));
            activeTa.focus();
            return;
        }
        const selected = this.jobs.find((j) => j.checked);
        if (selected) {
            selected.text = `${selected.text || ''} ${tag}`.trim();
            this.renderGrid();
            this.saveJobs?.();
            return;
        }
        try {
            navigator.clipboard?.writeText(tag);
            this.log(`Đã copy ${tag} (chọn dòng hoặc focus ô văn bản để chèn)`, 'info');
        } catch (_) {
            this.log(`Tag: ${tag}`, 'info');
        }
    }

    updateVolumeLabel() {
        const v = Number(this.volumeRange?.value) || 100;
        this.volume = v / 100;
        if (this.volumeVal) this.volumeVal.textContent = `${v}%`;
    }

    updatePauseLabel() {
        const v = Number(this.pauseRange?.value) || 100;
        this.pauseScale = v / 100;
        if (this.pauseVal) this.pauseVal.textContent = `${v}%`;
    }

    updateEdgeRateLabel() {
        const v = Number(this.edgeRateRange?.value) || 0;
        if (this.edgeRateVal) this.edgeRateVal.textContent = `${v >= 0 ? '+' : ''}${v}%`;
    }

    updateEdgePitchLabel() {
        const v = Number(this.edgePitchRange?.value) || 0;
        if (this.edgePitchVal) this.edgePitchVal.textContent = `${v >= 0 ? '+' : ''}${v}Hz`;
    }

    updateEdgeVolumeLabel() {
        const v = Number(this.edgeVolumeRange?.value) || 0;
        if (this.edgeVolumeVal) this.edgeVolumeVal.textContent = `${v >= 0 ? '+' : ''}${v}%`;
    }

    populateVoiceModeSelect() {
        if (!this.selVoiceMode || !this.caps.voiceMode) return;
        const modes = this.meta.voiceModes || [];
        this.selVoiceMode.innerHTML = modes.map((m) =>
            `<option value="${escHtml(m.id)}">${escHtml(m.label)}</option>`).join('');
        const key = this.voiceModeKey;
        if (key) {
            this.selVoiceMode.value = this.app.settings[key] || modes[0]?.id || '';
        }
    }

    async onVoiceModeChange() {
        if (!this.selVoiceMode || !this.voiceModeKey) return;
        this.app.settings[this.voiceModeKey] = this.selVoiceMode.value;
        if (this.engineId === 'spark' && this.app.settings.engineSettings?.spark) {
            this.app.settings.engineSettings.spark.mode = this.selVoiceMode.value;
        }
        await window.api.saveSettings(this.app.settings);
        if (this.engineId === 'spark') {
            this.applySparkModeUi();
            return;
        }
        await this.loadModel();
    }

    applySparkModeUi() {
        if (this.engineId !== 'spark') return;
        const mode = this.selVoiceMode?.value
            || this.app.settings.sparkMode
            || 'clone';
        const isCreate = mode === 'create';
        this.pane.querySelectorAll('.spark-clone-only').forEach((el) => {
            el.hidden = isCreate;
        });
        this.pane.querySelectorAll('.spark-create-only').forEach((el) => {
            el.hidden = !isCreate;
        });
        this.updateSparkViWarn();
    }

    updateSparkViWarn() {
        const el = this.pane.querySelector('.spark-vi-warn');
        if (!el) return;
        if (this.engineId !== 'spark') {
            el.hidden = true;
            el.textContent = '';
            return;
        }
        const lang = this.selLang?.value || this.app.settings.sparkLang || 'Chinese';
        const msg = this.meta?.viWarn
            || 'Model này không hỗ trợ tiếng Việt chính thức. Khepree khuyên dùng VieNeu hoặc Supertonic.';
        if (lang === 'Vietnamese') {
            el.hidden = false;
            el.textContent = `${msg} (override: Unsupported — thử nghiệm)`;
            return;
        }
        el.hidden = true;
        el.textContent = '';
    }

    syncFromSettings() {
        const s = this.app.settings;
        if (this.engineId === 'spark') {
            this.populateVoiceModeSelect?.();
            if (this.selVoiceMode) {
                this.selVoiceMode.value = s.sparkMode || 'clone';
            }
            this.populateLangSelect();
            if (this.selLang) this.selLang.value = s.sparkLang || 'Chinese';
            const refInp = this.pane.querySelector('.inp-ref-wav');
            if (refInp) refInp.value = s.sparkRef || '';
            const refText = this.pane.querySelector('.inp-ref-text');
            if (refText) refText.value = s.sparkRefText || '';
            const gender = this.pane.querySelector('.sel-gender');
            if (gender) {
                gender.innerHTML = (this.meta.genders || []).map((g) =>
                    `<option value="${escHtml(g.id)}">${escHtml(g.label)}</option>`).join('');
                gender.value = s.sparkGender || 'male';
            }
            const pitch = this.pane.querySelector('.sel-pitch');
            const speed = this.pane.querySelector('.sel-speed-level');
            const levels = this.meta.levels || [];
            if (pitch) {
                pitch.innerHTML = levels.map((l) =>
                    `<option value="${escHtml(l.id)}">${escHtml(l.label)}</option>`).join('');
                pitch.value = s.sparkPitch || 'moderate';
            }
            if (speed) {
                speed.innerHTML = levels.map((l) =>
                    `<option value="${escHtml(l.id)}">${escHtml(l.label)}</option>`).join('');
                speed.value = s.sparkSpeedLevel || 'moderate';
            }
            this.applySparkModeUi();
            void this.refreshCompatAdvice();
            return;
        }
        if (this.engineId === 'gpt-sovits') {
            this.populateLangSelect();
            if (this.selLang) this.selLang.value = s.gptSovitsTextLang || 'zh';
            const refLang = this.pane.querySelector('.sel-ref-lang');
            if (refLang) {
                const langs = this.meta.languages || [];
                refLang.innerHTML = langs.map((l) =>
                    `<option value="${escHtml(l.id)}">${escHtml(l.label)}</option>`).join('');
                refLang.value = s.gptSovitsRefLang || 'zh';
            }
            const refInp = this.pane.querySelector('.inp-ref-wav');
            if (refInp) refInp.value = s.gptSovitsRef || '';
            const refText = this.pane.querySelector('.inp-ref-text');
            if (refText) refText.value = s.gptSovitsRefText || '';
            const gptCkpt = this.pane.querySelector('.inp-gpt-ckpt');
            if (gptCkpt) gptCkpt.value = s.gptSovitsGptCkpt || '';
            const sovitsCkpt = this.pane.querySelector('.inp-sovits-ckpt');
            if (sovitsCkpt) sovitsCkpt.value = s.gptSovitsSovitsCkpt || '';
            void this.refreshGptSovitsProfiles();
            this.updateGptSovitsViWarn();
            void this.refreshCompatAdvice();
            return;
        }
        if ((this.caps.voiceMode || this.caps.edgeRate) && this.engineId !== 'spark') {
            if (this.selVoiceMode && this.voiceModeKey) {
                this.selVoiceMode.value = s[this.voiceModeKey] || this.meta.voiceModes?.[0]?.id || '';
            }
            if (this.edgeRateRange && this.rateKey) {
                this.edgeRateRange.value = s[this.rateKey] ?? 0;
                this.updateEdgeRateLabel();
            }
            if (this.edgePitchRange && this.pitchKey) {
                this.edgePitchRange.value = s[this.pitchKey] ?? 0;
                this.updateEdgePitchLabel();
            }
            if (this.edgeVolumeRange && this.volumeKey) {
                this.edgeVolumeRange.value = s[this.volumeKey] ?? 0;
                this.updateEdgeVolumeLabel();
            }
            this.applyPreferredVoice(s[this.voiceKey]);
            return;
        }
        if (this.caps.languageSelect && this.engineId !== 'qwen3') {
            this.populateLangSelect();
            if (this.selLang && this.langKey) {
                this.selLang.value = s[this.langKey] || 'vi';
            }
            if (this.stepsRange && this.stepsKey) {
                this.stepsRange.value = s[this.stepsKey] ?? 8;
                this.updateStepsLabel();
            }
            if (this.caps.speed && this.speedRange) {
                this.speedRange.value = s.supertonicSpeed ?? s.speed ?? 1.05;
                this.updateSpeedLabel();
            }
            this.applyPreferredVoice(s[this.voiceKey] || 'M1');
            return;
        }
        if (this.caps.modelVariantSelect) {
            void this.populateVariantSelect().then(() => {
                const defaultVariant = this.meta.variants?.[0]?.id || 'mini';
                if (this.selVariant && this.variantKey) {
                    this.selVariant.value = s[this.variantKey] || defaultVariant;
                }
                if (this.caps.languageSelect) this.populateLangSelect();
                if (this.caps.speed && this.speedRange) {
                    const speedVal = this.speedKey ? s[this.speedKey] : 1;
                    this.speedRange.value = speedVal ?? 1;
                    this.updateSpeedLabel();
                }
                if (this.engineId === 'qwen3') {
                    const instruct = this.pane.querySelector('.inp-instruct');
                    if (instruct) instruct.value = s.qwen3Instruct || '';
                    const refText = this.pane.querySelector('.inp-ref-text');
                    if (refText) refText.value = s.qwen3RefText || '';
                    const refInp = this.pane.querySelector('.inp-ref-wav');
                    if (refInp) refInp.value = s.qwen3Ref || '';
                    if (this.meta.speakers?.length && this.selVoice) {
                        this.selVoice.innerHTML = this.meta.speakers.map((sp) =>
                            `<option value="${escHtml(sp.id)}">${escHtml(sp.label)}</option>`).join('');
                    }
                    this.applyPreferredVoice(s.qwen3Voice || 'Vivian');
                    this.applyQwen3VariantUi();
                } else if (this.caps.expressionTags || this.caps.voiceClone) {
                    void this.populateExpressionTags();
                    const refInp = this.pane.querySelector('.inp-ref-wav');
                    const refKey = this.settingsKey.ref || 'chatterboxRef';
                    if (refInp) {
                        refInp.value = s[refKey] || s.chatterboxRef || s.chatterboxNanoRef || '';
                    }
                    this.applyPreferredVoice(s[this.voiceKey]);
                } else {
                    this.applyPreferredVoice(s[this.voiceKey]);
                }
                this.applyVariantProfileUi();
                void this.refreshCompatAdvice();
            });
            return;
        }
        if (this.caps.expressionTags || this.caps.voiceClone) {
            void this.populateExpressionTags();
            const refInp = this.pane.querySelector('.inp-ref-wav');
            if (refInp) {
                refInp.value = s.chatterboxRef || s.chatterboxNanoRef || '';
            }
            this.applyPreferredVoice(s[this.voiceKey] || 'default');
            return;
        }
        if (this.caps.speed && this.speedRange) {
            this.speedRange.value = s.speed ?? 1;
            this.updateSpeedLabel();
        }
        this.applyPreferredVoice(s[this.voiceKey]);
        this.syncSlidersFromSettings();
    }

    applyPreferredVoice(preferredVoice) {
        if (!this.selVoice || !preferredVoice) return;
        for (const opt of this.selVoice.options) {
            if (opt.value === preferredVoice) {
                this.selVoice.value = preferredVoice;
                break;
            }
        }
    }

    syncSlidersFromSettings() {
        if (this.caps.volume && this.volumeRange) {
            this.volumeRange.value = Math.round((this.app.settings.volume ?? 1) * 100);
            this.updateVolumeLabel();
        }
        if (this.caps.pauseScale && this.pauseRange) {
            this.pauseRange.value = Math.round((this.app.settings.pauseScale ?? 1) * 100);
            this.updatePauseLabel();
        }
    }

    getSynthOverrides() {
        const s = this.app.settings;
        if (this.caps.edgeRate) {
            return {
                edgeVoiceMode: this.selVoiceMode?.value
                    || (this.voiceModeKey ? s[this.voiceModeKey] : undefined),
                edgeRate: Number(this.edgeRateRange?.value ?? (this.rateKey ? s[this.rateKey] : 0) ?? 0),
                edgePitch: Number(this.edgePitchRange?.value ?? (this.pitchKey ? s[this.pitchKey] : 0) ?? 0),
                edgeVolume: Number(this.edgeVolumeRange?.value ?? (this.volumeKey ? s[this.volumeKey] : 0) ?? 0),
                useSeaG2p: s.useSeaG2p !== false,
                stripHash: s.stripHash !== false,
            };
        }
        if (this.caps.languageSelect && this.engineId !== 'qwen3'
            && this.engineId !== 'spark' && this.engineId !== 'gpt-sovits') {
            const speed = Number(this.speedRange?.value) || s.supertonicSpeed || 1.05;
            const steps = Number(this.stepsRange?.value) || s.supertonicSteps || 8;
            return {
                lang: this.selLang?.value || s.supertonicLang || 'vi',
                speed,
                total_steps: steps,
                silence_duration: 0.3,
            };
        }
        if (this.engineId === 'qwen3') {
            const variant = this.selVariant?.value || s.qwen3Variant || '0.6b-custom';
            const language = this.selLang?.value || s.qwen3Lang || 'Auto';
            return {
                variant,
                language,
                speaker: this.selVoice?.value || s.qwen3Voice || 'Vivian',
                instruct: this.pane.querySelector('.inp-instruct')?.value || s.qwen3Instruct || '',
                ref_audio: this.pane.querySelector('.inp-ref-wav')?.value || s.qwen3Ref || '',
                ref_text: this.pane.querySelector('.inp-ref-text')?.value || s.qwen3RefText || '',
                allow_unsupported_lang: language === 'Vietnamese',
            };
        }
        if (this.engineId === 'spark') {
            const language = this.selLang?.value || s.sparkLang || 'Chinese';
            return {
                spark_mode: this.selVoiceMode?.value || s.sparkMode || 'clone',
                language,
                gender: this.pane.querySelector('.sel-gender')?.value || s.sparkGender || 'male',
                pitch: this.pane.querySelector('.sel-pitch')?.value || s.sparkPitch || 'moderate',
                speed: this.pane.querySelector('.sel-speed-level')?.value || s.sparkSpeedLevel || 'moderate',
                ref_audio: this.pane.querySelector('.inp-ref-wav')?.value || s.sparkRef || '',
                prompt_text: this.pane.querySelector('.inp-ref-text')?.value || s.sparkRefText || '',
                allow_unsupported_lang: language === 'Vietnamese',
            };
        }
        if (this.engineId === 'gpt-sovits') {
            const textLang = this.selLang?.value || s.gptSovitsTextLang || 'zh';
            const promptLang = this.pane.querySelector('.sel-ref-lang')?.value
                || s.gptSovitsRefLang
                || textLang;
            return {
                text_lang: textLang,
                prompt_lang: promptLang,
                language: textLang,
                ref_audio: this.pane.querySelector('.inp-ref-wav')?.value || s.gptSovitsRef || '',
                prompt_text: this.pane.querySelector('.inp-ref-text')?.value || s.gptSovitsRefText || '',
                gpt_weights: this.pane.querySelector('.inp-gpt-ckpt')?.value || s.gptSovitsGptCkpt || '',
                sovits_weights: this.pane.querySelector('.inp-sovits-ckpt')?.value || s.gptSovitsSovitsCkpt || '',
                allow_unsupported_lang: textLang === 'vi' || textLang === 'vietnamese',
            };
        }
        if (this.caps.modelVariantSelect) {
            const defaultVariant = this.meta.variants?.[0]?.id || 'mini';
            const out = {
                variant: this.selVariant?.value || (this.variantKey && s[this.variantKey]) || defaultVariant,
                speed: Number(this.speedRange?.value)
                    || (this.speedKey && s[this.speedKey])
                    || 1,
                clean_text: true,
            };
            if (this.caps.voiceClone || this.caps.expressionTags) {
                const ref = this.pane.querySelector('.inp-ref-wav')?.value
                    || s.chatterboxRef
                    || s.chatterboxNanoRef
                    || '';
                out.audio_prompt_path = ref || null;
                out.norm_loudness = true;
                delete out.speed;
                delete out.clean_text;
            }
            return out;
        }
        if (this.caps.voiceClone || this.caps.expressionTags) {
            const ref = this.pane.querySelector('.inp-ref-wav')?.value
                || s.chatterboxRef
                || s.chatterboxNanoRef
                || '';
            return {
                audio_prompt_path: ref || null,
                norm_loudness: true,
            };
        }
        const speed = Number(this.speedRange?.value) || s.speed || 1;
        const scale = this.pauseScale || 1;
        return {
            speed,
            volume: this.volume || 1,
            useSeaG2p: s.useSeaG2p !== false,
            silenceLinePunct: (s.silenceLinePunct ?? 0.35) * scale,
            silenceLineNoPunct: (s.silenceLineNoPunct ?? 0.55) * scale,
            silenceParagraph: (s.silenceParagraph ?? 0.75) * scale,
            silenceChunk: (s.silenceChunk ?? 0.15) * scale,
        };
    }

    log(msg, type = 'info') {
        const time = new Date().toLocaleTimeString('vi-VN');
        const entry = document.createElement('div');
        entry.className = `log-line ${type}`;
        entry.innerHTML = `<span class="ts">${time}</span>${escHtml(msg)}`;
        this.logBody?.prepend(entry);
    }

    isChunkAutoEnabled() {
        return false;
    }

    getChunkMaxChars() {
        return Math.max(400, Math.min(5000, Number(this.app.settings.chunkMaxChars) || 1200));
    }

    isPaneActive() {
        return Boolean(this.pane.closest('.vb-page')?.classList.contains('active'));
    }

    addRow(data = {}) {
        const job = {
            id: data.id || uid(),
            checked: true,
            group: data.group || '',
            nameSave: data.nameSave || `task-${this.jobs.length + 1}`,
            text: data.text || '',
            status: 'pending',
            progress: 0,
            result: '',
            outputPath: '',
        };
        this.jobs.push(job);
        this.renderGrid();
        this.saveJobs();
    }

    getFilteredJobs() {
        let list = [...this.jobs];
        if (this.filterStatus !== 'all') {
            list = list.filter((j) => j.status === this.filterStatus);
        }
        if (this.searchQuery) {
            list = list.filter((j) =>
                j.nameSave.toLowerCase().includes(this.searchQuery)
                || j.text.toLowerCase().includes(this.searchQuery)
                || j.group.toLowerCase().includes(this.searchQuery));
        }
        if (this.sortKey === 'order') {
            list.sort((a, b) => {
                const ia = this.jobs.indexOf(a);
                const ib = this.jobs.indexOf(b);
                return this.sortDir === 'asc' ? ia - ib : ib - ia;
            });
            return list;
        }
        const key = this.sortKey === 'name' ? 'nameSave' : this.sortKey;
        list.sort((a, b) => {
            let va = a[key] ?? '';
            let vb = b[key] ?? '';
            if (typeof va === 'string') va = va.toLowerCase();
            if (typeof vb === 'string') vb = vb.toLowerCase();
            if (va < vb) return this.sortDir === 'asc' ? -1 : 1;
            if (va > vb) return this.sortDir === 'asc' ? 1 : -1;
            return 0;
        });
        return list;
    }

    toggleSort(key, th) {
        if (this.sortKey === key) {
            this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc';
        } else {
            this.sortKey = key;
            this.sortDir = 'asc';
        }
        this.pane.querySelectorAll('.vb-grid th.sortable').forEach((h) => {
            h.classList.remove('sorted-asc', 'sorted-desc');
        });
        th.classList.add(this.sortDir === 'asc' ? 'sorted-asc' : 'sorted-desc');
        this.renderGrid();
    }

    renderGrid() {
        const filtered = this.getFilteredJobs();

        if (this.pageInfo) {
            this.pageInfo.textContent = `${filtered.length} tác vụ · ${this.jobs.length} tổng`;
        }

        if (!filtered.length && !this.jobs.length) {
            this.gridBody.innerHTML = `<tr><td colspan="9"><div class="vb-empty">Chưa có tác vụ. Nhập text, import file hoặc kéo thả .txt vào đây.</div></td></tr>`;
            this.updateStats();
            return;
        }

        if (!filtered.length) {
            this.gridBody.innerHTML = `<tr><td colspan="9"><div class="vb-empty">Không có tác vụ phù hợp bộ lọc.</div></td></tr>`;
            this.updateStats();
            return;
        }

        this.gridBody.innerHTML = filtered.map((job, idx) => {
            const st = STATUS[job.status] || STATUS.pending;
            const hasFile = Boolean(job.outputPath);
            const prog = job.status === 'running' ? 'indeterminate' : (job.status === 'done' ? 100 : job.progress || 0);
            const progClass = job.status === 'running' ? 'indeterminate' : '';
            const stt = idx + 1;
            const globalIdx = this.jobs.indexOf(job) + 1;
            return `<tr data-id="${job.id}" class="${st.row}">
                <td class="col-cb"><input type="checkbox" class="row-check" ${job.checked ? 'checked' : ''}></td>
                <td class="col-stt"><span class="task-stt" title="Thứ tự ${globalIdx}">${stt}</span></td>
                <td class="col-grp"><input type="text" class="cell-group" value="${escHtml(job.group)}" placeholder="Nhóm"></td>
                <td class="col-file"><input type="text" class="cell-name" value="${escHtml(job.nameSave)}" placeholder="Tên file"></td>
                <td class="col-text"><textarea class="cell-text" rows="3" placeholder="Nhập nội dung văn bản…"></textarea></td>
                <td class="col-st"><span class="vb-pill ${st.cls}">${st.label}</span></td>
                <td class="col-prog"><div class="vb-progress"><div class="vb-progress-bar ${progClass}" style="width:${prog}%"></div></div></td>
                <td class="col-out"><button type="button" class="output-link btn-open-folder ${hasFile ? '' : 'muted'}">${escHtml(job.result || '—')}</button></td>
                <td class="col-act"><div class="vb-row-actions">
                    <button type="button" class="vb-icon-btn btn-preview" title="Nghe thử">▶</button>
                    <button type="button" class="vb-icon-btn btn-open-folder" title="Mở thư mục">📂</button>
                    <button type="button" class="vb-icon-btn btn-retry-row" title="Chạy lại">↻</button>
                    <button type="button" class="vb-icon-btn danger btn-delete-row" title="Xóa">✕</button>
                </div></td>
            </tr>`;
        }).join('');

        this.gridBody.querySelectorAll('tr[data-id]').forEach((tr) => {
            const id = tr.dataset.id;
            tr.querySelector('.row-check')?.addEventListener('change', (e) => {
                const job = this.jobs.find((j) => j.id === id);
                if (job) { job.checked = e.target.checked; this.updateStats(); }
            });
            tr.querySelector('.cell-group')?.addEventListener('input', (e) => {
                const job = this.jobs.find((j) => j.id === id);
                if (job) { job.group = e.target.value; this.saveJobs(); }
            });
            tr.querySelector('.cell-name')?.addEventListener('input', (e) => {
                const job = this.jobs.find((j) => j.id === id);
                if (job) { job.nameSave = e.target.value; this.saveJobs(); }
            });
            tr.querySelector('.cell-text')?.addEventListener('input', (e) => {
                const job = this.jobs.find((j) => j.id === id);
                if (job) {
                    job.text = e.target.value;
                    this.saveJobs();
                }
            });
            tr.querySelector('.cell-text')?.addEventListener('paste', () => {
                // After paste settles into textarea value
                setTimeout(() => this.refreshContentLanguage({ notifySelector: true }), 0);
            });
            tr.querySelector('.cell-text')?.addEventListener('blur', () => {
                this.refreshContentLanguage({ notifySelector: false });
            });
            const ta = tr.querySelector('.cell-text');
            const job = this.jobs.find((j) => j.id === id);
            if (ta && job) ta.value = job.text || '';
            tr.querySelectorAll('.btn-open-folder').forEach((b) => b.addEventListener('click', () => this.openJobFolder(id)));
            tr.querySelector('.btn-delete-row')?.addEventListener('click', () => {
                this.jobs = this.jobs.filter((j) => j.id !== id);
                this.renderGrid();
                this.saveJobs();
            });
            tr.querySelector('.btn-preview')?.addEventListener('click', () => this.previewRow(id));
            tr.querySelector('.btn-retry-row')?.addEventListener('click', () => this.retryRow(id));
        });

        this.updateStats();
    }

    updateStats() {
        const total = this.jobs.length;
        const waiting = this.jobs.filter((j) => j.status === 'pending').length;
        const done = this.jobs.filter((j) => j.status === 'done').length;
        const errors = this.jobs.filter((j) => j.status === 'error').length;
        const sel = (c) => this.pane.querySelector(c);
        if (sel('.stat-total')) sel('.stat-total').textContent = total;
        if (sel('.stat-waiting')) sel('.stat-waiting').textContent = waiting;
        if (sel('.stat-done')) sel('.stat-done').textContent = done;
        if (sel('.stat-error')) sel('.stat-error').textContent = errors;
    }

    setEngineStatus(text, state) {
        if (!this.engineStatus) return;
        this.engineStatus.textContent = text;
        this.engineStatus.className = `vb-status-chip engine-status-badge is-${state}`;
    }

    resolveJobSaveDir(job) {
        const base = this.getOutputDir();
        if (!job?.group?.trim()) return base;
        const group = sanitizeDirName(job.group.trim());
        if (!base) return group;
        const sep = base.includes('\\') ? '\\' : '/';
        return `${base}${sep}${group}`;
    }

    async openJobFolder(jobId) {
        const job = this.jobs.find((j) => j.id === jobId);
        if (!job) return;
        try {
            if (job.outputPath) {
                await window.api.showItemInFolder(job.outputPath);
            } else {
                await window.api.openPath(this.resolveJobSaveDir(job) || undefined);
            }
        } catch (e) {
            this.log(`Không mở được thư mục: ${e.message}`, 'error');
        }
    }

    toggleAll(checked) {
        this.getFilteredJobs().forEach((j) => {
            const job = this.jobs.find((x) => x.id === j.id);
            if (job) job.checked = checked;
        });
        this.renderGrid();
    }

    async importFolder() {
        const folder = await window.api.selectFolder();
        if (!folder) return;
        const { error, rows } = this.parseImportResult(await window.api.importFolder(folder));
        if (error) return alert(error);
        this.logImportResult(rows, 'thư mục');
    }

    async importExcel() {
        const files = await window.api.selectFiles([{ name: 'Excel', extensions: ['xlsx', 'xls'] }]);
        if (!files?.length) return;
        const { error, rows } = this.parseImportResult(await window.api.importExcel(files[0]));
        if (error) return alert(error);
        this.logImportResult(rows, 'Excel');
    }

    async importTxt() {
        const files = await window.api.selectFiles([{ name: 'Text', extensions: ['txt'] }]);
        if (!files?.length) return;
        const { error, rows } = this.parseImportResult(await window.api.importTxt(files));
        if (error) return alert(error);
        this.logImportResult(rows, 'TXT');
    }

    exportJobs() {
        const blob = new Blob([JSON.stringify(this.jobs, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `khepree-export-${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(a.href);
        this.log('Đã xuất danh sách tác vụ.', 'success');
    }

    deleteSelected() {
        this.jobs = this.jobs.filter((j) => !j.checked);
        this.renderGrid();
        this.saveJobs();
    }

    clearAll() {
        if (this.running) {
            alert('Đang chạy batch — hãy dừng trước khi xóa tất cả.');
            return;
        }
        if (!this.jobs.length) return;
        const n = this.jobs.length;
        if (!confirm(`Xóa toàn bộ ${n} tác vụ trong bảng chờ?\nHành động này không thể hoàn tác.`)) return;
        this.jobs = [];
        this._suppressLangWarnEngines.clear();
        this.detectedLanguage = null;
        this.contentLanguageOverride = 'auto';
        this.renderGrid();
        this.saveJobs();
        this.syncContentLangHint();
        this.log(`Đã xóa ${n} tác vụ khỏi bảng chờ.`, 'warning');
    }

    async populateModels() {
        await this.loadModel();
    }

    async loadModel() {
        if (this._loadModelPromise) return this._loadModelPromise;
        this._loadModelPromise = this._loadModelImpl();
        try {
            return await this._loadModelPromise;
        } finally {
            this._loadModelPromise = null;
        }
    }

    async _loadModelImpl() {
        this.tts.dispose();
        if (this.selVoice) this.selVoice.innerHTML = '<option value="">Đang tải giọng…</option>';
        this.setEngineStatus('Đang tải…', 'loading');
        try {
            const initOpts = {};
            if (this.engineId === 'spark') {
                this.populateVoiceModeSelect();
                this.populateLangSelect();
                this.applySparkModeUi();
                initOpts.device = this.app.settings.device || 'cuda';
                initOpts.variant = '0.5b';
            } else if (this.engineId === 'gpt-sovits') {
                this.populateLangSelect();
                await this.refreshGptSovitsProfiles();
                this.updateGptSovitsViWarn();
                initOpts.device = this.app.settings.device || 'cuda';
                initOpts.gptWeights = this.pane.querySelector('.inp-gpt-ckpt')?.value
                    || this.app.settings.gptSovitsGptCkpt
                    || '';
                initOpts.sovitsWeights = this.pane.querySelector('.inp-sovits-ckpt')?.value
                    || this.app.settings.gptSovitsSovitsCkpt
                    || '';
            } else if (this.caps.voiceMode) {
                this.populateVoiceModeSelect();
                initOpts.voiceMode = this.selVoiceMode?.value
                    || (this.voiceModeKey && this.app.settings[this.voiceModeKey])
                    || this.meta.voiceModes?.[0]?.id
                    || 'vietnamese';
            } else if (this.caps.modelVariantSelect) {
                await this.populateVariantSelect();
                initOpts.variant = this.selVariant?.value
                    || (this.variantKey && this.app.settings[this.variantKey])
                    || this.meta.variants?.[0]?.id
                    || 'mini';
                this.applyVariantProfileUi();
                this.applyQwen3VariantUi();
                if (this.caps.languageSelect) this.populateLangSelect();
                if (this.caps.expressionTags) await this.populateExpressionTags();
                if (this.engineId === 'qwen3' && this.meta.speakers?.length && this.selVoice) {
                    this.selVoice.innerHTML = this.meta.speakers.map((sp) =>
                        `<option value="${escHtml(sp.id)}">${escHtml(sp.label)}</option>`).join('');
                }
            } else if (this.caps.expressionTags || this.caps.voiceClone) {
                initOpts.variant = this.meta.modelVariant || 'nano';
                await this.populateExpressionTags();
            } else if (this.mode) {
                initOpts.mode = this.mode;
            }

            const voices = await this.tts.init(initOpts, this.app.settings);
            this.fillVoiceSelect(voices);
            this.syncFromSettings();
            if (this.caps.expressionTags) await this.populateExpressionTags();
            this.setEngineStatus('Sẵn sàng', 'ready');

            let msg = this.meta.readyMessage || `${this.meta.displayName} sẵn sàng`;
            if (this.caps.voiceMode && initOpts.voiceMode) {
                const modeLabel = this.meta.voiceModes?.find((m) => m.id === initOpts.voiceMode)?.label
                    || initOpts.voiceMode;
                msg = `${this.meta.displayName} sẵn sàng — ${modeLabel}`;
            }
            this.log(msg, 'success');
        } catch (e) {
            if (this.selVoice) this.selVoice.innerHTML = '<option value="">Lỗi</option>';
            this.setEngineStatus('Lỗi', 'error');
            this.log(e.message, 'error');
        }
    }

    fillVoiceSelect(voices) {
        if (!this.selVoice) return;
        const list = (voices || []).map((v) => {
            if (typeof v === 'string') return { id: v, label: v };
            return { id: v.id || v.name, label: v.label || v.name || v.id };
        });
        this.selVoice.innerHTML = list.map((v) =>
            `<option value="${escHtml(v.id)}">${escHtml(v.label)}</option>`).join('');
        const preferred = this.app.settings[this.voiceKey] || '';
        if (preferred && [...this.selVoice.options].some((o) => o.value === preferred)) {
            this.selVoice.value = preferred;
        } else if (this.selVoice.options.length) {
            this.app.settings[this.voiceKey] = this.selVoice.value;
        }
    }

    getOutputDir() {
        return this.outputDir || this.app.settings.outputDir || '';
    }

    async pickOutputDir() {
        const dir = await window.api.selectFolder();
        if (dir) {
            this.outputDir = dir;
            this.outputLabel.textContent = dir.split(/[/\\]/).pop() || dir;
            this.outputLabel.title = dir;
        }
    }

    initOutputLabel() {
        const dir = this.getOutputDir();
        if (dir) {
            this.outputLabel.textContent = dir.split(/[/\\]/).pop() || dir;
            this.outputLabel.title = dir;
        } else {
            this.outputLabel.textContent = 'Tải xuống';
            this.outputLabel.title = 'Thư mục Downloads hệ thống';
        }
    }

    setRunningUI(state) {
        const q = (s) => this.pane.querySelector(s);
        this.running = state === 'running';
        q('.btn-run').style.display = state === 'running' ? 'none' : '';
        q('.btn-stop').style.display = state === 'running' || state === 'paused' ? '' : 'none';
        q('.btn-pause').disabled = state !== 'running';
        q('.btn-resume').disabled = state !== 'paused';
        if (state === 'running') this.setEngineStatus('Đang chạy', 'running');
        else if (state === 'paused') this.setEngineStatus('Tạm dừng', 'paused');
        else if (this.tts.ready) this.setEngineStatus('Sẵn sàng', 'ready');
        this.app.tabManager?.syncChangeEngineLock?.();
    }

    pause() {
        if (!this.running) return;
        this.paused = true;
        this.setRunningUI('paused');
        this.log('Batch tạm dừng.', 'warning');
    }

    resume() {
        if (!this.paused) return;
        this.paused = false;
        this.setRunningUI('running');
        this.log('Batch tiếp tục.', 'info');
    }

    async run(selectedOnly = true) {
        if (this.running && !this.paused) return;
        if (this.paused) { this.resume(); return; }

        const preferClone = Boolean(this.caps?.voiceClone);
        const ok = await this.ensureLanguageGate({ preferClone });
        if (!ok) return;

        if (!this.tts.ready) await this.loadModel();
        if (!this.tts.ready) return alert(this.meta.notReadyAlert);

        const queue = this.jobs.filter((j) => (!selectedOnly || j.checked) && j.text.trim());
        if (!queue.length) return alert('Không có tác vụ để chạy.');

        this.stopRequested = false;
        this.paused = false;
        this.setRunningUI('running');
        const voice = this.selVoice.value || '';
        const concurrency = Math.max(1, Math.min(8, Number(this.app.settings.batchWorkers) || 1));

        this.log(`Bắt đầu batch — ${queue.length} tác vụ · ${concurrency} luồng…`);

        let queueIndex = 0;
        let activeCount = 0;

        const processJob = async (job) => {
            while (this.paused && !this.stopRequested) await sleep(300);
            if (this.stopRequested) return;

            job.status = 'running';
            job.progress = 0;
            this.renderGrid();
            const seq = this.jobs.indexOf(job) + 1;
            this.log(`Đang xử lý #${seq} · ${job.nameSave}`);

            try {
                const blob = await this.tts.synthesize(job.text.trim(), voice, this.app.settings, this.getSynthOverrides());
                const buffer = await blob.arrayBuffer();
                const save = await window.api.saveAudio({
                    buffer,
                    outputDir: this.getOutputDir(),
                    fileName: job.nameSave || job.id,
                    group: job.group,
                    format: this.audioFormat,
                });
                if (save.error) throw new Error(save.error);

                job.status = 'done';
                job.progress = 100;
                job.outputPath = save.filePath;
                job.result = save.filePath.split(/[/\\]/).pop();
                this.log(`Đã lưu ${save.filePath}`, 'success');
            } catch (e) {
                job.status = 'error';
                job.progress = 0;
                job.result = e.message;
                this.log(`#${seq} lỗi: ${e.message}`, 'error');
            }

            this.renderGrid();
        };

        await new Promise((resolve) => {
            const launchNext = () => {
                if (this.stopRequested && activeCount === 0) {
                    resolve();
                    return;
                }
                while (!this.stopRequested && activeCount < concurrency && queueIndex < queue.length) {
                    const job = queue[queueIndex++];
                    activeCount += 1;
                    processJob(job).finally(() => {
                        activeCount -= 1;
                        if (queueIndex >= queue.length && activeCount === 0) resolve();
                        else launchNext();
                    });
                }
                if (queue.length === 0) resolve();
            };
            launchNext();
        });

        this.setRunningUI('idle');
        const completed = !this.stopRequested;
        this.log(completed ? 'Batch hoàn tất.' : 'Batch đã dừng.', completed ? 'success' : 'warning');
        if (completed) playBatchCompleteSound();
        this.saveJobs();
    }

    retryRow(id) {
        const job = this.jobs.find((j) => j.id === id);
        if (!job) return;
        job.status = 'pending';
        job.progress = 0;
        job.checked = true;
        this.renderGrid();
        this.run(true);
    }

    runErrors() {
        this.jobs.forEach((j) => { if (j.status === 'error') j.checked = true; });
        this.renderGrid();
        this.run(true);
    }

    stop() {
        this.stopRequested = true;
        this.paused = false;
        this.log('Đang dừng…', 'warning');
    }

    async previewRow(id) {
        const job = this.jobs.find((j) => j.id === id);
        if (!job?.text.trim()) return;
        const ok = await this.ensureLanguageGate({
            preferClone: Boolean(this.caps?.voiceClone),
        });
        if (!ok) return;
        if (!this.tts.ready) await this.loadModel();
        try {
            const blob = await this.tts.synthesize(job.text.trim(), this.selVoice.value || '', this.app.settings, this.getSynthOverrides());
            const url = URL.createObjectURL(blob);
            const audio = new Audio(url);
            audio.onended = () => URL.revokeObjectURL(url);
            await audio.play();
        } catch (e) {
            alert(e.message);
        }
    }

    saveJobs() {
        window.api.saveJobs(this.engine, this.jobs);
    }

    async loadJobs() {
        const saved = await window.api.loadJobs(this.engine);
        if (Array.isArray(saved) && saved.length) {
            this.jobs = saved.map((j) => ({ progress: 0, ...j }));
            this.renderGrid();
            this.refreshContentLanguage({ notifySelector: false });
        }
    }

    async reloadEngine() {
        this.tts.dispose();
        await this.loadModel();
    }

    dispose() {
        this.tts.dispose();
    }
}

class TTSTabManager {
    constructor(app) {
        this.app = app;
        /** @type {Map<string, BatchController>} */
        this.controllers = new Map();
        this.activeEngineId = null;
    }

    init() {
        const specs = [
            { engine: 'vieneu', paneId: 'batch-workspace' },
            { engine: 'v3nano', paneId: 'nano-workspace' },
            { engine: 'edge', paneId: 'edge-workspace' },
            { engine: 'supertonic', paneId: 'supertonic-workspace' },
            { engine: 'kitten', paneId: 'kitten-workspace' },
            { engine: 'kokoro', paneId: 'kokoro-workspace' },
            { engine: 'piper', paneId: 'piper-workspace' },
            { engine: 'chatterbox', paneId: 'chatterbox-workspace' },
            { engine: 'qwen3', paneId: 'qwen3-workspace' },
            { engine: 'spark', paneId: 'spark-workspace' },
            { engine: 'gpt-sovits', paneId: 'gpt-sovits-workspace' },
        ];
        for (const { engine, paneId } of specs) {
            const pane = document.getElementById(paneId);
            if (!pane) continue;
            const meta = getEngineMeta(engine);
            this.controllers.set(engine, new BatchController(pane, this.app, {
                engine,
                mode: meta.workerMode,
            }));
        }
        this.activeEngineId = resolveEngineId(
            this.app.settings?.selectedBatchEngine || 'vieneu'
        );
    }

    get(engineId) {
        return this.controllers.get(resolveEngineId(engineId)) || null;
    }

    get vieneu() { return this.get('vieneu'); }
    get nano() { return this.get('v3nano'); }
    get edge() { return this.get('edge'); }

    syncFromSettings() {
        for (const c of this.controllers.values()) c.syncFromSettings();
    }

    async reloadAllEngines() {
        await Promise.all([
            this.get('vieneu')?.reloadEngine(),
            this.get('v3nano')?.reloadEngine(),
        ]);
    }

    async reloadEdge() {
        await this.get('edge')?.reloadEngine();
    }

    showEngine(engineId) {
        const id = resolveEngineId(engineId);
        this.activeEngineId = id;
        for (const [eid, ctrl] of this.controllers) {
            ctrl.pane.classList.toggle('is-active-engine', eid === id);
            ctrl.pane.hidden = eid !== id;
        }
        const selector = document.getElementById('engine-selector');
        if (selector) selector.hidden = true;
        if (this.app.settings) {
            this.app.settings.selectedBatchEngine = id;
            window.api.saveSettings(this.app.settings);
        }
        this.app.engineSelector?.syncWorkspaceHeaders(id);
        this.app.engineSelector?.renderSelectorCurrent(id);
        this.syncChangeEngineLock();
    }

    showSelector() {
        if (this.isAnyBatchRunning()) {
            alert('Đang chạy batch — không thể đổi engine.');
            return;
        }
        for (const ctrl of this.controllers.values()) {
            ctrl.pane.hidden = true;
            ctrl.pane.classList.remove('is-active-engine');
        }
        const selector = document.getElementById('engine-selector');
        if (selector) selector.hidden = false;
        this.app.engineSelector?.renderSelectorCurrent(this.activeEngineId);
        this.app.engineSelector?.refresh?.();
    }

    isAnyBatchRunning() {
        for (const ctrl of this.controllers.values()) {
            if (ctrl.running) return true;
        }
        return false;
    }

    syncChangeEngineLock() {
        const locked = this.isAnyBatchRunning();
        this.app.engineSelector?.setChangeEngineEnabled(!locked);
    }
}

export { TTSTabManager, BatchController };
