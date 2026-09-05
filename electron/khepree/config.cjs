const { app } = require("electron");
const { KHEPREE_TTS_BATCH_CATALOG } = require("./catalog.cjs");

const PRODUCTION = {
  apiBase: "https://api.khepree.com/api/v1",
  accountBase: "https://account.khepree.com",
  website: "https://khepree.com",
  clientId: KHEPREE_TTS_BATCH_CATALOG.clientId,
  productSlug: KHEPREE_TTS_BATCH_CATALOG.productSlug,
  redirectUri: KHEPREE_TTS_BATCH_CATALOG.redirectUri,
  accessFeatureKey: KHEPREE_TTS_BATCH_CATALOG.accessFeatureKey,
  productPath: KHEPREE_TTS_BATCH_CATALOG.productPath,
};

function getKhepreeConfig() {
  const packaged = app.isPackaged;
  return {
    ...PRODUCTION,
    apiBase: packaged ? PRODUCTION.apiBase : process.env.KHEPREE_API_BASE ?? PRODUCTION.apiBase,
    accountBase: packaged
      ? PRODUCTION.accountBase
      : process.env.KHEPREE_ACCOUNT_BASE ?? PRODUCTION.accountBase,
    website: packaged ? PRODUCTION.website : process.env.KHEPREE_WEBSITE ?? PRODUCTION.website,
    clientId: packaged ? PRODUCTION.clientId : process.env.KHEPREE_CLIENT_ID ?? PRODUCTION.clientId,
    productSlug: packaged
      ? PRODUCTION.productSlug
      : process.env.KHEPREE_PRODUCT_SLUG ?? PRODUCTION.productSlug,
    signingPublicKey: process.env.KHEPREE_LICENSE_SIGNING_PUBLIC_KEY ?? "",
    signingKeyId: process.env.KHEPREE_LICENSE_SIGNING_KEY_ID ?? "k1",
    devMock: !packaged && process.env.KHEPREE_DEV_MOCK === "1",
  };
}

function productPublicUrl(website, productPath) {
  return `${website.replace(/\/$/, "")}${productPath}`;
}

module.exports = { getKhepreeConfig, productPublicUrl };
