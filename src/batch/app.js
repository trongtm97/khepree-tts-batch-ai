import { TTSTabManager } from './tts-tab.js';
import { formatKhepreeAccessError } from './khepree-access-messages.js';

import {

    DEFAULT_SETTINGS,

    applySettingsToForm,

    readVieneuSettingsFromForm,

    readEdgeSettingsFromForm,

    applyVieneuDefaultsToForm,

    applyEdgeDefaultsToForm,

    VIENEU_SETTING_KEYS,

    EDGE_SETTING_KEYS,

} from './settings.js';



const app = {

    settings: { ...DEFAULT_SETTINGS },

    tabManager: null,

};



async function loadSettings() {

    const s = await window.api.loadSettings();

    if (s) app.settings = { ...DEFAULT_SETTINGS, ...s };

    applySettingsToForm(app.settings);

    app.tabManager?.syncFromSettings();

}



async function saveVieneuSettings() {

    app.settings = {

        ...app.settings,

        ...readVieneuSettingsFromForm(app.settings),

    };

    await window.api.saveSettings(app.settings);

    app.tabManager?.syncFromSettings();

    alert('Đã lưu cài đặt VieNeu.');

}



async function saveEdgeSettings() {

    app.settings = {

        ...app.settings,

        ...readEdgeSettingsFromForm(app.settings),

    };

    await window.api.saveSettings(app.settings);

    app.tabManager?.syncFromSettings();

    alert('Đã lưu cài đặt Edge TTS.');

}



async function resetVieneuSettings() {

    if (!confirm('Khôi phục cài đặt VieNeu về mặc định?')) return;

    for (const key of VIENEU_SETTING_KEYS) {

        app.settings[key] = DEFAULT_SETTINGS[key];

    }

    applyVieneuDefaultsToForm();

    await window.api.saveSettings(app.settings);

    app.tabManager?.syncFromSettings();

}



async function resetEdgeSettings() {

    if (!confirm('Khôi phục cài đặt Edge TTS về mặc định?')) return;

    for (const key of EDGE_SETTING_KEYS) {

        app.settings[key] = DEFAULT_SETTINGS[key];

    }

    applyEdgeDefaultsToForm();

    await window.api.saveSettings(app.settings);

    app.tabManager?.syncFromSettings();

}



async function reloadEngine() {

    app.settings = {

        ...app.settings,

        ...readVieneuSettingsFromForm(app.settings),

    };

    await window.api.saveSettings(app.settings);

    const result = await window.api.ttsReload();

    if (result?.error) {

        alert(`Lỗi khởi động lại VieNeu: ${result.error}`);

        return;

    }

    await app.tabManager?.reloadAllEngines();

    alert('Đã khởi động lại VieNeu engine.');

}



async function reloadEdgeEngine() {

    app.settings = {

        ...app.settings,

        ...readEdgeSettingsFromForm(app.settings),

    };

    await window.api.saveSettings(app.settings);

    const result = await window.api.edgeReload();

    if (result?.error) {

        alert(`Lỗi khởi động lại Edge TTS: ${result.error}`);

        return;

    }

    await app.tabManager?.reloadEdge();

    alert('Đã khởi động lại Edge TTS.');

}



const TAB_ALIASES = {
    'settings-vieneu': { tab: 'settings', sub: 'vieneu' },
    'settings-edge': { tab: 'settings', sub: 'edge' },
    license: { tab: 'khepree', sub: 'license' },
    contact: { tab: 'khepree', sub: 'contact' },
};

const HUB_DEFAULT_SUB = { settings: 'vieneu', khepree: 'license' };

function showHubSub(hub, sub) {
    document.querySelectorAll(`.vb-hub-tab[data-hub="${hub}"]`).forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.sub === sub);
    });
    document.querySelectorAll(`.vb-hub-panel[data-hub="${hub}"]`).forEach((panel) => {
        panel.classList.toggle('active', panel.dataset.sub === sub);
    });
}

