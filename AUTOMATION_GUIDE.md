# Automation guide

## What runs now

RSS discovery can start from a Cloudflare hourly Cron Trigger, an authenticated dashboard request, or the GitHub Actions fallback every three hours. Each worker execution fetches a small bounded batch of enabled sources. GitHub Actions calls `POST /api/automation/discover` with the shared secret and retries transient failures. Cloudflare Worker CPU is only 10 ms on Free, so Cron batches are deliberately small; if parsing or Mongo operations exceed the limit, use the GitHub runner path and inspect its job log.

Items are normalized for obvious Saharsa/Bihar relevance, deduplicated by a stable source/link hash, stored as articles with source attribution, and placed into `NEEDS_VERIFICATION`. The Worker records job state and source success/error timestamps. No item is automatically verified or published.

An editor can request a Gemini Hindi draft from an existing item. It is saved separately as `NEEDS_EDITOR_REVIEW`; AI output is not a verification record. A signed Cloudinary upload allows the admin form to store a featured image without exposing the Cloudinary API secret.

## Editorial safety

- Review source permission, licensing and fetch limits before adding it.
- Imported source text is retained as source material; editors must produce original reporting and attribution before publishing.
- Crime, death, accidents and allegations need human review and are blocked from the simple approval transition.
- Never publish an item on the basis of API/RSS availability alone.
- Verify date, location, source authority, independent confirmation and privacy impact.

## Planned workflow

`scheduled source fetch → parse → normalize → deduplicate → location relevance → source evidence → verification record → original Hindi draft → human/policy approval → owned site publish → notification/social queue`

Each future stage should be persisted as an idempotent job with retry limits and audit records. Automatic publication should remain disabled until the source allowlist, verification threshold and exception policy are configured and reviewed.
