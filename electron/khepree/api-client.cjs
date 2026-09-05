const { createHash, randomUUID } = require("node:crypto");

class KhepreeApiClient {
  constructor(apiBase, deviceIdentity) {
    this.apiBase = apiBase;
    this.deviceIdentity = deviceIdentity;
  }

  exchange(input) {
    return this.json("/desktop/auth/exchange", {
      method: "POST",
      body: {
        ...input,
        installationId: this.deviceIdentity.installationId,
        devicePublicKey: this.deviceIdentity.publicKeyPem,
        platform: process.platform,
      },
    });
  }

  refresh(sessionPublicId, refreshToken) {
    const path = "/desktop/auth/refresh";
    const body = { sessionPublicId, refreshToken };
    return this.json(path, {
      method: "POST",
      body: {
        ...body,
        deviceProof: this.buildProof("POST", path, body),
      },
    });
  }

  activate(input) {
    return this.json("/desktop/activate", {
      method: "POST",
      accessToken: input.accessToken,
      body: {
        clientId: input.clientId,
        installationId: this.deviceIdentity.installationId,
        devicePublicKey: this.deviceIdentity.publicKeyPem,
        platform: process.platform,
        appVersion: input.appVersion,
      },
    });
  }

  me(accessToken) {
    return this.json("/desktop/me", { method: "GET", accessToken });
  }

  listPlans(accessToken, clientId, locale = "vi") {
    const qs = new URLSearchParams({ clientId, locale });
    return this.json(`/desktop/plans?${qs.toString()}`, { method: "GET", accessToken });
  }

  createCheckout(input) {
    return this.json("/desktop/checkout", {
      method: "POST",
      accessToken: input.accessToken,
      body: {
        clientId: input.clientId,
        planPublicId: input.planPublicId,
        pricePublicId: input.pricePublicId,
        locale: input.locale ?? "vi",
      },
    });
  }

  heartbeat(sessionPublicId, accessToken) {
    const path = "/desktop/heartbeat";
    const body = { sessionPublicId };
    return this.json(path, {
      method: "POST",
      accessToken,
      body: {
        ...body,
        deviceProof: this.buildProof("POST", path, body),
      },
    });
  }

  async logout(sessionPublicId, accessToken) {
    await this.json("/desktop/auth/logout", {
      method: "POST",
      accessToken,
      body: { sessionPublicId },
    }).catch(() => undefined);
  }

  buildProof(method, path, body) {
    const bodyJson = JSON.stringify(body);
    const timestamp = Date.now();
    const nonce = randomUUID();
    const bodySha256 = createHash("sha256").update(bodyJson).digest("hex");
    const canonical = [timestamp, nonce, method, path, bodySha256].join("\n");
    return {
      timestamp,
      nonce,
      signature: this.deviceIdentity.signCanonical(canonical),
      method,
      path,
      bodySha256,
    };
  }

  async json(path, opts) {
    const res = await fetch(`${this.apiBase}${path}`, {
      method: opts.method,
      headers: {
        "content-type": "application/json",
        ...(opts.accessToken ? { authorization: `Bearer ${opts.accessToken}` } : {}),
      },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
    const text = await res.text();
    const raw = text ? JSON.parse(text) : {};
    if (!res.ok) {
      const code = raw?.error?.code ?? `HTTP_${res.status}`;
      throw new Error(code);
    }
    return raw && typeof raw === "object" && "data" in raw ? raw.data : raw;
  }
}

module.exports = { KhepreeApiClient };
