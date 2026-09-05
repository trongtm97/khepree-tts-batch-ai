/**
 * Engine Selector UI — registry languageSupport + hardware compatibility.
 * No auto-download on select. No fake star ratings. No hard-coded VI lists in HTML.
 */
import { loadEngineCatalog } from './engine-service.js';
import { resolveEngineId } from './engine-meta.js';
import {
    FILTERS,
    DEFAULT_FILTER,
    LEVEL,
    VI_LABEL,
    buildCardBadges,
    compatCardMessage,
    contextRecommendLabel,
    filterBySearch,
    groupEngines,
    installStatus,
    needsInstall,
    previewList,
    viLevel,
} from './engine-selector-model.js';
import { filterIdForLanguage } from './language-detect.js';

function escHtml(s) {
    return String(s || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function listBlock(items, title) {
    if (!items?.length) return '';
    return `<div class="vb-engine-block"><h4>${title}</h4><ul>${
        items.map((i) => `<li>${escHtml(i)}</li>`).join('')
    }</ul></div>`;
}

function renderLocalBenchBlock(text) {
    if (!text) return '';
    const lines = String(text).split('\n').filter(Boolean);
    return `<div class="vb-engine-local-bench">
      ${lines.map((l, i) => (i === 0
        ? `<div class="vb-engine-local-bench-title">${escHtml(l)}</div>`
        : `<div>${escHtml(l)}</div>`)).join('')}
    </div>`;
}

function renderEngineCard(engine, advice, benchInfo = null, autoPickId = null, filterId = 'vi') {
    const badges = buildCardBadges(engine, { filterId })
        .map((b) => `<span class="vb-engine-badge tone-${escHtml(b.tone)}">${escHtml(b.text)}</span>`)
        .join('');
    const level = advice?.level || '';
    const compatMsg = compatCardMessage(advice);
    const install = installStatus(engine);
    const unavailable = level === 'UNAVAILABLE' || engine.available === false;
    const notInstalled = needsInstall(engine) && engine.optional;
    const installing = install.id === 'installing';
    const broken = install.id === 'broken';
    const license = engine.license || {};
    const recommend = contextRecommendLabel(engine, filterId);
    const isAuto = autoPickId && engine.id === autoPickId;
    const localText = benchInfo?.localMetricsText || null;
    const positioning = engine.positioning || engine.description || '';
    const strengths = previewList(engine.strengths, 3);
    const weaknesses = previewList(engine.weaknesses, 2);
    const vi = viLevel(engine);

    const unsupportedNote = vi === LEVEL.UNSUPPORTED
        ? `<p class="vb-engine-vi-note tone-vi-unsupported">${escHtml(VI_LABEL[LEVEL.UNSUPPORTED])}</p>`
        : '';

    const detailsInner = [
        listBlock(engine.bestFor, 'PHÙ HỢP KHI'),
        listBlock(engine.avoidWhen, 'NÊN CHỌN MODEL KHÁC KHI'),
        (license.codeLicense || license.modelLicense)
            ? `<p class="vb-engine-license"><span>Code: ${escHtml(license.codeLicense || '—')}</span>
               <span>Model: ${escHtml(license.modelLicense || '—')}</span></p>`
            : '',
        license.attentionRequired
            ? `<p class="vb-engine-license-warn">Thành phần này sử dụng giấy phép riêng. Hãy xem thông tin giấy phép trước khi cài.</p>`
            : '',
        engine.description && engine.description !== positioning
            ? `<p class="vb-engine-desc">${escHtml(engine.description)}</p>`
            : '',
    ].filter(Boolean).join('');

    let actionHtml;
    if (installing) {
        actionHtml = `<button type="button" class="vb-btn vb-btn-secondary vb-btn-sm" disabled>Đang tải…</button>`;
    } else if (notInstalled || broken) {
        actionHtml = `<button type="button" class="vb-btn vb-btn-secondary vb-btn-sm btn-install-engine"
              data-engine-id="${escHtml(engine.id)}">${broken ? 'Sửa / Cài lại' : 'Cài'}</button>`;
    } else {
        actionHtml = `<button type="button" class="vb-btn vb-btn-primary vb-btn-sm btn-select-engine"
              data-engine-id="${escHtml(engine.id)}"
              ${unavailable ? 'disabled' : ''}>
        ${unavailable ? 'Không khả dụng' : 'Chọn'}
        </button>`;
    }

    return `
    <article class="vb-engine-card${recommend ? ' is-recommended' : ''}${isAuto ? ' is-auto-pick' : ''}${unavailable && !notInstalled ? ' is-disabled' : ''}"
             role="listitem" data-engine-id="${escHtml(engine.id)}" data-compat="${escHtml(level)}" data-vi-level="${escHtml(vi)}">
      <div class="vb-engine-card-head">
        <h3>${escHtml(engine.displayName)}${isAuto ? ' <span class="vb-auto-pill">AUTO</span>' : ''}</h3>
        ${recommend ? `<span class="vb-engine-recommend">${escHtml(recommend)}</span>` : ''}
        <p class="vb-engine-subtitle">${escHtml(engine.subtitle || '')}</p>
        <div class="vb-engine-badges">${badges}</div>
        <div class="vb-engine-meta-row">
          <span class="vb-engine-install-status" data-status="${escHtml(install.id)}">${escHtml(install.label)}</span>
        </div>
      </div>
      ${unsupportedNote}
      ${positioning ? `<p class="vb-engine-positioning">${escHtml(positioning)}</p>` : ''}
      ${compatMsg ? `<p class="vb-engine-compat">${escHtml(compatMsg)}</p>` : ''}
      ${renderLocalBenchBlock(localText)}
      ${listBlock(strengths, 'MẠNH VỀ')}
      ${listBlock(weaknesses, 'HẠN CHẾ')}
      ${detailsInner ? `<details class="vb-engine-details"><summary>Chi tiết</summary>${detailsInner}</details>` : ''}
      <div class="vb-engine-card-actions">
        ${actionHtml}
      </div>
    </article>`;
}

function renderSection(section, adviceFor, benchFor, autoPickId, filterId) {
    const title = section.title
        ? `<h2 class="vb-engine-section-title">${escHtml(section.title)}</h2>`
        : '';
    const cards = section.engines
        .map((e) => renderEngineCard(e, adviceFor(e.id), benchFor(e.id), autoPickId, filterId))
        .join('');
    return `<section class="vb-engine-section" data-section="${escHtml(section.id)}">${title}<div class="vb-engine-grid" role="list">${cards}</div></section>`;
}

export function createEngineSelector(app) {
    let engines = [];
    let adviceById = new Map();
    let benchById = new Map();
    let autoPickId = null;
    let activeFilter = DEFAULT_FILTER;
    let showUnsupportedVi = false;
    let searchQuery = '';
    let runningBench = false;
    /** User manually picked a filter chip — don't auto-switch tabs. */
    let userPickedFilter = false;

    const grid = () => document.getElementById('engine-selector-grid');
    const filtersEl = () => document.getElementById('engine-filters');
    const searchEl = () => document.getElementById('engine-selector-search');
    const selectorCurrent = () => document.getElementById('engine-selector-current');
    const statusEl = () => document.getElementById('benchmark-status');
    const autoPanel = () => document.getElementById('benchmark-auto-panel');
    const taskSel = () => document.getElementById('sel-benchmark-task');

    function adviceFor(id) {
        return adviceById.get(id) || null;
    }

    function benchFor(id) {
        return benchById.get(id) || null;
    }

    function setStatus(text, { error = false } = {}) {
        const el = statusEl();
        if (!el) return;
        if (!text) {
            el.hidden = true;
            el.textContent = '';
            return;
        }
        el.hidden = false;
        el.textContent = text;
        el.classList.toggle('is-error', error);
    }

    async function loadTasks() {
        const sel = taskSel();
        if (!sel || sel.options.length) return;
        try {
            const res = await window.api?.benchmarkListTasks?.();
            const tasks = res?.tasks || [];
            const cur = app.settings?.benchmarkPreferredTask || 'vi-general';
            sel.innerHTML = tasks.map((t) =>
                `<option value="${escHtml(t.id)}">${escHtml(t.label)}</option>`).join('');
            sel.value = cur;
            sel.addEventListener('change', () => {
                app.settings.benchmarkPreferredTask = sel.value;
                window.api?.saveSettings?.(app.settings);
            });
        } catch (_) { /* */ }
    }

    async function loadBenchResults() {
        benchById = new Map();
        try {
            const res = await window.api?.benchmarkGetResults?.();
            if (res?.ok && res.byEngine) {
                for (const [id, row] of Object.entries(res.byEngine)) {
                    benchById.set(id, row);
                }
            }
        } catch (_) { /* */ }
    }

    function catalogForView() {
        return filterBySearch(engines, searchQuery);
    }

    function renderFilters() {
        const el = filtersEl();
        if (!el) return;
        el.innerHTML = FILTERS.map((f) => `
          <button type="button" class="vb-filter-chip${f.id === activeFilter ? ' is-active' : ''}"
                  data-filter="${escHtml(f.id)}" aria-pressed="${f.id === activeFilter ? 'true' : 'false'}">${escHtml(f.label)}</button>
        `).join('');
        el.querySelectorAll('.vb-filter-chip').forEach((btn) => {
            btn.addEventListener('click', () => {
                activeFilter = btn.dataset.filter || DEFAULT_FILTER;
                showUnsupportedVi = false;
                userPickedFilter = true;
                renderFilters();
                renderGrid();
            });
        });
    }

    /**
     * Hint tab from detected content language — only if user hasn't picked a filter.
     */
    function onContentLanguage(contentLanguage, { forceTab = false } = {}) {
        const filterId = filterIdForLanguage(contentLanguage?.language);
        if (!filterId) return;
        if (!forceTab && userPickedFilter) return;
        if (activeFilter === filterId) return;
        activeFilter = filterId;
        showUnsupportedVi = false;
        renderFilters();
        renderGrid();
    }

    function wireSearch() {
        const el = searchEl();
        if (!el || el.dataset.wired) return;
        el.dataset.wired = '1';
        el.addEventListener('input', () => {
            searchQuery = el.value || '';
            renderGrid();
        });
    }

    function bindCardActions(root) {
        root.querySelectorAll('.btn-select-engine').forEach((btn) => {
            btn.addEventListener('click', () => {
                const id = btn.dataset.engineId;
                if (!id || btn.disabled) return;
                // Explicit select only — never auto-download
                app.tabManager?.showEngine(id);
            });
        });
        root.querySelectorAll('.btn-install-engine').forEach((btn) => {
            btn.addEventListener('click', async () => {
                const id = btn.dataset.engineId;
                if (!id || btn.disabled) return;
                btn.disabled = true;
                btn.textContent = 'Đang cài…';
                try {
                    const eng = engines.find((e) => e.id === id);
                    if (eng?.license?.attentionRequired || eng?.license?.licenseAttentionRequired) {
                        const warn = 'Thành phần này sử dụng giấy phép riêng. Hãy xem thông tin giấy phép trước khi cài.';
                        const detail = [
                            warn,
                            '',
                            `Code: ${eng.license.codeLicense || '—'}`,
                            `Model: ${eng.license.modelLicense || '—'}`,
                            '',
                            'Tiếp tục cài?',
                        ].join('\n');
                        if (!confirm(detail)) {
                            btn.disabled = false;
                            btn.textContent = 'Cài';
                            return;
                        }
                    }
                    let res;
                    if (id === 'piper') {
                        res = await window.api?.piperInstallOptional?.(
                            eng?.modelVariant || 'en_US-lessac-medium'
                        );
                    } else if (id === 'chatterbox' || eng?.family === 'chatterbox') {
                        res = await window.api?.chatterboxInstallOptional?.(
                            eng?.modelVariant || 'nano'
                        );
                    } else if (id === 'qwen3' || eng?.family === 'qwen3') {
                        res = await window.api?.qwen3InstallOptional?.(
                            eng?.modelVariant || '0.6b-custom'
                        );
                    } else if (id === 'spark' || eng?.family === 'spark') {
                        res = await window.api?.sparkInstallOptional?.();
                    } else if (id === 'gpt-sovits' || eng?.family === 'gpt-sovits') {
                        res = await window.api?.gptSovitsInstallOptional?.();
                    } else {
                        const variant = eng?.modelVariant
                            || (Array.isArray(eng?.modelVariants) && eng.modelVariants[0])
                            || 'default';
                        res = await window.api?.modelInstall?.(id, variant);
                    }
                    if (res?.error) {
                        alert(res.error);
                        btn.disabled = false;
                        btn.textContent = 'Cài';
                        return;
                    }
                    await refresh();
                    alert(`Đã cài ${id}. Có thể chọn engine để dùng.`);
                } catch (e) {
                    alert(e.message || String(e));
                    btn.disabled = false;
                    btn.textContent = 'Cài';
                }
            });
        });
        root.querySelectorAll('.btn-show-unsupported-vi').forEach((btn) => {
            btn.addEventListener('click', () => {
                showUnsupportedVi = true;
                activeFilter = 'vi';
                renderFilters();
                renderGrid();
            });
        });
        root.querySelectorAll('.btn-back-vi-supported').forEach((btn) => {
            btn.addEventListener('click', () => {
                showUnsupportedVi = false;
                renderGrid();
            });
        });
    }

    function renderGrid() {
        const el = grid();
        if (!el) return;
        const catalog = catalogForView();
        const sections = groupEngines(catalog, activeFilter, { showUnsupportedVi });
        const body = sections.length
            ? sections.map((s) => renderSection(s, adviceFor, benchFor, autoPickId, activeFilter)).join('')
            : '<p class="vb-engine-empty">Không có engine nào khớp bộ lọc.</p>';

        let footer = '';
        if (activeFilter === 'vi' && !showUnsupportedVi && !searchQuery.trim()) {
            footer = `<p class="vb-engine-footer-link">
              <button type="button" class="vb-link-btn btn-show-unsupported-vi">Xem các model không hỗ trợ tiếng Việt →</button>
            </p>`;
        } else if (activeFilter === 'vi' && showUnsupportedVi) {
            footer = `<p class="vb-engine-footer-link">
              <button type="button" class="vb-link-btn btn-back-vi-supported">← Quay lại model có tiếng Việt</button>
            </p>`;
        }

        el.innerHTML = body + footer;
        // grid container is now a sections host
        el.classList.toggle('is-sectioned', sections.some((s) => s.title));
        bindCardActions(el);
    }

    async function runLocalBenchmark() {
        if (runningBench) return;
        if (!window.api?.benchmarkRun) {
            setStatus('Benchmark API chưa sẵn sàng.', { error: true });
            return;
        }
        runningBench = true;
        const btn = document.getElementById('btn-benchmark-run');
        if (btn) btn.disabled = true;
        setStatus('Đang đo trên máy của bạn… (chỉ engine đã cài, không download)');
        const offProg = window.api.onBenchmarkProgress?.((p) => {
            if (p?.phase === 'engine') {
                setStatus(`Đang đo: ${p.engineId}${p.variant ? ` · ${p.variant}` : ''}…`);
            } else if (p?.phase === 'synth') {
                setStatus(`Đang synth: ${p.engineId} · ${p.itemId || ''}…`);
            } else if (p?.phase === 'init') {
                setStatus(`Khởi động: ${p.engineId}…`);
            }
        });
        try {
            const res = await window.api.benchmarkRun({});
            if (res?.error) {
                setStatus(res.error, { error: true });
            } else {
                setStatus(`Đã đo ${res.results?.length || 0} engine trên máy này.`);
                await loadBenchResults();
                renderGrid();
                const current = app.tabManager?.activeEngineId || app.settings?.selectedBatchEngine;
                renderSelectorCurrent(current);
                syncWorkspaceHeaders(current);
            }
        } catch (e) {
            setStatus(e.message || String(e), { error: true });
        } finally {
            offProg?.();
            runningBench = false;
            if (btn) btn.disabled = false;
        }
    }

    async function runAutoRecommend() {
        const panel = autoPanel();
        const task = taskSel()?.value || app.settings?.benchmarkPreferredTask || 'vi-general';
        setStatus('Đang tính AUTO đề xuất…');
        try {
            const res = await window.api?.benchmarkRecommend?.({ task });
            if (!res?.ok) {
                setStatus(res?.error || 'AUTO thất bại', { error: true });
                return;
            }
            autoPickId = res.pick?.engineId || null;
            renderGrid();
            if (panel) {
                panel.hidden = false;
                const lines = [];
                if (res.pick) {
                    lines.push(`<strong>Đề xuất (đã cài):</strong> ${escHtml(res.pick.engineId)}`
                        + (res.pick.variant ? ` · ${escHtml(res.pick.variant)}` : ''));
                    lines.push(`<p>${escHtml(res.pick.reason || '')}</p>`);
                    if (res.pick.localMetricsText) {
                        lines.push(`<pre class="vb-bench-pre">${escHtml(res.pick.localMetricsText)}</pre>`);
                    }
                    lines.push(`<button type="button" class="vb-btn vb-btn-primary vb-btn-sm" id="btn-auto-apply">Dùng ${escHtml(res.pick.engineId)}</button>`);
                } else {
                    lines.push('<p>Chưa có engine phù hợp đã cài cho tác vụ này.</p>');
                }
                if (res.suggestInstall) {
                    lines.push(`<p class="vb-bench-install-hint">${escHtml(res.suggestInstall.reason)}</p>`);
                    lines.push('<p class="vb-field-note">AUTO không tự download model.</p>');
                }
                panel.innerHTML = lines.join('');
                panel.querySelector('#btn-auto-apply')?.addEventListener('click', () => {
                    if (res.pick?.engineId) app.tabManager?.showEngine(res.pick.engineId);
                });
            }
            setStatus(res.pick
                ? `AUTO: ${res.pick.engineId}`
                : (res.suggestInstall?.reason || 'AUTO: chưa có pick đã cài'));
        } catch (e) {
            setStatus(e.message || String(e), { error: true });
        }
    }

    function wireBenchmarkUi() {
        document.getElementById('btn-benchmark-run')?.addEventListener('click', () => {
            void runLocalBenchmark();
        });
        document.getElementById('btn-benchmark-auto')?.addEventListener('click', () => {
            void runAutoRecommend();
        });
        void loadTasks();
    }

    function renderSelectorCurrent(engineId) {
        const el = selectorCurrent();
        if (!el) return;
        const id = resolveEngineId(engineId || app.tabManager?.activeEngineId || 'vieneu');
        const engine = engines.find((e) => e.id === id);
        const advice = adviceFor(id);
        if (!engine) {
            el.hidden = true;
            return;
        }
        el.hidden = false;
        const badges = buildCardBadges(engine, { filterId: activeFilter })
            .map((b) => `<span class="vb-engine-badge tone-${escHtml(b.tone)}">${escHtml(b.text)}</span>`)
            .join('');
        el.innerHTML = `
          <div class="vb-engine-now-label">ENGINE ĐANG DÙNG</div>
          <div class="vb-engine-now-body">
            <div>
              <div class="vb-engine-now-name">${escHtml(engine.displayName)}</div>
              <div class="vb-engine-now-sub">${escHtml(engine.subtitle || '')}</div>
              <div class="vb-engine-badges">${badges}</div>
              ${compatCardMessage(advice) ? `<p class="vb-engine-compat">${escHtml(compatCardMessage(advice))}</p>` : ''}
              ${renderLocalBenchBlock(benchFor(id)?.localMetricsText)}
            </div>
            <button type="button" class="vb-btn vb-btn-ghost vb-btn-sm" id="btn-back-to-workspace">Quay lại workspace</button>
          </div>`;
        el.querySelector('#btn-back-to-workspace')?.addEventListener('click', () => {
            app.tabManager?.showEngine(id);
        });
    }

    /** Update workspace header strips for the active engine. */
    function syncWorkspaceHeaders(engineId) {
        const id = resolveEngineId(engineId);
        const engine = engines.find((e) => e.id === id);
        const advice = adviceFor(id);
        if (!engine) return;

        document.querySelectorAll('.vb-batch').forEach((pane) => {
            const name = pane.querySelector('.engine-now-name, .vb-page-title');
            const sub = pane.querySelector('.engine-now-sub, .vb-page-sub');
            const badges = pane.querySelector('.engine-now-badges');
            const compat = pane.querySelector('.engine-now-compat');
            if (name) name.textContent = engine.displayName;
            if (sub) sub.textContent = engine.subtitle || '';
            if (badges) {
                badges.innerHTML = buildCardBadges(engine, { filterId: 'all' })
                    .map((b) => `<span class="vb-engine-badge tone-${escHtml(b.tone)}">${escHtml(b.text)}</span>`).join('');
            }
            if (compat) {
                const parts = [];
                const msg = compatCardMessage(advice);
                if (msg) parts.push(msg);
                const local = benchFor(id)?.localMetricsText;
                if (local) parts.push(local);
                compat.textContent = parts.join('\n') || '';
                compat.hidden = !parts.length;
                compat.style.whiteSpace = 'pre-line';
            }
        });
    }

    function setChangeEngineEnabled(enabled) {
        document.querySelectorAll('.btn-change-engine').forEach((btn) => {
            btn.disabled = !enabled;
            btn.title = enabled ? 'Đổi engine' : 'Đang chạy batch — không thể đổi engine';
        });
    }

    async function refresh() {
        try {
            engines = await loadEngineCatalog(true);
        } catch (_) {
            engines = [];
        }
        if (!engines.length) {
            engines = [
                {
                    id: 'vieneu', displayName: 'VieNeu Turbo', subtitle: '', available: true, bundled: true,
                    badges: [], strengths: [], weaknesses: [], bestFor: [], avoidWhen: [],
                    languageSupport: { vi: { level: 'native', recommended: true } },
                    positioning: 'Khuyên dùng nếu nội dung chính là tiếng Việt.',
                },
                {
                    id: 'v3nano', displayName: 'VieNeu Nano', subtitle: '', available: true, bundled: true,
                    badges: [], strengths: [], weaknesses: [], bestFor: [], avoidWhen: [],
                    languageSupport: { vi: { level: 'native', recommended: true } },
                    positioning: 'Nhẹ hơn, phù hợp máy cần tiết kiệm tài nguyên.',
                },
                {
                    id: 'edge', displayName: 'Edge TTS', subtitle: '', available: true, bundled: true,
                    badges: [], strengths: [], weaknesses: [], bestFor: [], avoidWhen: [],
                    languageSupport: { vi: { level: 'supported', recommended: true } },
                    positioning: 'Nhiều giọng, dễ dùng, nhưng cần Internet.',
                },
            ];
        }

        adviceById = new Map();
        try {
            const res = await window.api?.adviseAllEngines?.();
            if (res?.ok && Array.isArray(res.advice)) {
                for (const a of res.advice) adviceById.set(a.engineId, a);
            }
        } catch (_) { /* offline advisor optional */ }

        await loadBenchResults();
        renderFilters();
        renderGrid();
        const current = app.tabManager?.activeEngineId || app.settings?.selectedBatchEngine;
        renderSelectorCurrent(current);
        syncWorkspaceHeaders(current);
    }

    function init() {
        wireBenchmarkUi();
        wireSearch();
        renderFilters();
        return refresh();
    }

    return {
        init,
        refresh,
        renderSelectorCurrent,
        syncWorkspaceHeaders,
        setChangeEngineEnabled,
        onContentLanguage,
        FILTERS,
        DEFAULT_FILTER,
    };
}
