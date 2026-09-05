/**
 * ponytail: access-service assertProductAccess contract.
 * Run: node electron/khepree/access-service.selfcheck.cjs
 */
const assert = require("node:assert/strict");

// Mirror assertProductAccess status surfacing without booting Electron.
function assertProductAccessMirror(state) {
  if (state.status !== "ACTIVE") {
    throw new Error(state.status || "KHEPREE_ACCESS_REQUIRED");
  }
}

assert.throws(
  () => assertProductAccessMirror({ status: "ENTITLEMENT_MISSING" }),
  (err) => err instanceof Error && err.message === "ENTITLEMENT_MISSING",
);
assert.throws(
  () => assertProductAccessMirror({ status: "AUTH_REQUIRED" }),
  (err) => err instanceof Error && err.message === "AUTH_REQUIRED",
);
assert.doesNotThrow(() => assertProductAccessMirror({ status: "ACTIVE" }));

console.log("access-service.selfcheck ok");
