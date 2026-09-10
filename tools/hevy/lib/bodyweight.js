import { FALLBACK_BODYWEIGHT } from '../config.js';

// Bodyweight is a dated series, never a constant. A single current figure would
// retroactively re-price every past pull-up and dip, and lifetime tonnage would
// visibly drop the first time Ben logged a lighter weight.

// Normalises a Hevy /body_measurements payload into a sorted, ascending log.
//
// The live API omits null fields entirely rather than returning them as null, so a
// measurement entry logging only waist has no weight_kg key at all. `== null` catches
// both the documented null and the actual undefined.
export function normaliseMeasurements(entries) {
  return entries
    .filter((e) => e && typeof e.date === 'string' && e.weight_kg != null)
    .map((e) => ({ date: e.date, kg: Number(e.weight_kg) }))
    .filter((e) => Number.isFinite(e.kg) && e.kg > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
}

// Fetches the dated log, falling back to the hardcoded table if the API gives us
// nothing usable. Written as its own function so the source can be swapped.
export async function fetchBodyweightLog(api) {
  const raw = await api.getBodyMeasurements();
  const log = normaliseMeasurements(raw);
  if (log.length === 0) {
    return { log: [...FALLBACK_BODYWEIGHT], source: 'fallback' };
  }
  return { log, source: 'api' };
}

// Nearest entry at or before the given date. Dates before the first entry use the
// first entry — the alternative is refusing to price the earliest sessions at all.
export function makeLookup(log) {
  if (!Array.isArray(log) || log.length === 0) {
    throw new Error('bodyweight log is empty; refusing to compute tonnage');
  }
  const sorted = [...log].sort((a, b) => a.date.localeCompare(b.date));
  return function bodyweightOn(date) {
    let hit = sorted[0];
    for (const entry of sorted) {
      if (entry.date <= date) hit = entry;
      else break;
    }
    return hit.kg;
  };
}
