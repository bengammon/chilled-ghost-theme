import { MILESTONES, COMPARISONS, COMPARISON_MAX, DAYS_RETAINED } from '../config.js';

// ISO week key, e.g. "2026-W37". Weeks run Monday to Sunday, which is also how the
// grid is laid out.
export function isoWeekKey(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  const day = d.getUTCDay() || 7;            // Sunday is 0; treat it as 7
  d.setUTCDate(d.getUTCDate() + 4 - day);    // shift to the Thursday of this week
  const year = d.getUTCFullYear();
  const jan1 = new Date(Date.UTC(year, 0, 1));
  const week = Math.ceil(((d - jan1) / 86_400_000 + 1) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

// Walks back `n` weeks from a date and returns that week's key.
function weekKeyOffset(fromDate, weeksBack) {
  const d = new Date(fromDate + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - weeksBack * 7);
  return isoWeekKey(d.toISOString().slice(0, 10));
}

// A streak is consecutive weeks containing at least one logged session. Forgiving by
// design: a permanently broken streak is worse than no streak. The current week not
// having a session yet does not end it — it is Monday somewhere.
export function computeStreak(sessions, today) {
  const weeks = new Set(sessions.map((s) => isoWeekKey(s.date)));
  if (weeks.size === 0) return { currentWeeks: 0, longestWeeks: 0 };

  let currentWeeks = 0;
  const startOffset = weeks.has(weekKeyOffset(today, 0)) ? 0 : 1;
  for (let back = startOffset; ; back++) {
    if (!weeks.has(weekKeyOffset(today, back))) break;
    currentWeeks++;
    if (back > 520) break; // ten years is plenty of rope
  }

  // Longest run: sort the distinct weeks and count consecutive ones by stepping a
  // cursor forward a week at a time.
  const sorted = [...weeks].sort();
  let longestWeeks = 0;
  for (const startWeek of sorted) {
    // Only start counting from a week whose predecessor is absent, so each run is
    // measured once from its head.
    const anchor = sessions.find((s) => isoWeekKey(s.date) === startWeek).date;
    if (weeks.has(weekKeyOffset(anchor, 1))) continue;
    let run = 0;
    for (let fwd = 0; ; fwd++) {
      const d = new Date(anchor + 'T00:00:00Z');
      d.setUTCDate(d.getUTCDate() + fwd * 7);
      if (!weeks.has(isoWeekKey(d.toISOString().slice(0, 10)))) break;
      run++;
      if (fwd > 520) break;
    }
    longestWeeks = Math.max(longestWeeks, run);
  }

  return { currentWeeks, longestWeeks: Math.max(longestWeeks, currentWeeks) };
}

// Picks the largest unit that still gives a count of at least 1, so the comparison
// re-rolls upward as the number climbs and never needs a manual edit.
export function pickComparison(totalKg) {
  const tonnes = totalKg / 1000;
  const ascending = [...COMPARISONS].sort((a, b) => a.tonnes - b.tonnes);
  let chosen = ascending[0];
  for (const candidate of ascending) {
    const count = tonnes / candidate.tonnes;
    if (count >= 1 && count <= COMPARISON_MAX) chosen = candidate;
  }
  const count = tonnes / chosen.tonnes;
  // Below the smallest unit, round up rather than showing "0 London buses".
  const shown = count > 0 ? Math.max(0.1, Math.round(count * 10) / 10) : 0;
  return {
    count: shown,
    unit: count >= 2 ? chosen.unit : chosen.singular,
    emoji: chosen.emoji,
  };
}

// Three milestone types run at once; the nearest by percentage is the one surfaced,
// so the bar always shows the thing about to happen.
export function pickMilestone({ tonnageKg, workouts, reps }) {
  const candidates = [
    { key: 'tonnageKg', value: tonnageKg, step: MILESTONES.tonnageKg, unit: 'kg',
      label: (t) => `${(t / 1000).toLocaleString('en-GB')} tonnes` },
    { key: 'workouts',  value: workouts,  step: MILESTONES.workouts,  unit: 'sessions',
      label: (t) => `${t}th session` },
    { key: 'reps',      value: reps,      step: MILESTONES.reps,      unit: 'reps',
      label: (t) => `${t.toLocaleString('en-GB')} reps` },
  ].map((c) => {
    const target = Math.floor(c.value / c.step) * c.step + c.step;
    const progressed = c.value - (target - c.step);
    return {
      key: c.key,
      label: c.label(target),
      target,
      // Whole units: a milestone counting down in tenths of a kilo reads as noise.
      remaining: Math.round(target - c.value),
      remainingUnit: c.unit,
      pctComplete: Math.round((progressed / c.step) * 100),
    };
  });
  candidates.sort((a, b) => b.pctComplete - a.pctComplete);
  return candidates[0];
}

// One entry per day that has a session, rest days omitted — the client fills gaps.
// Two sessions on one day merge into a single entry.
export function buildDays(sessions, today, retained = DAYS_RETAINED) {
  const cutoff = new Date(today + 'T00:00:00Z');
  cutoff.setUTCDate(cutoff.getUTCDate() - (retained - 1));
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const byDate = new Map();
  for (const s of sessions) {
    if (s.date < cutoffStr) continue;
    const existing = byDate.get(s.date);
    if (existing) {
      existing.kg += s.kg;
      if (!existing.names.includes(s.name)) existing.names.push(s.name);
    } else {
      byDate.set(s.date, { date: s.date, kg: s.kg, names: [s.name] });
    }
  }
  return [...byDate.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((d) => ({ date: d.date, kg: Math.round(d.kg), name: d.names.join(' + ') }));
}

// A baseline (the Jefit history) is added to the lifetime totals and can supply the
// best streak. The grid, current streak, last session and rolling year come from the
// Hevy sessions alone: a baseline is a set of totals with no dates in it.
export function buildStats(sessions, { today, generated = new Date().toISOString(), baseline = null } = {}) {
  const ordered = [...sessions].sort((a, b) => a.date.localeCompare(b.date));
  const day = today ?? new Date().toISOString().slice(0, 10);
  const base = baseline ?? {};

  const tonnageKg = ordered.reduce((a, s) => a + s.kg, 0) + (base.tonnageKg ?? 0);
  const workouts = ordered.length + (base.workouts ?? 0);
  const reps = ordered.reduce((a, s) => a + s.reps, 0) + (base.reps ?? 0);
  const sets = ordered.reduce((a, s) => a + (s.sets ?? 0), 0) + (base.sets ?? 0);
  const minutes = ordered.reduce((a, s) => a + s.durationMin, 0) + (base.minutes ?? 0);

  const streak = computeStreak(ordered, day);
  streak.longestWeeks = Math.max(streak.longestWeeks, base.longestStreakWeeks ?? 0);

  const yearCutoff = new Date(day + 'T00:00:00Z');
  yearCutoff.setUTCDate(yearCutoff.getUTCDate() - 364);
  const inYear = ordered.filter((s) => s.date >= yearCutoff.toISOString().slice(0, 10));

  const last = ordered[ordered.length - 1];

  return {
    generated,
    lifetime: {
      tonnageKg: Math.round(tonnageKg),
      workouts,
      reps,
      sets,
      hours: Math.round(minutes / 60),
    },
    streak,
    last: last
      ? { name: last.name, date: last.date, tonnageKg: Math.round(last.kg), durationMin: last.durationMin }
      : null,
    year: {
      workouts: inYear.length,
      tonnageKg: Math.round(inYear.reduce((a, s) => a + s.kg, 0)),
    },
    comparison: pickComparison(tonnageKg),
    nextMilestone: pickMilestone({ tonnageKg, workouts, reps }),
    days: buildDays(ordered, day),
  };
}

// The round milestone crossed since the previous run, in kg, or null. A first run has
// no previous total, and whatever it appears to cross is history rather than news, so
// it announces nothing. Without this, adding the Jefit baseline would open with a
// "1,000,000 kg lifted" email on day one.
export function emailMilestoneCrossed(previousKg, currentKg, step) {
  if (!Number.isFinite(previousKg) || !Number.isFinite(currentKg)) return null;
  const before = Math.floor(previousKg / step);
  const now = Math.floor(currentKg / step);
  return now > before ? now * step : null;
}
