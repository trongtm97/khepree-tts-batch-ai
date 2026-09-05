const { createPublicKey, verify } = require("node:crypto");

function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const obj = value;
  return `{${Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`)
    .join(",")}}`;
}

function verifyLease(lease, opts) {
  const requireSignature = opts.requireSignature ?? true;
  if (requireSignature && !opts.publicKeyPem) throw new Error("KHEPREE_SIGNING_KEY_MISSING");
  if (opts.publicKeyPem && lease.keyId !== opts.expectedKeyId) throw new Error("LEASE_KEY_ID_MISMATCH");
  if (lease.payload.productSlug !== opts.expectedProductSlug) throw new Error("LEASE_PRODUCT_MISMATCH");
  if (opts.expectedDeviceId && lease.payload.deviceId !== opts.expectedDeviceId) {
    throw new Error("LEASE_DEVICE_MISMATCH");
  }

  const now = opts.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (lease.payload.iat > now + 300) throw new Error("LEASE_IAT_IN_FUTURE");
  if (lease.payload.exp <= now) throw new Error("LEASE_EXPIRED");

  if (!opts.publicKeyPem) return;

  const key = createPublicKey(opts.publicKeyPem);
  const ok = verify(
    null,
    Buffer.from(canonicalJson(lease.payload), "utf8"),
    key,
    Buffer.from(lease.signature, "base64"),
  );
  if (!ok) throw new Error("LEASE_SIGNATURE_INVALID");
}

module.exports = { verifyLease };
