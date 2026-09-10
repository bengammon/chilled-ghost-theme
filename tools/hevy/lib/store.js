import { promises as fs } from 'node:fs';
import path from 'node:path';

// nginx must never serve a half-written file, so every write goes to a temp file,
// gets fsynced, and is then renamed into place. rename() is atomic on the same
// filesystem, which is why the temp file lives in the target directory.
export async function writeJsonAtomic(filePath, data) {
  const dir = path.dirname(filePath);
  const tmp = `${filePath}.tmp`;
  const json = JSON.stringify(data, null, 2);

  const handle = await fs.open(tmp, 'w');
  try {
    await handle.writeFile(json, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fs.rename(tmp, filePath);

  // Fsync the directory too, so the rename itself survives a power loss.
  // Not supported on every platform — a failure here is not worth aborting over.
  try {
    const dirHandle = await fs.open(dir, 'r');
    try { await dirHandle.sync(); } finally { await dirHandle.close(); }
  } catch { /* best effort */ }
}

export async function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return fallback;
    // A corrupt file is worth surfacing rather than silently re-backfilling.
    throw new Error(`could not read ${filePath}: ${err.message}`);
  }
}

// The cache is what makes lifetime tonnage cheap: every scheduled run touches only
// what changed, never the full history.
export function emptyCache() {
  return { version: 1, lastSync: null, workouts: {} };
}

// Applies /workouts/events to the cache. Events are newest-first, so they are applied
// in reverse to let an older update lose to a newer one on the same id.
export function applyEvents(cache, events) {
  let updated = 0;
  let deleted = 0;
  for (const event of [...events].reverse()) {
    if (event?.type === 'updated' && event.workout?.id) {
      cache.workouts[event.workout.id] = event.workout;
      updated++;
    } else if (event?.type === 'deleted') {
      const id = event.id ?? event.workout?.id ?? event.workout_id;
      if (id && cache.workouts[id]) {
        delete cache.workouts[id];
        deleted++;
      }
    }
  }
  return { updated, deleted };
}

export function replaceAll(cache, workouts) {
  cache.workouts = {};
  for (const w of workouts) if (w?.id) cache.workouts[w.id] = w;
  return { updated: workouts.length, deleted: 0 };
}

// Regenerable, but a full backfill is slow and rate-limited, so keep a weekly copy.
export async function backupCacheIfStale(cachePath, maxAgeDays = 7) {
  const backupPath = `${cachePath}.backup`;
  try {
    const stat = await fs.stat(backupPath);
    const ageDays = (Date.now() - stat.mtimeMs) / 86_400_000;
    if (ageDays < maxAgeDays) return false;
  } catch { /* no backup yet — make one */ }
  await fs.copyFile(cachePath, backupPath);
  return true;
}
