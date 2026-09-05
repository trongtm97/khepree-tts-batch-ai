const { app } = require("electron");
const path = require("node:path");
const { KHEPREE_TTS_BATCH_CATALOG } = require("./catalog.cjs");

const PROTOCOL = KHEPREE_TTS_BATCH_CATALOG.protocol;
const PROTOCOL_PREFIX = `${PROTOCOL}://`;

/** Unpackaged Windows/Linux must pass execPath + app entry or OS launches bare electron.exe. */
function registerAuthProtocolClient() {
  if (process.platform === "darwin") {
    app.setAsDefaultProtocolClient(PROTOCOL);
    return;
  }

  if (!app.isPackaged && process.defaultApp) {
    const entry = process.argv[1];
    if (entry && !entry.startsWith(PROTOCOL_PREFIX)) {
      app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [path.resolve(entry)]);
      return;
    }
  }

  app.setAsDefaultProtocolClient(PROTOCOL);
}

function extractAuthCallbackUrl(argv) {
  return (argv ?? []).find((arg) => typeof arg === "string" && arg.startsWith(PROTOCOL_PREFIX));
}

module.exports = {
  PROTOCOL,
  PROTOCOL_PREFIX,
  registerAuthProtocolClient,
  extractAuthCallbackUrl,
};
