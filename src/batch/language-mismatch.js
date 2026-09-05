/**
 * Language mismatch warning dialog — never auto-switches engine.
 */
import {
    LANG,
    LANG_LABEL,
    evaluateLanguageMismatch,
    shouldGateOnMismatch,
    suggestEnginesForLanguage,
} from './language-detect.js';
import { loadEngineCatalog } from './engine-service.js';
import { VI_LABEL } from './engine-selector-model.js';

function escHtml(s) {
    return String(s || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function ensureDialog() {
    let el = document.getElementById('lang-mismatch-dialog');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'lang-mismatch-dialog';
    el.className = 'vb-lang-dialog';
    el.hidden = true;
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.innerHTML = `
      <div class="vb-lang-dialog-backdrop" data-action="dismiss"></div>
      <div class="vb-lang-dialog-card">
        <h2 class="vb-lang-dialog-title"></h2>
        <div class="vb-lang-dialog-body"></div>
        <label class="vb-lang-dialog-suppress">
          <input type="checkbox" id="lang-mismatch-suppress" />
          Không nhắc lại với engine này trong project hiện tại
        </label>
        <div class="vb-lang-dialog-actions"></div>
      </div>`;
    document.body.appendChild(el);
    return el;
}

function suggestionBlurb(engine, level) {
    const bits = [];
    if (level && VI_LABEL[level]) bits.push(VI_LABEL[level]);
    else if (engine.languageSupport?.en?.level === 'native') bits.push('English');
    if (engine.capabilities?.voiceClone) bits.push('Clone giọng');
    if (engine.online) bits.push('Online');
    else if (engine.local !== false) bits.push('Offline');
    if (engine.capabilities?.cpu !== false) bits.push('CPU');
    return bits.slice(0, 4).join(' · ');
}

/**
 * @returns {Promise<'continue'|'switch'|'cancel'>}
 * switch resolves after caller should open selector / switch engine (detail.engineId)
 */
export function showLanguageMismatchDialog({
    contentLanguage,
    engine,
    suggestions = [],
    severity = 'strong',
}) {
    return new Promise((resolve) => {
        const el = ensureDialog();
        const title = el.querySelector('.vb-lang-dialog-title');
        const body = el.querySelector('.vb-lang-dialog-body');
        const actions = el.querySelector('.vb-lang-dialog-actions');
        const suppress = el.querySelector('#lang-mismatch-suppress');
        if (suppress) suppress.checked = false;

        const lang = contentLanguage?.language || LANG.UNKNOWN;
        const langLabel = LANG_LABEL[lang] || lang;
        const engineName = engine?.displayName || engine?.id || 'Engine';

        title.textContent = severity === 'strong'
            ? `⚠ Nội dung của bạn có vẻ là ${langLabel}`
            : 'Cảnh báo ngôn ngữ nội dung';

        const dist = contentLanguage?.distribution;
        let distHtml = '';
        if (dist && typeof dist === 'object') {
            const parts = Object.entries(dist)
                .filter(([, v]) => Number(v) > 0)
                .map(([k, v]) => `${escHtml(LANG_LABEL[k] || k)} ${Number(v)}%`);
            if (parts.length) {
                distHtml = `<p class="vb-lang-dist">${parts.join(' · ')}</p>`;
            }
        }

        const fit = evaluateLanguageMismatch(contentLanguage, engine);
        let intro;
        if (lang === LANG.MIXED) {
            intro = `<p>Nội dung của bạn có nhiều ngôn ngữ.</p>
              <p>${escHtml(fit.message)}</p>`;
        } else {
            intro = `<p><strong>${escHtml(engineName)}</strong> ${escHtml(fit.message || 'không phù hợp với ngôn ngữ hiện tại.')}</p>
              <p>Để có kết quả tốt hơn, Khepree khuyên dùng một model phù hợp hơn.</p>`;
        }

        let sugHtml = '';
        if (suggestions.length) {
            sugHtml = `<div class="vb-lang-suggest"><div class="vb-lang-suggest-label">ĐỀ XUẤT</div>
              <ul>${suggestions.map(({ engine: e, level }) => `
                <li>
                  <button type="button" class="vb-lang-suggest-btn" data-engine-id="${escHtml(e.id)}">
                    <span class="vb-lang-suggest-name">${escHtml(e.displayName)}</span>
                    <span class="vb-lang-suggest-meta">${escHtml(suggestionBlurb(e, level))}</span>
                  </button>
                </li>`).join('')}
              </ul></div>`;
        }

        body.innerHTML = intro + distHtml + sugHtml;
        actions.innerHTML = `
          <button type="button" class="vb-btn vb-btn-primary vb-btn-sm" data-action="switch">Chuyển model</button>
          <button type="button" class="vb-btn vb-btn-ghost vb-btn-sm" data-action="continue">Vẫn dùng ${escHtml(engineName)}</button>`;

        el.hidden = false;

        const cleanup = (result, engineId = null) => {
            el.hidden = true;
            el._onPick = null;
            resolve({
                action: result,
                engineId,
                suppress: Boolean(suppress?.checked),
            });
        };

        actions.querySelector('[data-action="continue"]')?.addEventListener('click', () => {
            cleanup('continue');
        });
        actions.querySelector('[data-action="switch"]')?.addEventListener('click', () => {
            const first = suggestions[0]?.engine?.id || null;
            cleanup('switch', first);
        });
        body.querySelectorAll('.vb-lang-suggest-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                cleanup('switch', btn.dataset.engineId);
            });
        });
        el.querySelector('[data-action="dismiss"]')?.addEventListener('click', () => {
            cleanup('cancel');
        }, { once: true });
    });
}

