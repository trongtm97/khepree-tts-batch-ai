const { app, safeStorage } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

class SessionStore {
  get #filePath() {
    const dir = path.join(app.getPath("userData"), "secrets");
    fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, "khepree-session.json");
  }

  load() {
    if (!fs.existsSync(this.#filePath)) return undefined;
    if (!safeStorage.isEncryptionAvailable()) throw new Error("SAFE_STORAGE_UNAVAILABLE");
    const data = JSON.parse(fs.readFileSync(this.#filePath, "utf8"));
    return {
      sessionPublicId: data.sessionPublicId,
      refreshToken: safeStorage.decryptString(Buffer.from(data.encryptedRefreshToken, "base64")),
    };
  }

  save(sessionPublicId, refreshToken) {
    if (!safeStorage.isEncryptionAvailable()) throw new Error("SAFE_STORAGE_UNAVAILABLE");
    const data = {
      sessionPublicId,
      encryptedRefreshToken: safeStorage.encryptString(refreshToken).toString("base64"),
    };
    fs.writeFileSync(this.#filePath, JSON.stringify(data, null, 2), { mode: 0o600 });
  }

  clear() {
    if (fs.existsSync(this.#filePath)) fs.rmSync(this.#filePath, { force: true });
  }
}

module.exports = { SessionStore };
