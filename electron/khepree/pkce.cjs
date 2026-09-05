const { createHash, randomBytes } = require("node:crypto");

function b64url(input) {
  return input.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function createPkceTransaction() {
  const verifier = b64url(randomBytes(48));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  return {
    verifier,
    challenge,
    state: b64url(randomBytes(24)),
    createdAt: Date.now(),
  };
}

module.exports = { createPkceTransaction };
