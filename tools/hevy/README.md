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
    add_header Cache-Control "public, max-age=900";
}
```

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
