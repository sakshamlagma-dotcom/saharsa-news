# Saharsa News

Hindi-first local newsroom with two run targets: the earlier local Express/SQLite prototype (`server.js`) and the new zero-budget deployment target (`public/` Cloudflare Pages + `worker/` Cloudflare Worker/Hono + MongoDB Atlas). The Cloudflare target is the deployment architecture described in this update.

## Cloudflare architecture

`public/` contains the public site and admin UI. Pages Functions proxy `/api/*` to `saharsa-news-api` through a service binding and render article pages, RSS and sitemaps. `worker/` contains the API, Atlas storage, admin/session auth, RSS discovery, AI draft endpoint, signed Cloudinary uploads, automation settings and Cron Trigger. GitHub Actions deploys both and runs a retryable discovery schedule. See [DEPLOYMENT.md](./DEPLOYMENT.md).

## Roadmap

1. **Foundation (Cloudflare target):** first-admin setup, login/session, roles, Atlas-backed articles/sources/audit, dashboard and public pages.
2. **Discovery:** limited RSS/Atom fetch, Saharsa relevance and deterministic deduplication, scheduled Worker/GitHub triggers, retry and job history. Items remain unverified.
3. **AI/image starter:** editor-triggered Gemini draft stored for review and signed Cloudinary image upload. AI never verifies or publishes.
4. **Owned publishing:** public article pages, sitemap, News sitemap, RSS and SEO metadata. Editors progress articles through VERIFIED → APPROVED → PUBLISHED.
5. **Social publishing (pending):** official Meta API queue, eligibility/token status, retries and audit history.
6. **Reels (pending):** licensed assets, Hindi TTS, subtitles, FFmpeg templates and gated publishing.
7. **Production hardening:** backups, monitoring, analytics and high-volume testing.

## Run locally

For the local legacy prototype, use the local Express setup below. For Pages/Workers development and deployment, use [DEPLOYMENT.md](./DEPLOYMENT.md).

1. Install Node.js 20+.
2. Run `npm install` in this folder.
3. Copy `.env.example` to `.env`.
4. Run `npm start` and visit `http://localhost:4310`.

SQLite files are stored under `data/` for the legacy local target. The deployed Cloudflare target uses MongoDB Atlas; local SQLite content is not automatically migrated to Atlas.

## Current functions

- Public newsroom at `/`, admin UI at `/admin`, Pages Functions SSR article pages, RSS and sitemaps.
- Cloudflare Worker API backed by Atlas documents and session collection.
- First SUPER_ADMIN setup, role checks, admin login and login-attempt throttling.
- Manual and scheduled RSS ingestion with bounded feed batches, local relevance classification, hash-based duplicate key and job/error records.
- Human-gated article status transitions; sensitive stories cannot use the standard approval path.
- Editor-triggered Gemini drafts and signed Cloudinary uploads (only active when secrets are configured).
- Automation pause/resume control, source enable/disable, latest job state in admin UI.
- GitHub Actions deploy and scheduled discovery workflow.

## Not production-complete yet

This is not the full autonomous platform. Multi-source fact verification, automatic publishing, Meta APIs, TTS/video generation, email/Telegram, analytics and full role/user management remain pending. GitHub/Cloudflare/Atlas accounts and their secrets are needed before real cloud deployment; none are embedded in the repo. Read [FREE_TIER_LIMITS.md](./FREE_TIER_LIMITS.md) for quota constraints.

Run `npm run check`, `npm test`, and `npm audit --omit=dev` for syntax, integration-flow, and production-dependency checks.

See [API_DOCUMENTATION.md](./API_DOCUMENTATION.md), [AUTOMATION_GUIDE.md](./AUTOMATION_GUIDE.md), and [DEPLOYMENT.md](./DEPLOYMENT.md).
