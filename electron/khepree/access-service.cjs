const { app, shell } = require("electron");
const { KHEPREE_TTS_BATCH_CATALOG } = require("./catalog.cjs");
const { getKhepreeConfig, productPublicUrl } = require("./config.cjs");
const { createPkceTransaction } = require("./pkce.cjs");
const { DeviceIdentityService } = require("./device-identity.cjs");
const { SessionStore } = require("./session-store.cjs");
const { KhepreeApiClient } = require("./api-client.cjs");
const { verifyLease } = require("./lease-verifier.cjs");

class KhepreeAccessService {
  constructor() {
    this.config = getKhepreeConfig();
    this.identity = new DeviceIdentityService();
    this.sessions = new SessionStore();
    this.api = new KhepreeApiClient(this.config.apiBase, this.identity);
    this.state = {
      status: "BOOTING",
      features: {},
      productSlug: this.config.productSlug,
      productUrl: productPublicUrl(this.config.website, this.config.productPath),
      catalogHint: KHEPREE_TTS_BATCH_CATALOG.plans.map((p) => ({
        slug: p.slug,
        nameVi: p.nameVi,
        amountMinor: p.amountMinor,
        currency: p.currency,
        accessTermDays: p.accessTermDays,
      })),
    };
    this.tx = undefined;
    this.accessToken = undefined;
    this.sessionPublicId = undefined;
    this.lease = undefined;
    this.listeners = new Set();
  }

  get publicState() {
    return structuredClone(this.state);
  }

