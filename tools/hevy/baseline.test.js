// Run with: node --test tools/hevy/
//
// The Jefit baseline: one-off totals from the app used before Hevy, added to the Hevy
// lifetime figures. These pin what it may and may not touch.

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildStats, emailMilestoneCrossed } from './lib/stats.js';
import { validate, sanityCheck } from './lib/validate.js';
import { JEFIT_BASELINE, EMAIL_MILESTONE_KG } from './config.js';

// The eight real Hevy sessions, as summarised by lib/tonnage.js, with their set counts.
const SESSIONS = [
  { date: '2026-06-28', name: 'Sunday',    kg: 7000, reps: 142, sets: 21, durationMin: 76 },
  { date: '2026-07-05', name: 'Sunday',    kg: 8555, reps: 170, sets: 25, durationMin: 66 },
  { date: '2026-07-11', name: 'Sunday',    kg: 9065, reps: 176, sets: 25, durationMin: 70 },
  { date: '2026-07-19', name: 'Wednesday', kg: 4821, reps: 188, sets: 24, durationMin: 72 },
  { date: '2026-07-26', name: 'Sunday',    kg: 7879, reps: 180, sets: 26, durationMin: 77 },
  { date: '2026-07-27', name: 'Monday',    kg: 0,    reps: 24,  sets: 3,  durationMin: 9 },
  { date: '2026-09-06', name: 'Sunday',    kg: 8903, reps: 175, sets: 23, durationMin: 79 },
  { date: '2026-09-09', name: 'Wednesday', kg: 5970, reps: 178, sets: 22, durationMin: 65 },
];

const combined = () => buildStats(SESSIONS, {
  today: '2026-09-11',
  generated: '2026-09-11T12:00:00Z',
  baseline: JEFIT_BASELINE,
});

test('baseline: lifetime totals', async (t) => {
  await t.test('every lifetime figure includes Jefit', () => {
    const { lifetime } = combined();
    assert.equal(lifetime.tonnageKg, Math.round(52193 + 1057640.1));
    assert.equal(lifetime.workouts, 8 + 169);
    assert.equal(lifetime.reps, 1233 + 29227);
    assert.equal(lifetime.sets, 169 + 3425);
    // 514 Hevy minutes plus 12,265 Jefit minutes, rounded once at the end.
    assert.equal(lifetime.hours, 213);
  });

  await t.test('sets are counted from the Hevy sessions too', () => {
    assert.equal(buildStats(SESSIONS, { today: '2026-09-11' }).lifetime.sets, 169);
  });

  await t.test('without a baseline nothing changes', () => {
    const { lifetime, streak } = buildStats(SESSIONS, { today: '2026-09-11' });
    assert.equal(lifetime.tonnageKg, 52193);
    assert.equal(lifetime.workouts, 8);
    assert.equal(streak.longestWeeks, 6);
  });

  await t.test('the combined object passes validation', () => {
    assert.deepEqual(validate(combined()), []);
  });

  await t.test('sets must be a whole, non-negative number', () => {
    for (const bad of [1.5, -1, undefined]) {
      const stats = combined();
      stats.lifetime.sets = bad;
      assert.ok(validate(stats).some((p) => p.startsWith('sets invalid')), 'rejects ' + bad);
    }
  });
});

test('baseline: what stays Hevy-only', async (t) => {
  await t.test('the grid, last session and rolling year ignore Jefit', () => {
    const stats = combined();
    assert.equal(stats.days.length, 8);
    assert.equal(stats.last.date, '2026-09-09');
    assert.equal(stats.year.workouts, 8);
  });

  await t.test('the current streak is Hevy\'s; the best is Jefit\'s 16 weeks', () => {
    assert.deepEqual(combined().streak, { currentWeeks: 2, longestWeeks: 16 });
  });

  await t.test('a Hevy run longer than 16 weeks takes over as the best', () => {
    const weekly = Array.from({ length: 20 }, (_, i) => {
      const d = new Date(Date.UTC(2027, 0, 4 + i * 7));
      return { date: d.toISOString().slice(0, 10), name: 'x', kg: 1000, reps: 10, sets: 1, durationMin: 60 };
    });
    const stats = buildStats(weekly, { today: '2027-05-20', baseline: JEFIT_BASELINE });
    assert.equal(stats.streak.longestWeeks, 20);
  });
});

test('baseline: derived figures read the combined totals', async (t) => {
  await t.test('the comparison re-rolls to blue whales', () => {
    const { comparison } = combined();
    assert.equal(comparison.unit, 'blue whales');
    assert.equal(comparison.count, 7.4);
  });

  await t.test('the nearest milestone becomes the 200th session', () => {
    const m = combined().nextMilestone;
    assert.equal(m.key, 'workouts');
    assert.equal(m.label, '200th session');
    assert.equal(m.remaining, 23);
    assert.equal(m.remainingUnit, 'sessions');
  });
});

test('baseline: first run and the guards', async (t) => {
  await t.test('a first run sends no milestone email, even crossing a million', () => {
    assert.equal(emailMilestoneCrossed(null, combined().lifetime.tonnageKg, EMAIL_MILESTONE_KG), null);
  });

  await t.test('a later run crossing a boundary announces it', () => {
    assert.equal(emailMilestoneCrossed(495000, 503000, EMAIL_MILESTONE_KG), 500000);
    assert.equal(emailMilestoneCrossed(990000, 1004000, EMAIL_MILESTONE_KG), 1000000);
  });

  await t.test('a run that crosses nothing stays quiet', () => {
    assert.equal(emailMilestoneCrossed(1109833, 1117000, EMAIL_MILESTONE_KG), null);
  });

  await t.test('the baseline passes on a first run', () => {
    assert.deepEqual(sanityCheck(combined(), { lastTonnageKg: null }), []);
  });

  // Why the baseline has to ship before the droplet's first run: added to a pipeline
  // that has already run Hevy-only, it is precisely the jump the guards exist to refuse.
  await t.test('added after a Hevy-only run, the guards refuse it', () => {
    const now = new Date('2026-09-11T15:00:00Z').getTime();
    const problems = sanityCheck(combined(), { lastTonnageKg: 52193, lastSuccessAt: '2026-09-11T12:00:00Z' }, now);
    assert.ok(problems.length > 0);
  });
});
