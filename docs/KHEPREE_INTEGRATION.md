# Khepree licensing integration

This client follows the same security model as Livestream AI / DESKTOP-INTEGRATION.

Production endpoints:

- API: `https://api.khepree.com/api/v1`
- Account: `https://account.khepree.com`
- Authorize: `https://account.khepree.com/desktop/authorize`
- Product page: `https://khepree.com/vi/products/khepree-tts-batch-ai`

## Registered identity (must match platform catalog)

| Field | Value |
|-------|-------|
| product slug | `khepree-tts-batch-ai` |
| desktop client id | `khepree-tts-batch-ai-desktop` |
| redirect URI | `khepreettsbatchai://auth/callback` |
| access feature | `tts_batch_ai.access` |

Source of truth in this repo: `electron/khepree/catalog.cjs`.

## Commercial plans (catalog)

| Plan slug | Price | Term | Internal code |
|-----------|-------|------|---------------|
| `trial` | free | 1 day | `TTS_BATCH_AI_FREE_TRIAL` |
| `month` | 49.000 VND | 30 days | `TTS_BATCH_AI_MONTHLY` |
| `year` | 499.000 VND | 365 days | `TTS_BATCH_AI_YEARLY` |

Paid plans: `POST /desktop/checkout` → browser handoff. Free trial has no price row; platform `POST /desktop/activate` auto-grants trial once per user when entitlement is missing.

## Expected desktop flow

1. Generate installation UUID and Ed25519 device key pair.
2. PKCE + open Khepree account authorize URL.
3. Custom protocol callback `khepreettsbatchai://auth/callback`.
4. Exchange code → activate device (auto-grants free trial once if needed) → `/desktop/me`.
5. Only `ACTIVE` + `tts_batch_ai.access` unlocks TTS synthesis.
6. Heartbeat while active; checkout for month/year plans.

## Windows deep-link note

Unpackaged Electron must register the protocol with `execPath` + app entry
(`electron/khepree/auth-protocol.cjs`). Bare `setAsDefaultProtocolClient(scheme)`
makes Windows launch `electron.exe` alone — OAuth callback never reaches the app.
Restart the app once after pulling this fix so the registry command is rewritten.

## Platform registration

- seed: `packages/db/src/seed/index.ts` (`pnpm db:seed`)
- production SQL: `scripts/register-tts-batch-ai-desktop-client.sql`

Dev mock: `KHEPREE_DEV_MOCK=1` (unpackaged only).
