// Run with: node --test tools/hevy/
//
// No test runner and no dependencies — node:test ships with Node 18+, which is what
// the droplet already runs for Ghost.

import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';

import { setTonnage, summariseWorkout } from './lib/tonnage.js';
import { normaliseMeasurements, makeLookup } from './lib/bodyweight.js';
import { isoWeekKey, computeStreak, pickComparison, pickMilestone, buildDays, buildStats } from './lib/stats.js';
import { applyEvents, replaceAll, emptyCache, writeJsonAtomic, readJson } from './lib/store.js';
import { validate, sanityCheck } from './lib/validate.js';
import { createClient, FatalApiError } from './lib/api.js';

// The eight real sessions, as summarised by lib/tonnage.js.
const SESSIONS = [
  { date: '2026-06-28', name: 'Recomp Sunday',    kg: 7000, reps: 142, durationMin: 76 },
  { date: '2026-07-05', name: 'Recomp Sunday',    kg: 8555, reps: 170, durationMin: 66 },
  { date: '2026-07-11', name: 'Recomp Sunday',    kg: 9065, reps: 176, durationMin: 70 },
  { date: '2026-07-19', name: 'Recomp Wednesday', kg: 4821, reps: 188, durationMin: 72 },
  { date: '2026-07-26', name: 'Recomp Sunday',    kg: 7879, reps: 180, durationMin: 77 },
  { date: '2026-07-27', name: 'Morning workout',  kg: 0,    reps: 24,  durationMin: 9 },
  { date: '2026-09-06', name: 'Recomp Sunday',    kg: 8903, reps: 175, durationMin: 79 },
  { date: '2026-09-09', name: 'Wednesday',        kg: 5970, reps: 178, durationMin: 65 },
];

test('tonnage: the four load classes', async (t) => {
  await t.test('plain load is weight x reps', () => {
    assert.equal(setTonnage('2B4B7310', { weight_kg: 60, reps: 8 }, 93.4), 480);
  });

  await t.test('per-limb exercises double', () => {
    assert.equal(setTonnage('AA1EB7D8', { weight_kg: 36, reps: 8 }, 93.4), 576);
    // Same set, not on the per-limb list, must not double.
    assert.equal(setTonnage('2B4B7310', { weight_kg: 36, reps: 8 }, 93.4), 288);
  });

  await t.test('bodyweight exercises use the lifter', () => {
    assert.equal(setTonnage('6FCD7755', { weight_kg: null, reps: 8 }, 93.4), 747.2);
  });

  await t.test('a weighted dip adds the belt to bodyweight', () => {
    assert.equal(setTonnage('6FCD7755', { weight_kg: 10, reps: 5 }, 90), 500);
  });

  await t.test('assisted subtracts the assist, never going negative', () => {
    assert.equal(setTonnage('2C37EC5E', { weight_kg: 14, reps: 4 }, 93.4), 317.6);
    assert.equal(setTonnage('2C37EC5E', { weight_kg: 200, reps: 4 }, 93.4), 0);
  });

  await t.test('unlisted null-weight work is zero load but still counts reps', () => {
    assert.equal(setTonnage('99D5F10E', { weight_kg: null, reps: 8 }, 93.4), 0);
  });

  await t.test('both API field spellings work', () => {
    // The REST API says weight_kg; the hevy-mcp wrapper renames it to weight.
    assert.equal(setTonnage('AA1EB7D8', { weight_kg: 36, reps: 8 }, 93.4),
                 setTonnage('AA1EB7D8', { weight: 36, reps: 8 }, 93.4));
  });

  await t.test('warmups are included — this is total weight moved', () => {
    const workout = {
      id: 'w', title: 'T',
      start_time: '2026-09-09T05:00:00+00:00', end_time: '2026-09-09T06:00:00+00:00',
      exercises: [{ exercise_template_id: '79D0BB3A', sets: [
        { type: 'warmup', weight_kg: 40, reps: 10 },
        { type: 'normal', weight_kg: 50, reps: 10 },
      ] }],
    };
    assert.equal(summariseWorkout(workout, () => 93.4).kg, 900);
  });
});