function showTab(rawTab) {
    const alias = TAB_ALIASES[rawTab];
    const tab = alias?.tab || rawTab;
    const sub = alias?.sub || HUB_DEFAULT_SUB[tab];

    document.querySelectorAll('.vb-nav-item').forEach((b) => {
        b.classList.toggle('active', b.dataset.tab === tab);
    });
    document.querySelectorAll('.vb-page').forEach((s) => {
        s.classList.toggle('active', s.id === `tab-${tab}`);
    });
    if (sub) showHubSub(tab, sub);
}

function initNavigation() {
    document.querySelectorAll('.vb-nav-item').forEach((btn) => {
        btn.addEventListener('click', () => showTab(btn.dataset.tab));
    });
    document.querySelectorAll('[data-goto]').forEach((btn) => {
        btn.addEventListener('click', () => showTab(btn.dataset.goto));
    });
    document.querySelectorAll('.vb-hub-tab').forEach((btn) => {
        btn.addEventListener('click', () => showHubSub(btn.dataset.hub, btn.dataset.sub));
    });
}



function initSourceLinks() {

    document.querySelectorAll('.vb-source-link[data-url]').forEach((el) => {

        el.addEventListener('click', (e) => {

            e.preventDefault();

            window.api.openExternal(el.dataset.url);

        });

    });

}



function initSettingsUI() {

    document.getElementById('btn-set-outputDir')?.addEventListener('click', async () => {

        const dir = await window.api.selectFolder();

        if (dir) document.getElementById('set-outputDir').value = dir;

    });

    document.getElementById('btn-save-settings-vieneu')?.addEventListener('click', saveVieneuSettings);

    document.getElementById('btn-save-settings-edge')?.addEventListener('click', saveEdgeSettings);

    document.getElementById('btn-reset-settings-vieneu')?.addEventListener('click', resetVieneuSettings);

    document.getElementById('btn-reset-settings-edge')?.addEventListener('click', resetEdgeSettings);

    document.getElementById('btn-reload-engine')?.addEventListener('click', reloadEngine);

    document.getElementById('btn-reload-edge')?.addEventListener('click', reloadEdgeEngine);

}



function initHelpUI() {

    document.getElementById('btn-download-template')?.addEventListener('click', async () => {

        const path = await window.api.downloadTemplate();

        if (path) alert(`Đã lưu file mẫu:\n${path}`);

    });

    document.getElementById('btn-open-bundled-template')?.addEventListener('click', async () => {

        const result = await window.api.openBundledTemplate();

        if (result?.error) alert(result.error);

    });

    document.querySelectorAll('.btn-download-template-inline').forEach((btn) => {
        btn.addEventListener('click', async () => {
            const filePath = await window.api.downloadTemplate();
            if (filePath) {
                btn.textContent = 'Đã lưu ✓';
                setTimeout(() => { btn.textContent = 'Tải mẫu Excel'; }, 2000);
            }
        });
    });

}



async function applyPackagedUI() {

    const info = await window.api.getAppInfo?.().catch(() => null);

    if (!info?.isPackaged) return;



    document.getElementById('row-pythonPath')?.classList.add('vb-hidden');

    const edgeReq = document.getElementById('edge-tech-requirements');

    if (edgeReq && info.hasBundledFfmpeg) {

        edgeReq.innerHTML = `

            <li>Cần <strong>internet</strong> khi chạy batch Edge.</li>

            <li>Bản cài đặt đã gồm Python, ffmpeg và thư viện Edge TTS — không cần cài thêm.</li>

            <li>Luồng batch (song song): cấu hình tại tab <button type="button" class="vb-link-btn" data-goto="settings-vieneu">Cài đặt VieNeu</button>.</li>

        `;

        edgeReq.querySelector('[data-goto="settings-vieneu"]')?.addEventListener('click', (e) => {
            e.preventDefault();
            showTab('settings-vieneu');
        });

    }

}



const LICENSE_STATUS_LABEL = {
    BOOTING: 'Đang khởi động',
    AUTH_REQUIRED: 'Cần đăng nhập',
    VALIDATING_SESSION: 'Đang kiểm tra phiên',
    ACTIVE: 'Đã kích hoạt',
    ENTITLEMENT_MISSING: 'Chưa có bản quyền',
    ENTITLEMENT_EXPIRED: 'Hết hạn',
    ENTITLEMENT_SUSPENDED: 'Tạm khóa',
    DEVICE_REMOVED: 'Thiết bị đã gỡ',
    DEVICE_BLOCKED: 'Thiết bị bị chặn',
    OFFLINE_COLD_START: 'Không kết nối được',
    ERROR: 'Lỗi',
};