  onChange(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async initialize() {
    if (this.config.devMock) {
      this.setState({
        status: "ACTIVE",
        user: { name: "Development User", email: "dev@local" },
        planSlug: "dev",
        productSlug: this.config.productSlug,
        productUrl: productPublicUrl(this.config.website, this.config.productPath),
        features: { [this.config.accessFeatureKey]: true },
        catalogHint: this.state.catalogHint,
        checkoutAvailable: false,
        message: "KHEPREE_DEV_MOCK enabled",
      });
      return;
    }

    const saved = this.sessions.load();
    if (!saved) {
      this.setState({
        status: "AUTH_REQUIRED",
        features: {},
        productSlug: this.config.productSlug,
        productUrl: productPublicUrl(this.config.website, this.config.productPath),
        catalogHint: this.state.catalogHint,
      });
      return;
    }

    this.setState({
      status: "VALIDATING_SESSION",
      features: {},
      productSlug: this.config.productSlug,
      productUrl: productPublicUrl(this.config.website, this.config.productPath),
      catalogHint: this.state.catalogHint,
    });
    try {
      const refreshed = await this.api.refresh(saved.sessionPublicId, saved.refreshToken);
      this.accessToken = refreshed.accessToken;
      this.sessionPublicId = saved.sessionPublicId;
      this.sessions.save(saved.sessionPublicId, refreshed.refreshToken);
      if (refreshed.lease) this.acceptLease(refreshed.lease);
      await this.refreshMe();
    } catch (error) {
      console.warn("Khepree cold start validation failed", error);
      this.accessToken = undefined;
      this.sessionPublicId = undefined;
      this.lease = undefined;
      this.setState({
        status: "OFFLINE_COLD_START",
        features: {},
        productSlug: this.config.productSlug,
        productUrl: productPublicUrl(this.config.website, this.config.productPath),
        catalogHint: this.state.catalogHint,
        message: String(error),
      });
    }
  }

  async startLogin() {
    this.tx = createPkceTransaction();
    const url = new URL(`${this.config.accountBase}/desktop/authorize`);
    url.searchParams.set("client_id", this.config.clientId);
    url.searchParams.set("redirect_uri", this.config.redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("code_challenge", this.tx.challenge);
    url.searchParams.set("code_challenge_method", "S256");
    url.searchParams.set("state", this.tx.state);
    await shell.openExternal(url.toString());
  }

  async handleCallback(rawUrl) {
    try {
      if (!this.tx) throw new Error("NO_AUTH_TRANSACTION");
      if (Date.now() - this.tx.createdAt > 10 * 60_000) throw new Error("AUTH_TRANSACTION_EXPIRED");
      const url = new URL(rawUrl);
      if (
        url.protocol !== `${KHEPREE_TTS_BATCH_CATALOG.protocol}:` ||
        url.hostname !== "auth" ||
        url.pathname !== "/callback"
      ) {
        throw new Error("INVALID_AUTH_CALLBACK");
      }
      if (url.searchParams.get("state") !== this.tx.state) throw new Error("AUTH_STATE_MISMATCH");
      const code = url.searchParams.get("code");
      if (!code) throw new Error("AUTH_CODE_MISSING");

      this.setState({
        ...this.state,
        status: "VALIDATING_SESSION",
        message: "Đang xác thực đăng nhập Khepree…",
      });

      const result = await this.api.exchange({
        clientId: this.config.clientId,
        code,
        codeVerifier: this.tx.verifier,
        redirectUri: this.config.redirectUri,
      });
      this.tx = undefined;
      this.accessToken = result.accessToken;
      this.sessionPublicId = result.sessionPublicId;
      this.sessions.save(result.sessionPublicId, result.refreshToken);
      if (result.lease) this.acceptLease(result.lease);
      await this.ensureActivated();
      await this.refreshMe();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn("Khepree auth callback failed", error);
      this.setState({
        ...this.state,
        status: "AUTH_REQUIRED",
        features: {},
        message,
      });
      throw error;
    }
  }

  async logout() {
    if (this.sessionPublicId && this.accessToken) {
      await this.api.logout(this.sessionPublicId, this.accessToken);
    }
    this.sessions.clear();
    this.accessToken = undefined;
    this.sessionPublicId = undefined;
    this.lease = undefined;
    this.setState({
      status: "AUTH_REQUIRED",
      features: {},
      productSlug: this.config.productSlug,
      productUrl: productPublicUrl(this.config.website, this.config.productPath),
      catalogHint: this.state.catalogHint,
    });
  }

  async heartbeat() {
    if (this.config.devMock || this.state.status !== "ACTIVE") return;
    if (!this.sessionPublicId || !this.accessToken) return;
    const result = await this.api.heartbeat(this.sessionPublicId, this.accessToken);
    if (result.state !== "ACTIVE") {
      this.setState({
        ...this.state,
        status: mapMachineState(result.state),
        features: {},
        message: `Khepree heartbeat: ${result.state}`,
      });
    }
  }

  async openProductPage() {
    await shell.openExternal(productPublicUrl(this.config.website, this.config.productPath));
  }

  async startCheckout(planPublicId, pricePublicId) {
    if (!this.accessToken) throw new Error("ACCESS_TOKEN_MISSING");
    const result = await this.api.createCheckout({
      accessToken: this.accessToken,
      clientId: this.config.clientId,
      planPublicId,
      pricePublicId,
      locale: "vi",
    });
    await shell.openExternal(result.handoffUrl);
  }

  async refreshOffers() {
    if (!this.accessToken) return [];
    try {
      const res = await this.api.listPlans(this.accessToken, this.config.clientId, "vi");
      this.setState({ ...this.state, offers: res.plans });
      return res.plans;
    } catch (error) {
      console.warn("Khepree plans fetch failed", error);
      return this.state.offers ?? [];
    }
  }

  assertProductAccess() {
    if (this.state.status !== "ACTIVE") {
      // Surface the real gate status so UI can explain ENTITLEMENT_MISSING vs auth/offline.
      throw new Error(this.state.status || "KHEPREE_ACCESS_REQUIRED");
    }
    const access = this.state.features[this.config.accessFeatureKey];
    if (access === false) {
      throw new Error(`KHEPREE_FEATURE_NOT_ALLOWED:${this.config.accessFeatureKey}`);
    }
  }

  async ensureActivated() {
    if (!this.accessToken) return;
    try {
      const activated = await this.api.activate({
        clientId: this.config.clientId,
        accessToken: this.accessToken,
        appVersion: app.getVersion(),
      });
      if (activated.lease) this.acceptLease(activated.lease);
    } catch (error) {
      const code = String(error);
      if (!code.includes("ENTITLEMENT_MISSING")) {
        console.warn("Khepree activate:", error);
      }
    }
  }

  acceptLease(lease) {
    verifyLease(lease, {
      publicKeyPem: this.config.signingPublicKey,
      expectedKeyId: this.config.signingKeyId,
      expectedProductSlug: this.config.productSlug,
      expectedDeviceId: lease.payload.deviceId,
      requireSignature: Boolean(this.config.signingPublicKey) || app.isPackaged,
    });
    this.lease = lease;
  }

  async refreshMe() {
    if (!this.accessToken) throw new Error("ACCESS_TOKEN_MISSING");
    const me = await this.api.me(this.accessToken);
    if (!me.device) {
      await this.ensureActivated();
    }

    const features = {};
    for (const item of me.entitlement?.features ?? []) {
      if (item.value.valueType === "boolean") features[item.key] = item.value.booleanValue;
      if (item.value.valueType === "integer") features[item.key] = item.value.integerValue;
      if (item.value.valueType === "string") features[item.key] = item.value.stringValue;
    }
    if (me.entitlement?.status === "active" && features[this.config.accessFeatureKey] === undefined) {
      features[this.config.accessFeatureKey] = true;
    }

    const ent = me.entitlement;
    const status = !ent
      ? "ENTITLEMENT_MISSING"
      : ent.status === "active"
        ? "ACTIVE"
        : ent.status === "expired"
          ? "ENTITLEMENT_EXPIRED"
          : ent.status === "suspended"
            ? "ENTITLEMENT_SUSPENDED"
            : "ERROR";

    let offers = this.state.offers;
    if (status !== "ACTIVE" || me.allowedActions?.checkout || me.allowedActions?.upgrade) {
      try {
        offers = (await this.api.listPlans(this.accessToken, this.config.clientId, "vi")).plans;
      } catch {
        /* keep previous offers */
      }
    }

    this.setState({
      status,
      user: { name: me.user.name, email: me.user.email },
      planSlug: ent?.planSlug ?? me.plan?.planSlug ?? undefined,
      productSlug: me.product?.slug ?? me.client.productSlug ?? this.config.productSlug,
      productUrl: productPublicUrl(this.config.website, this.config.productPath),
      features,
      offers,
      catalogHint: this.state.catalogHint,
      checkoutAvailable: me.billing?.checkoutAvailable ?? me.allowedActions?.checkout ?? false,
      message:
        status === "ENTITLEMENT_MISSING"
          ? "Chưa có bản quyền — đăng nhập lại hoặc mở tab Khepree để kích hoạt dùng thử 1 ngày / mua gói Tháng-Năm."
          : undefined,
    });
  }

  setState(state) {
    this.state = {
      ...state,
      productSlug: state.productSlug ?? this.config.productSlug,
      productUrl:
        state.productUrl ?? productPublicUrl(this.config.website, this.config.productPath),
      catalogHint: state.catalogHint ?? this.state.catalogHint,
    };
    for (const listener of this.listeners) listener(this.publicState);
  }
}

function mapMachineState(state) {
  switch (state) {
    case "ACTIVE":
      return "ACTIVE";
    case "ENTITLEMENT_MISSING":
      return "ENTITLEMENT_MISSING";
    case "ENTITLEMENT_EXPIRED":
      return "ENTITLEMENT_EXPIRED";
    case "ENTITLEMENT_SUSPENDED":
      return "ENTITLEMENT_SUSPENDED";
    case "DEVICE_REMOVED":
      return "DEVICE_REMOVED";
    case "DEVICE_BLOCKED":
      return "DEVICE_BLOCKED";
    case "SESSION_REVOKED":
      return "AUTH_REQUIRED";
    default:
      return "ERROR";
  }
}

module.exports = { KhepreeAccessService };
