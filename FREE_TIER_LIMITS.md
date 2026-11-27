# Free-tier limits verified

Checked against provider documentation on **26 November 2026**. Provider quotas can change; confirm the linked pages and your account dashboard before launch.

| Service | Free allowance checked | Effect on Saharsa News |
|---|---|---|
| Cloudflare Pages | Up to 500 builds/month, one concurrent build, 20-minute build timeout, 20,000 files/site and 25 MiB/file. Static asset requests are free/unlimited. Pages Functions invoke Workers and share the 100,000/day Workers Free request cap. | Suitable for the static portal/admin shell. Keep API-backed routes narrow so static traffic stays static. |
| Cloudflare Workers | 100,000 requests/day; 10 ms CPU per HTTP request and Cron invocation; 128 MB memory; 50 subrequests/request; 5 Cron triggers/account. | Enough for a small API, but not a promise for heavy work. RSS batches are small; video encoding is excluded. Gemini/Atlas network wait does not count as CPU, but parsing, crypto and JSON do. |
| MongoDB Atlas Free (M0) | 512 MB total data + indexes, 500 concurrent connections, 100 operations/second, one Free cluster/project, and automatic pause after 30 days with no connections. | Store article text and metadata; put media in Cloudinary. Export backups. First request after inactivity may be delayed while the cluster resumes. |
| GitHub Actions | Standard runners are free for public repositories. GitHub Free includes 2,000 minutes/month for private repos. Scheduled runs can be delayed/dropped under high load; schedules on public repos are disabled after 60 days without repository activity. | The 3-hour discovery workflow should fit comfortably if each run stays short. It is best-effort scheduling, not a newsroom SLA. |
| Cloudinary Free | 25 monthly credits shared across transformations, storage and bandwidth. One credit equals 1,000 transformations OR 1 GB storage OR 1 GB image bandwidth (resources consume credits together). | Suitable for a small number of article images. Video storage/transcoding/delivery can consume the allowance quickly; usage must be watched. |
| Gemini API | Free-of-charge token access exists for selected models, but exact quotas are model/project/tier dependent. The free-tier terms say submitted content may be used to improve Google products. | Draft generation is optional and manual. Never send sensitive personal information or unverified crime details. Do not assume quota or availability. |
| Cloudflare DNS / SSL | Free authoritative DNS and Universal SSL are offered on the Free plan. | A `*.pages.dev` hostname can be used without buying a domain. A custom domain/registration still costs money unless already owned. |

## The free stack is not a 24/7 publishing guarantee

- Workers Free Cron is limited to **10 ms CPU per invocation**. The cron handler processes one source to keep work bounded; if it exceeds the cap, GitHub Actions is the fallback discovery runner. Monitor both logs.
- Admin setup/login uses PBKDF2-SHA-256 password hashing (210,000 rounds). Cloudflare notes heavier authentication workloads can use 10–20 ms, so these routes may exceed the Free CPU cap on some executions. This cannot be confirmed without deploying against a real Cloudflare account. Treat admin authentication as a launch blocker until setup/login succeeds in production; if Error 1102 occurs, move admin identity to Cloudflare Access with server-side JWT validation or increase the Worker CPU allowance (the latter may require a paid plan). Do not weaken password hashing to force it under the cap.
- The Worker uses direct Atlas connections. Cloudflare documents roughly 300 ms connection overhead per request for a plain Worker; a Durable Object can pool but adds another moving part. At low volume the direct approach is simpler.
- Atlas M0 has no contractual uptime/SLA and can pause after 30 idle days. “Always on” cannot be promised at zero cost.
- Free Gemini availability and rates can change. AI drafts are never marked verified or published automatically.
- Cloudinary free credits do not guarantee an always-on Reels factory. FFmpeg and TTS work is not included in this deployment. Social publishing stays off until Meta app review, eligible accounts, permissions and secrets are confirmed.
- GitHub scheduled actions are best effort. Keep the Cloudflare Cron as a secondary trigger and use job idempotency/deduplication.

## Official provider sources

- [Cloudflare Pages limits](https://developers.cloudflare.com/pages/platform/limits/)
- [Cloudflare Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
- [Cloudflare Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)
- [Cloudflare Pages Functions pricing](https://developers.cloudflare.com/pages/functions/pricing/)
- [MongoDB Atlas Free cluster limits](https://www.mongodb.com/docs/atlas/reference/free-shared-limitations/)
- [MongoDB Atlas storage FAQ](https://www.mongodb.com/docs/atlas/reference/faq/storage/)
- [MongoDB in Cloudflare Workers](https://developers.cloudflare.com/workers/databases/third-party-integrations/mongodb/)
- [GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions)
- [GitHub Actions schedule syntax and limits](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#onschedule)
- [Cloudinary plan credits](https://cloudinary.com/documentation/billing_and_plans)
- [Gemini API pricing/free tier](https://ai.google.dev/gemini-api/docs/pricing)
- [Cloudflare DNS FAQ](https://developers.cloudflare.com/dns/faq/)
- [Cloudflare plans and Universal SSL](https://www.cloudflare.com/plans/)