test('bodyweight: dated lookup', async (t) => {
  const log = [{ date: '2026-06-26', kg: 93.4 }, { date: '2026-09-10', kg: 95 }];

  await t.test('nearest entry at or before the date', () => {
    const on = makeLookup(log);
    assert.equal(on('2026-07-05'), 93.4);
    assert.equal(on('2026-09-09'), 93.4);
    assert.equal(on('2026-09-10'), 95);
    assert.equal(on('2026-12-01'), 95);
  });

  await t.test('dates before the first entry use the first entry', () => {
    assert.equal(makeLookup(log)('2026-01-01'), 93.4);
  });

  await t.test('an empty log refuses rather than guessing', () => {
    assert.throws(() => makeLookup([]), /empty/);
  });

  await t.test('entries without a weight are dropped, not treated as zero', () => {
    // The live API omits null fields entirely rather than sending them as null.
    const raw = [
      { date: '2026-09-10', weight_kg: 95, waist: 92 },
      { date: '2026-08-01', waist: 93 },              // measured waist only
      { date: '2026-07-01', weight_kg: null },         // documented shape
      { date: '2026-06-26', weight_kg: 93.4 },
    ];
    assert.deepEqual(normaliseMeasurements(raw), [
      { date: '2026-06-26', kg: 93.4 },
      { date: '2026-09-10', kg: 95 },
    ]);
  });
});

test('stats: streak, milestone, comparison', async (t) => {
  await t.test('ISO weeks put Sunday in the week that just ended', () => {
    assert.equal(isoWeekKey('2026-06-28'), '2026-W26'); // Sunday
    assert.equal(isoWeekKey('2026-06-29'), '2026-W27'); // Monday, next week
  });

  await t.test('streak counts consecutive weeks with any session', () => {
    assert.deepEqual(computeStreak(SESSIONS, '2026-09-10'), { currentWeeks: 2, longestWeeks: 6 });
  });

  await t.test('a quiet current week does not break the streak', () => {
    // 2026-09-09 is W37, 2026-09-16 is W38 — last week, so the streak still stands.
    const s = [{ date: '2026-09-09', name: 'x', kg: 1, reps: 1, durationMin: 1 }];
    assert.equal(computeStreak(s, '2026-09-16').currentWeeks, 1);
  });

  await t.test('a fortnight of silence does break it', () => {
    const s = [{ date: '2026-08-20', name: 'x', kg: 1, reps: 1, durationMin: 1 }];
    assert.equal(computeStreak(s, '2026-09-16').currentWeeks, 0);
  });

  await t.test('no sessions is zero, not a crash', () => {
    assert.deepEqual(computeStreak([], '2026-09-10'), { currentWeeks: 0, longestWeeks: 0 });
  });

  await t.test('comparison picks the largest unit still reading above one', () => {
    assert.deepEqual(pickComparison(52193), { count: 4.3, unit: 'London buses', emoji: '🚌' });
    assert.equal(pickComparison(50_000_000).unit, 'Eiffel Towers');
  });

  await t.test('comparison never renders as zero of something', () => {
    assert.ok(pickComparison(500).count > 0);
  });

  await t.test('milestone surfaces whichever is nearest', () => {
    const m = pickMilestone({ tonnageKg: 52193, workouts: 8, reps: 1233 });
    assert.equal(m.key, 'tonnageKg');
    assert.equal(m.target, 100000);
    assert.equal(m.pctComplete, 52);
  });

  await t.test('milestone switches type when another gets closer', () => {
    // 98 sessions is 98% of the way to 100; tonnage is only just past a boundary.
    const m = pickMilestone({ tonnageKg: 101000, workouts: 98, reps: 500 });
    assert.equal(m.key, 'workouts');
  });

  await t.test('two sessions on one day merge into one grid entry', () => {
    const days = buildDays([
      { date: '2026-09-09', name: 'AM', kg: 100, reps: 10, durationMin: 20 },
      { date: '2026-09-09', name: 'PM', kg: 200, reps: 20, durationMin: 30 },
    ], '2026-09-10');
    assert.equal(days.length, 1);
    assert.equal(days[0].kg, 300);
    assert.equal(days[0].name, 'AM + PM');
  });

  await t.test('days outside the window are dropped', () => {
    const days = buildDays([{ date: '2024-01-01', name: 'old', kg: 100, reps: 1, durationMin: 1 }], '2026-09-10');
    assert.equal(days.length, 0);
  });

  await t.test('the full object matches the eight real sessions', () => {
    const stats = buildStats(SESSIONS, { today: '2026-09-10', generated: '2026-09-10T13:00:00Z' });
    assert.equal(stats.lifetime.tonnageKg, 52193);
    assert.equal(stats.lifetime.workouts, 8);
    assert.equal(stats.lifetime.reps, 1233);
    assert.equal(stats.last.date, '2026-09-09');
    assert.equal(stats.days.length, 8);
    assert.deepEqual(validate(stats), []);
  });
});

