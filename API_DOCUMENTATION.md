# API documentation (Cloudflare Worker)

All API paths are proxied from Pages to `saharsa-news-api`. JSON endpoints require the HttpOnly `sn_session` cookie unless called out as public or automation-token endpoints.

Public Pages routes: `GET /`, `GET /article/:slug` (server-rendered NewsArticle schema), `GET /api/public/articles`, `GET /feed.xml`, `GET /sitemap.xml`, `GET /news-sitemap.xml`, and `GET /robots.txt`. Only `PUBLISHED` articles are exposed.

## Health and setup

- `GET /api/health` — Worker/Atlas health (requires MongoDB secret/network access).
- `GET /api/config` — public site, category/location and integration readiness configuration.
- `GET /api/auth/me` — current session and whether initial setup is required.
- `POST /api/auth/setup` — create the first SUPER_ADMIN only. Body: `{ "email": "admin@example.com", "password": "12+ characters" }`.
- `POST /api/auth/login` — body `{ "email", "password" }`; rate-limited.
- `POST /api/auth/logout` — destroy current session.

## Articles (authenticated)

- `GET /api/dashboard` — newsroom counters and failed automation jobs.
- `GET /api/articles?page=1&limit=25&status=NEW&category=सहरसा&location=Kahara` — paginated articles and total.
- `POST /api/articles` — body `{ "title", "body", "category", "location", "sourceUrl?", "sourceName?", "featuredImage?" }`. Sensitive topics enter `NEEDS_VERIFICATION`.
- `PATCH /api/articles/:id` — update `title`, `body`, `summary`, `seoTitle`, `seoDescription`, `category`, `location`, or `featuredImage`. Use an empty image value to remove it; image URLs must be public HTTP(S) URLs.
- `POST /api/articles/:id/status` — body `{ "status": "VERIFIED|APPROVED|PUBLISHED|REJECTED" }`. Publishing requires prior approval; sensitive stories are blocked from the basic approval path.
- `DELETE /api/articles/:id` — editor/admin action.

## Sources and ingestion

- `GET /api/sources` — list configured sources.
- `POST /api/sources` — admin body `{ "name", "url", "type?", "enabled?", "reliability?" }`.
- `PATCH /api/sources/:id` — admin body `{ "enabled": true|false }`.
- `POST /api/ingest` — authenticated manual RSS fetch; imported articles always require verification.
- `POST /api/automation/discover` — machine endpoint requiring `Authorization: Bearer <AUTOMATION_TOKEN>`. Fetches a bounded number of enabled feeds; returns job ID, added count and errors.
- `GET /api/automation/status` — enabled state and recent jobs.
- `PATCH /api/automation/control` — admin body `{ "enabled": true|false }` to pause/resume discovery.
- `GET /api/automation/jobs/:id` — editorial/admin job details.
- `POST /api/ai/draft/:id` — editor-triggered Gemini original-draft generation. Result is stored as `NEEDS_EDITOR_REVIEW`; this does not verify or publish the article.
- `POST /api/media/sign` — editor-only short-lived Cloudinary upload signature. Client uploads the selected image directly to Cloudinary; API secret stays server-side. Cloudinary is optional; editors can also enter a public image URL manually.

## Audit

- `GET /api/audit?limit=50` — SUPER_ADMIN/ADMIN only.

Roles: SUPER_ADMIN, ADMIN, EDITOR and REPORTER. Account invitation/role-management UI is not implemented; only the initial SUPER_ADMIN can be created through public setup. Facebook/Instagram publishing APIs are not implemented yet and are intentionally shown as unavailable even if tokens are set.