function formatVnd(amountMinor) {
    return `${Number(amountMinor || 0).toLocaleString('vi-VN')} VND`;
}

function renderLicenseState(state) {
    if (!state) return;
    const status = state.status || 'BOOTING';
    const chip = document.getElementById('license-status-chip');
    const statusEl = document.getElementById('license-status');
    const userEl = document.getElementById('license-user');
    const planEl = document.getElementById('license-plan');
    const msgEl = document.getElementById('license-message');
    const offersEl = document.getElementById('license-offers');

    if (chip) {
        chip.textContent = LICENSE_STATUS_LABEL[status] || status;
        chip.classList.remove('is-ready', 'is-loading', 'is-error');
        if (status === 'ACTIVE') chip.classList.add('is-ready');
        else if (status === 'BOOTING' || status === 'VALIDATING_SESSION') chip.classList.add('is-loading');
        else chip.classList.add('is-error');
    }
    if (statusEl) statusEl.textContent = LICENSE_STATUS_LABEL[status] || status;
    if (userEl) userEl.textContent = state.user?.email || state.user?.name || '—';
    if (planEl) planEl.textContent = state.planSlug || '—';
    if (msgEl) {
        if (state.message) msgEl.textContent = state.message;
        else if (status === 'ACTIVE') msgEl.textContent = '';
        else msgEl.textContent = formatKhepreeAccessError(status);
    }

    if (offersEl) {
        const offers = state.offers || [];
        if (!offers.length) {
            offersEl.hidden = true;
            offersEl.innerHTML = '';
        } else {
            offersEl.hidden = false;
            offersEl.innerHTML = `<h2 class="vb-page-title" style="font-size:1.1rem;margin:1.5rem 0 .75rem">Gói có thể mua</h2>` +
                offers.map((o) => `
                    <button type="button" class="vb-btn vb-btn-primary license-buy" style="margin:0 .5rem .5rem 0"
                        data-plan="${o.planPublicId}" data-price="${o.pricePublicId}">
                        ${o.name} — ${formatVnd(o.priceAmount)} (${o.accessTermLabel || ''})
                    </button>`).join('');
            offersEl.querySelectorAll('.license-buy').forEach((btn) => {
                btn.addEventListener('click', async () => {
                    try {
                        await window.api.khepreeStartCheckout({
                            planPublicId: btn.dataset.plan,
                            pricePublicId: btn.dataset.price,
                        });
                    } catch (e) {
                        alert(e.message || String(e));
                    }
                });
            });
        }
    }
}

function initLicenseUI() {
    if (!window.api?.khepreeGetState) return;

    document.getElementById('license-login')?.addEventListener('click', () => window.api.khepreeStartLogin());
    document.getElementById('license-logout')?.addEventListener('click', () => window.api.khepreeLogout());
    document.getElementById('license-product')?.addEventListener('click', () => window.api.khepreeOpenProductPage());
    document.getElementById('license-refresh')?.addEventListener('click', async () => {
        const state = await window.api.khepreeRefreshMe();
        if (state?.error) {
            const fresh = await window.api.khepreeGetState();
            renderLicenseState(fresh);
            alert(state.error);
            return;
        }
        renderLicenseState(state);
    });

    window.api.onKhepreeState?.(renderLicenseState);
    window.api.khepreeGetState().then(renderLicenseState);
}



async function init() {

    if (!window.api) {

        document.body.innerHTML = '<div style="padding:40px;color:#fff;font-family:sans-serif;">Chạy ứng dụng bằng Electron: <code>npm start</code></div>';

        return;

    }



    await applyPackagedUI();

    initNavigation();

    initSourceLinks();

    initSettingsUI();

    initHelpUI();

    initLicenseUI();



    await loadSettings();



    app.tabManager = new TTSTabManager(app);

    app.tabManager.init();

}



init();