test('store: cache merging', async (t) => {
  const workout = (id, title) => ({ id, title, start_time: '2026-09-09T05:00:00+00:00', exercises: [] });

  await t.test('an update inserts by id', () => {
    const cache = emptyCache();
    applyEvents(cache, [{ type: 'updated', workout: workout('a', 'First') }]);
    assert.equal(cache.workouts.a.title, 'First');
  });

  await t.test('an edit replaces rather than duplicating', () => {
    const cache = emptyCache();
    applyEvents(cache, [{ type: 'updated', workout: workout('a', 'First') }]);
    applyEvents(cache, [{ type: 'updated', workout: workout('a', 'Corrected') }]);
    assert.equal(Object.keys(cache.workouts).length, 1);
    assert.equal(cache.workouts.a.title, 'Corrected');
  });

  await t.test('events arrive newest first, so the newest must win', () => {
    const cache = emptyCache();
    applyEvents(cache, [
      { type: 'updated', workout: workout('a', 'Newest') },
      { type: 'updated', workout: workout('a', 'Older') },
    ]);
    assert.equal(cache.workouts.a.title, 'Newest');
  });

  await t.test('a delete removes it', () => {
    const cache = emptyCache();
    applyEvents(cache, [{ type: 'updated', workout: workout('a', 'First') }]);
    const res = applyEvents(cache, [{ type: 'deleted', id: 'a' }]);
    assert.equal(res.deleted, 1);
    assert.equal(Object.keys(cache.workouts).length, 0);
  });

  await t.test('backfill replaces the whole set', () => {
    const cache = emptyCache();
    applyEvents(cache, [{ type: 'updated', workout: workout('stale', 'Gone') }]);
    replaceAll(cache, [workout('a', 'A'), workout('b', 'B')]);
    assert.deepEqual(Object.keys(cache.workouts).sort(), ['a', 'b']);
  });

  await t.test('atomic write round-trips and leaves no temp file', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hevy-'));
    const file = path.join(dir, 'stats.json');
    await writeJsonAtomic(file, { hello: 'world' });
    assert.deepEqual(await readJson(file), { hello: 'world' });
    const left = await fs.readdir(dir);
    assert.deepEqual(left, ['stats.json']);
    await fs.rm(dir, { recursive: true, force: true });
  });

  await t.test('a missing file returns the fallback', async () => {
    assert.equal(await readJson(path.join(os.tmpdir(), 'nope-' + Date.now() + '.json'), null), null);
  });
});

