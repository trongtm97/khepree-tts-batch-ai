/**
 * ponytail: auth-protocol self-check — fails if unpackaged registration contract drifts.
 * Run: node electron/khepree/auth-protocol.selfcheck.cjs
 */
const assert = require("node:assert/strict");
const {
  PROTOCOL,
  PROTOCOL_PREFIX,
  extractAuthCallbackUrl,
} = require("./auth-protocol.cjs");

assert.equal(PROTOCOL, "khepreettsbatchai");
assert.equal(PROTOCOL_PREFIX, "khepreettsbatchai://");
assert.equal(
  extractAuthCallbackUrl([
    "C:\\electron.exe",
    ".",
    "khepreettsbatchai://auth/callback?code=abc&state=s",
  ]),
  "khepreettsbatchai://auth/callback?code=abc&state=s",
);
assert.equal(extractAuthCallbackUrl(["C:\\electron.exe", "."]), undefined);
assert.equal(extractAuthCallbackUrl(undefined), undefined);
console.log("auth-protocol.selfcheck ok");
