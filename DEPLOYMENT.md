# Zero-budget Cloudflare deployment

The repository now has a Pages static site/Functions layer and a separate Cloudflare Worker API backed by Atlas. It is configured for free-tier use; provider accounts and secrets are still required before it can be deployed. No VPS or paid Render service is used.

## One-time provider setup

1. Create a Cloudflare Free account and a GitHub repository. For a private GitHub Free repository, Actions includes 2,000 standard runner minutes/month; public standard runners are free, but public scheduled workflows can be disabled after 60 days of no repository activity.
2. Create a MongoDB Atlas Free cluster (M0), choose the closest supported region, create a database user with access only to the `saharsa_news` database, and copy the `mongodb+srv://` URI. M0 has a hard 512 MB data+index limit.
3. In Atlas Network Access, allow the Worker to connect. Cloudflare Worker egress does not have a single fixed IPv4 allowlist for this setup. The broad `0.0.0.0/0` access-list entry may be necessary; use a strong dedicated database password and least-privilege user, and do not reuse the Atlas owner account. This is a security tradeoff of direct public Worker-to-Atlas connectivity on the free architecture.
4. Create a Cloudflare API token with account permissions to edit Workers and Pages. Keep the token only in GitHub Actions secrets.
5. Optional: create a Cloudinary Free account and a Gemini API key. Free Gemini requests may have content-use terms; omit sensitive data from prompts.

## Initial deploy

From this project directory:

```sh
cd worker
npm ci
npx wrangler login
npx wrangler secret put MONGODB_URI
npx wrangler secret put SESSION_SECRET
npx wrangler secret put AUTOMATION_TOKEN
# Optional secrets:
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put CLOUDINARY_CLOUD_NAME
npx wrangler secret put CLOUDINARY_API_KEY
npx wrangler secret put CLOUDINARY_API_SECRET
npx wrangler deploy
```

`SESSION_SECRET` and `AUTOMATION_TOKEN` must be long random strings. The Worker config deploys the hourly Cron Trigger. Add at least one permitted RSS source after creating the first admin.

Create the Pages project once, then deploy:

```sh
cd ..
./worker/node_modules/.bin/wrangler pages project create saharsa-news --production-branch main
./worker/node_modules/.bin/wrangler pages deploy public --project-name saharsa-news --branch main
```

The Pages service binding named `API` points to the deployed Worker `saharsa-news-api`. The site will be available at `https://saharsa-news.pages.dev`; Pages supplies HTTPS. A custom domain is optional and domain registration may cost money.

## GitHub Actions setup

Push this repository to GitHub with the default branch named `main`. Add repository Actions secrets:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `SAHARSA_API_BASE_URL` — the Worker URL, e.g. `https://saharsa-news-api.<your-subdomain>.workers.dev`
- `AUTOMATION_TOKEN` — exactly the same value set as the Worker secret

`.github/workflows/deploy.yml` deploys the Worker and Pages site on changes to `main`. `.github/workflows/discover.yml` triggers bounded discovery every three hours, with curl retries; run it manually from Actions for a first fetch. GitHub schedules are best effort and the Worker Cron is a secondary schedule.

## First run

1. Open `https://saharsa-news.pages.dev/admin` and create the first SUPER_ADMIN account.
2. Add authorized RSS sources in the News Sources panel. Respect source terms, robots rules, attribution and feed rate limits.
3. Verify Automation Control shows enabled, then run “अभी RSS जांचें”. Imported stories stay in verification.
4. Configure Cloudinary/Gemini secrets only if needed. Confirm integrations in the dashboard.
5. Add the Cloudflare Worker URL and automation token to GitHub secrets so scheduled discovery can run.

## Local Cloudflare development

Use two terminals. Start the Worker from `worker/` with local secrets in an ignored `.dev.vars` file copied from `.dev.vars.example`:

```sh
cd worker
npm ci
npm run dev
```

In another terminal from the project root:

```sh
./worker/node_modules/.bin/wrangler pages dev public
```

Local API calls need a reachable Atlas cluster. Never commit `.dev.vars`, credentials, Atlas URI, Cloudinary secret or Meta tokens.

## Secrets and rotation

Set or rotate Worker secrets with `npx wrangler secret put SECRET_NAME` from `worker/`. GitHub Actions secrets are separate copies. If a secret is exposed, rotate it at its provider and update both locations. No secret belongs in `public/`, HTML, JavaScript, `wrangler.toml`, or Git history.

See [FREE_TIER_LIMITS.md](./FREE_TIER_LIMITS.md) for verified quotas, tradeoffs and official links. Keep a periodic Atlas export; M0 is not a backup service.
