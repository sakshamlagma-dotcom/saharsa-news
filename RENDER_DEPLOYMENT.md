# Saharsa News on Render

This service runs the existing Express API and frontend from the repository root. Runtime data is stored in MongoDB Atlas; the service does not create, reset, or remove a database at startup.

The project declares Node.js `>=20.19.0 <27`; the MongoDB Node driver 7.x requires Node.js 20.19 or newer. The check and integration suite were also run under Node.js 26.13.1.

## Render Web Service settings

Connect `sakshamlagma-dotcom/saharsa-news` and deploy branch `main` with:

| Setting | Value |
|---|---|
| Root Directory | repository root (leave blank) |
| Runtime | Node |
| Build Command | `npm ci --omit=dev` |
| Start Command | `npm start` |
| Health Check Path | `/api/health` |

The server listens on Render's `PORT` and binds to `0.0.0.0`. Render supplies `PORT`; do not add a separate `PORT` secret.

## Environment variables

Add these under **Render Dashboard → service → Environment** before deploying:

| Name | Value |
|---|---|
| `NODE_ENV` | `production` |
| `MONGODB_URI` | Atlas connection URI (mark as secret; never put it in Git) |
| `MONGODB_DB` | `saharsa_news` (optional; this is the code default) |
| `SESSION_SECRET` | A unique random value of at least 32 characters (keep it in Render only) |

The first successful service startup creates indexes only in the `render_*` collections. It does not drop collections or overwrite existing records. Authentication and article/session records are stored in those namespaced collections, separately from the Cloudflare Worker collections.

## Atlas network access

After creating the Render service, open **Render Dashboard → service → Connect → Outbound** and copy the service's outbound CIDR ranges for its region. Add those ranges to the Atlas project's **Network Access** IP access list. Render's ranges are regional and shared by services in the same region; they can be used instead of opening Atlas access to every IP. See [Render outbound IP addresses](https://render.com/docs/outbound-ip-addresses).

Use a dedicated Atlas database user with access limited to the `saharsa_news` database. Keep its URI only in Render's environment settings or a local ignored `.env` file.

## Existing SQLite data

The old SQLite database is gitignored and is not copied by a Git push. The application leaves it intact. To review an existing SQLite file without connecting to Atlas, run locally:

```sh
npm ci --include=dev
npm run migrate:sqlite -- --source data/saharsa.sqlite
```

The default is a read-only dry run. It reports counts only. After reviewing the counts, set `MONGODB_URI` and, if needed, `MONGODB_DB` in your local environment without sharing them in chat, then run:

```sh
npm run migrate:sqlite -- --source data/saharsa.sqlite --apply
```

The import uses insert-only upserts: existing MongoDB documents are left untouched, and the SQLite source is opened read-only and is never deleted. It copies users (including existing bcrypt password hashes), articles, news sources, audit records, and sessions. Run it before launching the new service if the SQLite file contains records that must be available there.

The workspace SQLite file checked during this migration currently has zero rows in those five tables. It remains in place. This does not inspect any separate SQLite file that may exist on another host.

## Verify the MongoDB connection

With `MONGODB_URI` set in the local environment, `npm run check:mongodb` performs a MongoDB ping and prints only success or a sanitized error class/code. The deployed `/api/health` endpoint also pings MongoDB; it returns HTTP 200 only when the database is reachable and HTTP 503 otherwise.

After Render deploys, check the service URL at `/api/health`, then check Render logs for the startup result. Never include a connection URI or password in logs, issue reports, or source files.

Startup logs emit a JSON `startup_config` record containing only Node version, whether each required setting is present/valid, URI scheme, and whether `PORT` is valid. Failures use stable codes such as `MISSING_MONGODB_URI`, `INVALID_SESSION_SECRET`, `MONGODB_CONNECT_FAILED`, or `HTTP_LISTEN_FAILED`. They never print the URI, secret, or raw driver error message.

## Free instance behavior

Render currently offers Free web services for prototypes. Free services can spin down after inactivity and have no persistent local disk; this app stores its application data in Atlas, so its records do not depend on Render's local filesystem. Render documents additional free-instance limits and advises against using them for production; review [Render's Free instance limits](https://render.com/docs/free) before choosing the plan.
