#!/usr/bin/env node
//
// Pulls workout data from Hevy, derives stats.json, writes it atomically.
//
//   node fetch.js              scheduled run: incremental sync
//   node fetch.js --backfill   re-paginate the full history into the cache
//   node fetch.js --dry-run    compute and print, write nothing, send nothing
//
// The governing rule: a failed run is a no-op. If anything is wrong, exit without
// touching a file, and the site keeps serving the last good numbers.

import path from 'node:path';
import { promises as fs } from 'node:fs';
import { DATA_DIR, PUBLIC_URL, EMAIL_MILESTONE_KG } from './config.js';
import { createClient, FatalApiError } from './lib/api.js';
import { fetchBodyweightLog, makeLookup } from './lib/bodyweight.js';
import { summariseWorkout } from './lib/tonnage.js';
import { buildStats } from './lib/stats.js';
import {
  readJson,
  writeJsonAtomic,
  emptyCache,
  applyEvents,
  replaceAll,
  backupCacheIfStale,
} from './lib/store.js';
import { sendEmail, pingHealthcheck } from './lib/notify.js';
import { validate, sanityCheck } from './lib/validate.js';

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has('--dry-run');
const FORCE_BACKFILL = args.has('--backfill');

const CACHE_PATH = path.join(DATA_DIR, 'cache.json');
const STATE_PATH = path.join(DATA_DIR, 'state.json');
const STATS_PATH = path.join(DATA_DIR, 'stats.json');

const EMPTY_STATE = { consecutiveFailures: 0, lastTonnageKg: null, lastSuccessAt: null };

// Cron runs with a bare environment, so read an env file next to the data if present.
async function loadEnvFile() {
  try {
    const text = await fs.readFile(path.join(DATA_DIR, '.env'), 'utf8');
    for (const line of text.split('\n')) {
      const match = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (!match) continue;
      const value = match[2].replace(/^["']|["']$/g, '');
      if (process.env[match[1]] === undefined) process.env[match[1]] = value;
    }
  } catch {
    // No env file is fine if the environment is already populated.
  }
}

// The only way to catch nginx quietly dropping the location block on a Ghost upgrade.
async function verifyPublicUrl(expectedGenerated) {
  const url = PUBLIC_URL + '?_=' + Date.now(); // defeat the 15 minute Cache-Control
  const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error('public URL returned ' + res.status);

  const body = await res.json();
  if (body?.generated !== expectedGenerated) {
    throw new Error('public URL served a different version (' + (body?.generated ?? 'no generated field') + ')');
  }
  return true;
}

async function run() {
  await loadEnvFile();

  const api = createClient(process.env.HEVY_API_KEY);
  const state = (await readJson(STATE_PATH, null)) ?? { ...EMPTY_STATE };
  const cache = (await readJson(CACHE_PATH, null)) ?? emptyCache();

  const runStartedAt = new Date().toISOString();
  const backfilling = FORCE_BACKFILL || !cache.lastSync || Object.keys(cache.workouts).length === 0;

  // Backfill once, then stay incremental. Never re-paginate on a scheduled run:
  // lifetime tonnage needs every workout, and the cache is what makes that cheap.
  let changes;
  if (backfilling) {
    console.log('[fetch] backfilling full workout history');
    changes = replaceAll(cache, await api.getAllWorkouts());
  } else {
    console.log('[fetch] incremental sync since ' + cache.lastSync);
    changes = applyEvents(cache, await api.getWorkoutEvents(cache.lastSync));
  }
  console.log(
    '[fetch] ' + changes.updated + ' updated, ' + changes.deleted + ' deleted, ' +
    Object.keys(cache.workouts).length + ' in cache'
  );

  const { log: bodyweightLog, source } = await fetchBodyweightLog(api);
  console.log(
    '[fetch] bodyweight from ' + source + ': ' + bodyweightLog.length +
    ' dated entries, latest ' + bodyweightLog.at(-1).kg + 'kg'
  );
  const bodyweightOn = makeLookup(bodyweightLog);

  const sessions = Object.values(cache.workouts).map((w) => summariseWorkout(w, bodyweightOn));
  const stats = buildStats(sessions, { generated: runStartedAt });

  const problems = [...validate(stats), ...sanityCheck(stats, state)];
  if (problems.length) {
    const err = new Error('refusing to write:\n  - ' + problems.join('\n  - '));
    err.fatal = true; // will not self-heal, so alert immediately
    throw err;
  }

  if (DRY_RUN) {
    console.log('\n[dry-run] nothing written. stats.json would be:\n');
    console.log(JSON.stringify(stats, null, 2));
    return { stats, dryRun: true };
  }

  cache.lastSync = runStartedAt;
  await writeJsonAtomic(CACHE_PATH, cache);
  await writeJsonAtomic(STATS_PATH, stats);
  console.log(
    '[fetch] wrote stats.json: ' + stats.lifetime.tonnageKg.toLocaleString('en-GB') +
    ' kg over ' + stats.lifetime.workouts + ' sessions'
  );

  try {
    await verifyPublicUrl(stats.generated);
    console.log('[fetch] public URL verified');
  } catch (err) {
    err.fatal = true; // nginx config lost, and no amount of waiting fixes it
    throw err;
  }

  // A round milestone is the prompt to write a post. Same lifetime figure as the
  // progress bar, different divisor, so no extra state is needed.
  const crossed = Math.floor(stats.lifetime.tonnageKg / EMAIL_MILESTONE_KG);
  const before = Math.floor((state.lastTonnageKg ?? 0) / EMAIL_MILESTONE_KG);
  if (crossed > before) {
    const total = (crossed * EMAIL_MILESTONE_KG).toLocaleString('en-GB');
    await sendEmail(
      total + ' kg lifted',
      'You have crossed ' + total + ' kg total weight moved.\n\n' +
      'Lifetime: ' + stats.lifetime.tonnageKg.toLocaleString('en-GB') + ' kg across ' +
      stats.lifetime.workouts + ' sessions (' + stats.comparison.count + ' ' +
      stats.comparison.unit + ' ' + stats.comparison.emoji + ').\n\nTime to write one up.'
    );
  }

  await backupCacheIfStale(CACHE_PATH);
  await writeJsonAtomic(STATE_PATH, {
    consecutiveFailures: 0,
    lastTonnageKg: stats.lifetime.tonnageKg,
    lastSuccessAt: runStartedAt,
  });
  await pingHealthcheck();

  return { stats, dryRun: false };
}

try {
  await run();
  process.exit(0);
} catch (err) {
  const fatal = err.fatal === true || err instanceof FatalApiError;
  console.error('[fetch] FAILED' + (fatal ? ' (fatal)' : '') + ': ' + err.message);

  if (!DRY_RUN) {
    const state = (await readJson(STATE_PATH, null)) ?? { ...EMPTY_STATE };
    const failures = (state.consecutiveFailures ?? 0) + 1;

    // Alert on staleness, not on individual errors. One failed run at 3am is noise;
    // three in a row, or a failure that cannot self-heal, is signal.
    if (fatal || failures >= 3) {
      await sendEmail(
        fatal ? 'Training pipeline: needs attention' : 'Training pipeline: ' + failures + ' failures in a row',
        err.message + '\n\nLast good run: ' + (state.lastSuccessAt ?? 'never') + '\n' +
        'The site is still serving the last good stats.json.'
      );
    }
    await writeJsonAtomic(STATE_PATH, { ...state, consecutiveFailures: failures });
  }
  process.exit(1);
}
