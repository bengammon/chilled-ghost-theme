# Training data pipeline

Pulls workout data from Hevy, derives a small `stats.json`, and writes it somewhere
nginx can serve. The theme fetches that one file client-side.

```
Hevy REST API  ->  cron on the droplet  ->  /var/www/hevy/stats.json  ->  /training.json
```

The `hevy-mcp` server used in Claude Desktop is **not** part of this. That is a local
stdio process, it does not expose `body_measurements`, and it renames API fields
(`weight` for `weight_kg`, `startTime` for `start_time`). This script talks to
`api.hevyapp.com/v1` directly.

## Layout

| File | Purpose |
|---|---|
| `fetch.js` | Orchestrator. Sync, derive, guard, write, verify, alert. |
| `config.js` | Exercise classification, thresholds, milestone scales. |
| `lib/api.js` | REST client: retries, error classification, pagination. |
| `lib/bodyweight.js` | Dated bodyweight series and the at-or-before lookup. |
| `lib/tonnage.js` | Weight moved, per set and per workout. |
| `lib/stats.js` | Streaks, milestones, comparison, day grid. |
| `lib/store.js` | Atomic writes, cache merge, weekly backup. |
| `lib/validate.js` | Shape validation and the sanity guards. |
| `lib/notify.js` | Brevo email and the healthchecks.io ping. |
| `test.js` | `node --test tools/hevy/` — no dependencies. |

Written at runtime, never committed: `cache.json` (accumulated workouts),
`state.json` (failure count, last tonnage), `stats.json` (the public file).

## The two dangerous inputs

Both silently rewrite history if changed after the fact, which is the one thing this
pipeline must never do.

**The per-limb list in `config.js`.** Six exercises log the weight *one limb* moved
and are doubled. Adding or removing one re-prices every past session. If a new
unilateral exercise starts appearing, classify it *before* its first session is
counted.

**The bodyweight series.** Pull-ups and dips are priced at the bodyweight current on
the day they were performed, looked up from `GET /v1/body_measurements`. A single
constant would make lifetime tonnage drop the first time a lighter weight was logged.

## Setup

```bash
sudo mkdir -p /var/www/hevy
sudo chown "$USER" /var/www/hevy
rsync -av --exclude node_modules tools/hevy/ /var/www/hevy/
```

Create `/var/www/hevy/.env` (chmod 600, never committed):

```
HEVY_API_KEY=...            # hevy.com/settings?developer — Hevy Pro only
BREVO_API_KEY=...
ALERT_EMAIL_TO=hello@bengammon.co.uk
ALERT_EMAIL_FROM=hello@bengammon.co.uk
HEALTHCHECKS_URL=https://hc-ping.com/...
```

First run does a full backfill; every run after is incremental:

```bash
cd /var/www/hevy && node fetch.js --dry-run   # compute and print, write nothing
cd /var/www/hevy && node fetch.js             # for real
```

### nginx

```nginx
location = /training.json {
    alias /var/www/hevy/stats.json;
    default_type application/json;
    add_header Cache-Control "public, max-age=900";
    add_header X-Content-Type-Options $header_content_type_options;
}
```

On the droplet it sits in `/etc/nginx/sites-available/bengammon.co.uk-ssl.conf`, just
above `location / {`.

**`ghost setup nginx` regenerates the site config on major upgrades and will silently
drop this block.** That is why every run curls the public URL afterwards and emails if
it does not come back — it is the only way to notice. Keep a copy of the block here so
it can be pasted back.

### cron

Every three hours, as a non-root user. The minute is deliberately not `0`: Hevy's docs
ask that scheduled clients avoid the top of the hour.

```cron
17 */3 * * * cd /var/www/hevy && /usr/bin/node fetch.js >> /var/log/hevy.log 2>&1
```

## What happens when it breaks

A failed run is a no-op. The API call fails, the script exits, no file is touched, and
the site keeps serving the last good numbers. That is the most important property here
and everything else is arranged around it.

- **Atomic writes.** Temp file, fsync, rename. nginx never sees a half-written file.
- **Validation.** Required keys, correct types, tonnage positive and finite. Wrong
  shape means exit without writing.
- **Sanity guards, both directions.** Refuses a total lower than last run (a partial
  paginated response). Refuses a rise beyond ~30,000 kg per 3 hours elapsed, and
  separately refuses a near-doubling at normal cron cadence — the absolute cap alone
  has a blind spot while the lifetime total is small, where a unit change to lb moves
  the number by less than the cap.
- **Retries.** Three attempts with exponential backoff for 5xx and 429, honouring
  `Retry-After`. A 401 or 403 is fatal and not retried.
- **Weekly `cache.json` backup.** Regenerable, but a backfill is slow and rate-limited.

### Alerting

On staleness, not on individual errors — one failed run at 3am is noise.

- **Immediately** for failures that will not self-heal: 401/403, validation failure,
  public-URL check failure.
- **After three consecutive failures** for everything else.

**The healthchecks.io ping is not optional.** If cron stops running, this script cannot
email anyone — it is not running. Droplet reboots, Node upgrades and full disks all
fail silently, and that is the entire class of failure internal monitoring is
structurally blind to.

## Previewing locally

There is no nginx locally, so nothing serves `/training.json` and the panel renders
nothing — which is correct behaviour, not a fault. To see it against real data:

```bash
# 1. Generate stats.json into a local directory. --skip-verify drops the public URL
#    check, which has nothing to check against here. Never pass it on the droplet.
HEVY_DATA_DIR=./dev-data HEVY_API_KEY=... node tools/hevy/fetch.js --skip-verify

# 2. Serve it over CORS.
HEVY_DATA_DIR=./dev-data node tools/hevy/serve-dev.js
```

Then point the theme at it from Ghost admin, under Settings → Code injection → Site
header, so nothing in the repo has to change:

```html
<script>window.trainingDataUrl = 'http://localhost:8788/';</script>
```

The injection is safe to leave in place. Code injection is stored in Ghost's database,
not the theme, and the local install has its own database separate from the droplet's
— so it stays local and never ships with a theme deploy. The only way it could reach
production is by copying the local database up.

**A newly added template needs Ghost to rescan.** Ghost builds its list of available
templates when a theme is activated, so `page-training.hbs` will not be picked up
until you restart Ghost or re-activate the theme in admin. The symptom is a Training
page that renders through `page.hbs` with no dashboard mount point in the markup.

## Jefit history

Before Hevy there was Jefit: 169 sessions from 2 January 2024 to 21 June 2026, a week
before the first Hevy session. Its totals are added once, via `JEFIT_BASELINE` in
`config.js`. They are not merged session by session:

| Figure | Jefit |
|---|---|
| Weight moved | 1,057,640 kg |
| Sessions | 169 |
| Reps | 29,227 |
| Sets | 3,425 |
| Hours | 204.4 |
| Best streak | 16 weeks |

The grid, the current streak and the last session stay Hevy-only, since a set of totals
has no dates in it. The best streak is the longer of Jefit's 16 weeks and Hevy's own.
`config.js` records how each figure was derived. The export itself stays out of the
repo, because it holds personal data.

**The baseline has to ship before the droplet's first run.** On a first run there is no
previous total, so it simply becomes the starting point. Added to a pipeline that has
already run, it is exactly the jump the sanity guards refuse. A first run also sends no
milestone email: whatever it crosses is history, not news.