/**
 * Gate before preview / batch. Returns true if caller may proceed.
 */
export async function gateLanguageBeforeAction(app, controller, {
    preferClone = false,
} = {}) {
    const settings = app?.settings || {};
    if (settings.languageDetectionEnabled === false) return true;
    if (settings.languageMismatchWarnings === false) return true;

    const content = controller.getEffectiveContentLanguage?.() || { language: LANG.UNKNOWN };
    if (content.language === LANG.UNKNOWN) return true;

    const engineMeta = controller.meta || { id: controller.engineId };
    // Prefer live catalog entry (languageSupport)
    let engine = null;
    try {
        const catalog = await loadEngineCatalog(false);
        engine = catalog.find((e) => e.id === controller.engineId) || null;
    } catch (_) { /* */ }
    if (!engine) {
        engine = {
            id: controller.engineId,
            displayName: engineMeta.displayName || controller.engineId,
            languageSupport: engineMeta.languageSupport,
            languages: engineMeta.languages,
            capabilities: controller.caps || engineMeta.capabilities,
        };
    }

    if (controller.isLangWarnSuppressed?.(engine.id)) return true;

    const fit = evaluateLanguageMismatch(content, engine, { preferClone });
    if (!shouldGateOnMismatch(fit.severity)) {
        if (fit.severity === 'info' && fit.message) {
            controller.log?.(fit.message, 'info');
        }
        return true;
    }

    let adviceById = {};
    try {
        const res = await window.api?.adviseAllEngines?.();
        if (res?.ok && Array.isArray(res.advice)) {
            for (const a of res.advice) adviceById[a.engineId] = a;
        }
    } catch (_) { /* */ }

    const catalog = await loadEngineCatalog(false);
    const suggestions = suggestEnginesForLanguage(catalog, content, {
        adviceById,
        preferClone,
        limit: 3,
        excludeId: engine.id,
    });

    const result = await showLanguageMismatchDialog({
        contentLanguage: content,
        engine,
        suggestions,
        severity: fit.severity,
    });

    if (result.action === 'cancel') return false;

    if (result.suppress) {
        controller.suppressLangWarnFor?.(engine.id);
    }

    if (result.action === 'continue') return true;

    if (result.action === 'switch') {
        if (result.engineId) {
            app.tabManager?.showEngine(result.engineId);
        } else {
            app.tabManager?.showSelector?.();
        }
        // User chose to switch — do not continue current action on old engine
        return false;
    }

    return true;
}
