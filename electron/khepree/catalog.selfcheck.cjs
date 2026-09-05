/**
 * ponytail: catalog contract self-check — fails if identity drifts from platform seed.
 * Run: node electron/khepree/catalog.selfcheck.cjs
 */
const assert = require("node:assert/strict");
const { KHEPREE_TTS_BATCH_CATALOG: c } = require("./catalog.cjs");

assert.equal(c.productSlug, "khepree-tts-batch-ai");
assert.equal(c.clientId, "khepree-tts-batch-ai-desktop");
assert.equal(c.protocol, "khepreettsbatchai");
assert.equal(c.redirectUri, "khepreettsbatchai://auth/callback");
assert.equal(c.accessFeatureKey, "tts_batch_ai.access");
assert.equal(c.plans.find((p) => p.slug === "trial")?.amountMinor, 0);
assert.equal(c.plans.find((p) => p.slug === "month")?.amountMinor, 49_000);
assert.equal(c.plans.find((p) => p.slug === "year")?.amountMinor, 499_000);
assert.equal(c.plans.find((p) => p.slug === "trial")?.accessTermDays, 1);
console.log("catalog.selfcheck ok");
