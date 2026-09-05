const { powerMonitor } = require("electron");

class KhepreeHeartbeatService {
  constructor(access) {
    this.access = access;
    this.timer = undefined;
    this.onResume = () => {
      void this.access.heartbeat();
    };
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => void this.access.heartbeat(), 60_000);
    powerMonitor.on("resume", this.onResume);
    powerMonitor.on("unlock-screen", this.onResume);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    powerMonitor.off("resume", this.onResume);
    powerMonitor.off("unlock-screen", this.onResume);
  }
}

module.exports = { KhepreeHeartbeatService };
