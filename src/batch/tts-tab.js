import TTSService from './tts-service.js';
import EdgeTTSService from './edge-service.js';
import { EDGE_VOICE_MODES } from './settings.js';

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
        this.engine = options.engine || 'vieneu';
        this.mode = options.mode || (this.engine === 'v3nano' ? 'v3nano' : 'v3turbo');
        this.isEdge = this.engine === 'edge';
        this.isNano = this.engine === 'v3nano';
        this.voiceKey = this.isEdge ? 'edgeVoice' : (this.isNano ? 'voiceNano' : 'voice');
        this.audioFormat = this.isEdge ? 'mp3' : 'wav';
        this.jobs = [];
        this.running = false;
        this.paused = false;
        this.stopRequested = false;
        this.outputDir = '';
        this.tts = this.isEdge ? new EdgeTTSService() : new TTSService();
        this._loadModelPromise = null;

        this.searchQuery = '';
        this.filterStatus = 'all';
        this.sortKey = 'order';
        this.sortDir = 'asc';

        this.volume = 1;
        this.pauseScale = 1;

        this.bindElements();
        this.bindEvents();
        this.initOutputLabel();
        this.syncSlidersFromSettings();
        this.renderGrid();
        this.populateModels();
        this.loadJobs();
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
        q('.check-all')?.addEventListener('change', (e) => this.toggleAll(e.target.checked));
        q('.btn-toggle-log')?.addEventListener('click', (e) => {
            if (e.target.closest('.btn-clear-log')) return;
            q('.log-panel')?.classList.toggle('collapsed');
        });
        q('.btn-clear-log')?.addEventListener('click', () => { this.logBody.innerHTML = ''; });

        this.selVoice?.addEventListener('change', () => {
            if (this.isEdge) {
                this.app.settings.edgeVoice = this.selVoice.value;
            } else {
                this.app.settings[this.voiceKey] = this.selVoice.value;
            }
            window.api.saveSettings(this.app.settings);
        });

        this.selVoiceMode?.addEventListener('change', () => this.onVoiceModeChange());

        this.speedRange?.addEventListener('input', () => this.updateSpeedLabel());
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
        if (!this.selVoiceMode) return;
        this.selVoiceMode.innerHTML = EDGE_VOICE_MODES.map((m) =>
            `<option value="${escHtml(m.id)}">${escHtml(m.label)}</option>`).join('');
        this.selVoiceMode.value = this.app.settings.edgeVoiceMode || 'vietnamese';
    }

    async onVoiceModeChange() {
        if (!this.selVoiceMode) return;
        this.app.settings.edgeVoiceMode = this.selVoiceMode.value;
        await window.api.saveSettings(this.app.settings);
        await this.loadModel();
    }

    syncFromSettings() {
        const s = this.app.settings;
        if (this.isEdge) {
            if (this.selVoiceMode) this.selVoiceMode.value = s.edgeVoiceMode || 'vietnamese';
            if (this.edgeRateRange) {
                this.edgeRateRange.value = s.edgeRate ?? 0;
                this.updateEdgeRateLabel();
            }
            if (this.edgePitchRange) {
                this.edgePitchRange.value = s.edgePitch ?? 0;
                this.updateEdgePitchLabel();
            }
            if (this.edgeVolumeRange) {
                this.edgeVolumeRange.value = s.edgeVolume ?? 0;
                this.updateEdgeVolumeLabel();
            }
            if (this.selVoice && s.edgeVoice) {
                for (const opt of this.selVoice.options) {
                    if (opt.value === s.edgeVoice) { this.selVoice.value = s.edgeVoice; break; }
                }
            }
            return;
        }
        if (this.speedRange) {
            this.speedRange.value = s.speed ?? 1;
            this.updateSpeedLabel();
        }
        const preferredVoice = s[this.voiceKey];
        if (this.selVoice && preferredVoice) {
            for (const opt of this.selVoice.options) {
                if (opt.value === preferredVoice) { this.selVoice.value = preferredVoice; break; }
            }
        }
        this.syncSlidersFromSettings();
    }

    syncSlidersFromSettings() {
        if (this.volumeRange) {
            this.volumeRange.value = Math.round((this.app.settings.volume ?? 1) * 100);
            this.updateVolumeLabel();
        }
        if (this.pauseRange) {
            this.pauseRange.value = Math.round((this.app.settings.pauseScale ?? 1) * 100);
            this.updatePauseLabel();
        }
    }

    getSynthOverrides() {
        const s = this.app.settings;
        if (this.isEdge) {
            return {
                edgeVoiceMode: this.selVoiceMode?.value || s.edgeVoiceMode,
                edgeRate: Number(this.edgeRateRange?.value ?? s.edgeRate ?? 0),
                edgePitch: Number(this.edgePitchRange?.value ?? s.edgePitch ?? 0),
                edgeVolume: Number(this.edgeVolumeRange?.value ?? s.edgeVolume ?? 0),
                useSeaG2p: s.useSeaG2p !== false,
                stripHash: s.stripHash !== false,
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
            tr.querySelector('.cell-text')?.addEventListener('paste', () => {});
            tr.querySelector('.cell-text')?.addEventListener('blur', () => {});
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
        this.renderGrid();
        this.saveJobs();
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
            if (this.isEdge) {
                this.populateVoiceModeSelect();
                const mode = this.selVoiceMode?.value || this.app.settings.edgeVoiceMode || 'vietnamese';
                const voices = await this.tts.init(mode, this.app.settings);
                if (this.selVoice) {
                    this.selVoice.innerHTML = voices.map((v) =>
                        `<option value="${escHtml(v.id)}">${escHtml(v.label || v.name)}</option>`).join('');
                    const preferred = this.app.settings.edgeVoice || '';
                    if (preferred && [...this.selVoice.options].some((o) => o.value === preferred)) {
                        this.selVoice.value = preferred;
                    } else if (this.selVoice.options.length) {
                        this.app.settings.edgeVoice = this.selVoice.value;
                    }
                }
                this.syncFromSettings();
                this.setEngineStatus('Sẵn sàng', 'ready');
                this.log(`Edge TTS sẵn sàng — ${mode === 'multilingual' ? 'Đa ngôn ngữ' : 'Tiếng Việt chuyên'}`, 'success');
                return;
            }

            const voices = await this.tts.init(this.mode, this.app.settings);
            if (this.selVoice) {
                this.selVoice.innerHTML = voices.map((v) =>
                    `<option value="${escHtml(v.id)}">${escHtml(v.label || v.name)}</option>`).join('');
                const preferred = this.app.settings[this.voiceKey] || '';
                if (preferred && [...this.selVoice.options].some((o) => o.value === preferred)) {
                    this.selVoice.value = preferred;
                } else if (this.selVoice.options.length) {
                    this.app.settings[this.voiceKey] = this.selVoice.value;
                }
            }
            this.syncFromSettings();
            this.setEngineStatus('Sẵn sàng', 'ready');
            this.log(this.isNano ? 'VieNeu V3 Nano sẵn sàng' : 'VieNeu V3 Turbo sẵn sàng', 'success');
        } catch (e) {
            if (this.selVoice) this.selVoice.innerHTML = '<option value="">Lỗi</option>';
            this.setEngineStatus('Lỗi', 'error');
            this.log(e.message, 'error');
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
        if (!this.tts.ready) await this.loadModel();
        if (!this.tts.ready) return alert(this.isEdge
            ? 'Edge TTS chưa sẵn sàng. Kiểm tra Python và kết nối mạng.'
            : 'Engine chưa sẵn sàng. Kiểm tra Cài đặt → Python.');

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
        this.vieneu = null;
        this.nano = null;
        this.edge = null;
    }

    init() {
        const vieneuPane = document.getElementById('batch-workspace');
        const nanoPane = document.getElementById('nano-workspace');
        const edgePane = document.getElementById('edge-workspace');
        if (vieneuPane) this.vieneu = new BatchController(vieneuPane, this.app, { engine: 'vieneu', mode: 'v3turbo' });
        if (nanoPane) this.nano = new BatchController(nanoPane, this.app, { engine: 'v3nano', mode: 'v3nano' });
        if (edgePane) this.edge = new BatchController(edgePane, this.app, { engine: 'edge' });
    }

    syncFromSettings() {
        this.vieneu?.syncFromSettings();
        this.nano?.syncFromSettings();
        this.edge?.syncFromSettings();
    }

    async reloadAllEngines() {
        await Promise.all([
            this.vieneu?.reloadEngine(),
            this.nano?.reloadEngine(),
        ]);
    }

    async reloadEdge() {
        await this.edge?.reloadEngine();
    }
}

export { TTSTabManager, BatchController };
