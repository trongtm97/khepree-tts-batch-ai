/**
 * ponytail: access error message map.
 * Run: node --input-type=module -e "import('./src/batch/khepree-access-messages.selfcheck.mjs')"
 * or: node src/batch/khepree-access-messages.selfcheck.mjs
 */
import assert from "node:assert/strict";
import { formatKhepreeAccessError } from "./khepree-access-messages.js";

assert.match(formatKhepreeAccessError("ENTITLEMENT_MISSING"), /dùng thử|bản quyền/i);
assert.match(formatKhepreeAccessError("ENTITLEMENT_EXPIRED"), /hết hạn/i);
assert.match(formatKhepreeAccessError("KHEPREE_ACCESS_REQUIRED"), /Khepree/i);
assert.equal(
  formatKhepreeAccessError("KHEPREE_FEATURE_NOT_ALLOWED:tts_batch_ai.access"),
  "Tính năng không được phép: tts_batch_ai.access",
);
console.log("khepree-access-messages.selfcheck ok");