test('guards: refuse to publish nonsense', async (t) => {
  const good = buildStats(SESSIONS, { today: '2026-09-10', generated: '2026-09-10T13:00:00Z' });

  await t.test('a good object passes', () => {
    assert.deepEqual(validate(good), []);
  });

  await t.test('zero tonnage is rejected', () => {
    const bad = structuredClone(good);
    bad.lifetime.tonnageKg = 0;
    assert.ok(validate(bad).some((p) => p.includes('tonnageKg')));
  });

  await t.test('a NaN slipping through is rejected', () => {
    const bad = structuredClone(good);
    bad.lifetime.tonnageKg = NaN;
    assert.ok(validate(bad).some((p) => p.includes('tonnageKg')));
  });

  await t.test('missing days is rejected', () => {
    const bad = structuredClone(good);
    delete bad.days;
    assert.ok(validate(bad).some((p) => p.includes('days')));
  });

  await t.test('the first run has no baseline to compare against', () => {
    assert.deepEqual(sanityCheck(good, { lastTonnageKg: null }), []);
  });

  await t.test('tonnage going backwards is refused', () => {
    const problems = sanityCheck(good, { lastTonnageKg: 60000, lastSuccessAt: '2026-09-10T10:00:00Z' });
    assert.ok(problems.some((p) => p.includes('fell')));
  });

  await t.test('a normal session-sized gain passes', () => {
    const now = new Date('2026-09-10T13:00:00Z').getTime();
    const problems = sanityCheck(good, { lastTonnageKg: 46223, lastSuccessAt: '2026-09-10T10:00:00Z' }, now);
    assert.deepEqual(problems, []);
  });

  await t.test('a rise beyond the absolute cap is refused', () => {
    const now = new Date('2026-09-10T13:00:00Z').getTime();
    const problems = sanityCheck(good, { lastTonnageKg: 5000, lastSuccessAt: '2026-09-10T10:00:00Z' }, now);
    assert.ok(problems.some((p) => p.includes('jumped')));
  });

  await t.test('a near-doubling is caught even under the absolute cap', () => {
    // 26,096 -> 52,193 is only a 26,097 kg rise, comfortably under the 30,000 cap,
    // but it is an exact doubling. The ratio guard is what catches this.
    const now = new Date('2026-09-10T13:00:00Z').getTime();
    const problems = sanityCheck(good, { lastTonnageKg: 26096, lastSuccessAt: '2026-09-10T10:00:00Z' }, now);
    assert.ok(problems.some((p) => p.includes('doubled')));
  });

  await t.test('two big sessions after an outage are not mistaken for a doubling', () => {
    const now = new Date('2026-09-10T13:00:00Z').getTime();
    const problems = sanityCheck(good, { lastTonnageKg: 34000, lastSuccessAt: '2026-09-08T13:00:00Z' }, now);
    assert.deepEqual(problems, []);
  });

  await t.test('the jump allowance scales with a longer outage', () => {
    // Same rise, but after four days down rather than three hours.
    const now = new Date('2026-09-10T13:00:00Z').getTime();
    const problems = sanityCheck(good, { lastTonnageKg: 26096, lastSuccessAt: '2026-09-06T13:00:00Z' }, now);
    assert.deepEqual(problems, []);
  });
});

test('api: retry policy', async (t) => {
  await t.test('a 500 is retried and can succeed', async () => {
    let calls = 0;
    const api = createClient('key', {
      fetchImpl: async () => {
        calls++;
        if (calls < 3) return new Response('', { status: 500 });
        return new Response(JSON.stringify({ count: 8 }), { status: 200, headers: { 'content-type': 'application/json' } });
      },
    });
    assert.equal(await api.getWorkoutCount(), 8);
    assert.equal(calls, 3);
  });

  await t.test('a 401 is fatal and not retried', async () => {
    let calls = 0;
    const api = createClient('key', {
      fetchImpl: async () => { calls++; return new Response('', { status: 401 }); },
    });
    await assert.rejects(() => api.getWorkoutCount(), FatalApiError);
    assert.equal(calls, 1);
  });

  await t.test('a missing key fails before any request', () => {
    assert.throws(() => createClient(undefined), FatalApiError);
  });

  await t.test('pagination walks every page', async () => {
    const pages = {
      1: { page: 1, page_count: 2, workouts: [{ id: 'a' }] },
      2: { page: 2, page_count: 2, workouts: [{ id: 'b' }] },
    };
    const api = createClient('key', {
      fetchImpl: async (url) => {
        const page = new URL(url).searchParams.get('page');
        return new Response(JSON.stringify(pages[page]), { status: 200, headers: { 'content-type': 'application/json' } });
      },
    });
    assert.deepEqual((await api.getAllWorkouts()).map((w) => w.id), ['a', 'b']);
  });
});
