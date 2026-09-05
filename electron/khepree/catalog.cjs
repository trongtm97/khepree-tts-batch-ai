/**
 * Must match Khepree catalog registration
 * (seed + scripts/register-tts-batch-ai-desktop-client.sql).
 */
const KHEPREE_TTS_BATCH_CATALOG = {
  productSlug: "khepree-tts-batch-ai",
  clientId: "khepree-tts-batch-ai-desktop",
  redirectUri: "khepreettsbatchai://auth/callback",
  protocol: "khepreettsbatchai",
  accessFeatureKey: "tts_batch_ai.access",
  productPath: "/vi/products/khepree-tts-batch-ai",
  plans: [
    {
      slug: "trial",
      nameVi: "Dùng thử",
      nameEn: "Trial",
      amountMinor: 0,
      currency: "VND",
      accessTermDays: 1,
      internalCode: "TTS_BATCH_AI_FREE_TRIAL",
    },
    {
      slug: "month",
      nameVi: "Tháng",
      nameEn: "Monthly",
      amountMinor: 49_000,
      currency: "VND",
      accessTermDays: 30,
      internalCode: "TTS_BATCH_AI_MONTHLY",
    },
    {
      slug: "year",
      nameVi: "Năm",
      nameEn: "Yearly",
      amountMinor: 499_000,
      currency: "VND",
      accessTermDays: 365,
      internalCode: "TTS_BATCH_AI_YEARLY",
    },
  ],
};

module.exports = { KHEPREE_TTS_BATCH_CATALOG };
