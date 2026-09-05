/** Smoke: tab alias map used by showTab (mirrors app.js). */
const TAB_ALIASES = {
    'settings-vieneu': { tab: 'settings', sub: 'vieneu' },
    'settings-edge': { tab: 'settings', sub: 'edge' },
    license: { tab: 'khepree', sub: 'license' },
    contact: { tab: 'khepree', sub: 'contact' },
    nano: { tab: 'batch', engine: 'v3nano' },
    edge: { tab: 'batch', engine: 'edge' },
    vieneu: { tab: 'batch', engine: 'vieneu' },
    v3nano: { tab: 'batch', engine: 'v3nano' },
    'vieneu-turbo': { tab: 'batch', engine: 'vieneu' },
    'vieneu-nano': { tab: 'batch', engine: 'v3nano' },
};
const HUB_DEFAULT_SUB = { settings: 'vieneu', khepree: 'license' };

function resolve(raw) {
    const alias = TAB_ALIASES[raw];
    const tab = alias?.tab || raw;
    const sub = alias?.sub || HUB_DEFAULT_SUB[tab];
    return { tab, sub, engine: alias?.engine };
}

const cases = [
    ['batch', { tab: 'batch', sub: undefined }],
    ['settings', { tab: 'settings', sub: 'vieneu' }],
    ['settings-vieneu', { tab: 'settings', sub: 'vieneu' }],
    ['settings-edge', { tab: 'settings', sub: 'edge' }],
    ['khepree', { tab: 'khepree', sub: 'license' }],
    ['license', { tab: 'khepree', sub: 'license' }],
    ['contact', { tab: 'khepree', sub: 'contact' }],
    ['help', { tab: 'help', sub: undefined }],
    ['nano', { tab: 'batch', sub: undefined, engine: 'v3nano' }],
    ['edge', { tab: 'batch', sub: undefined, engine: 'edge' }],
];

for (const [raw, expect] of cases) {
    const got = resolve(raw);
    if (got.tab !== expect.tab || got.sub !== expect.sub || got.engine !== expect.engine) {
        console.error('FAIL', raw, got, expect);
        process.exit(1);
    }
}
console.log('nav-alias.selfcheck ok', cases.length);
