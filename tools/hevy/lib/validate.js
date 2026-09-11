import {
  MAX_JUMP_KG_PER_3H,
  RATIO_GUARD_FLOOR_KG,
  RATIO_GUARD_MULTIPLE,
  RATIO_GUARD_MAX_HOURS,
} from '../config.js';

// Wrong shape means something upstream changed. Refuse rather than publish nonsense.
export function validate(stats) {
  const problems = [];
  const lifetime = stats?.lifetime;

  if (!stats || typeof stats.generated !== 'string') problems.push('generated missing');
  if (!lifetime) {
    problems.push('lifetime missing');
  } else {
    if (!Number.isFinite(lifetime.tonnageKg) || lifetime.tonnageKg <= 0) {
      problems.push('tonnageKg invalid: ' + lifetime.tonnageKg);
    }
    if (!Number.isInteger(lifetime.workouts) || lifetime.workouts < 1) {
      problems.push('workouts invalid: ' + lifetime.workouts);
    }
    if (!Number.isInteger(lifetime.reps) || lifetime.reps < 0) {
      problems.push('reps invalid: ' + lifetime.reps);
    }
    if (!Number.isFinite(lifetime.hours) || lifetime.hours < 0) {
      problems.push('hours invalid: ' + lifetime.hours);
    }
    if (!Number.isInteger(lifetime.sets) || lifetime.sets < 0) {
      problems.push('sets invalid: ' + lifetime.sets);
    }
  }
  if (!Array.isArray(stats?.days)) problems.push('days is not an array');
  if (!stats?.last?.date) problems.push('last session missing');
  if (!stats?.comparison?.unit) problems.push('comparison missing');

  const milestone = stats?.nextMilestone;
  if (!milestone || !Number.isFinite(milestone.pctComplete) ||
      milestone.pctComplete < 0 || milestone.pctComplete > 100) {
    problems.push('nextMilestone invalid');
  }
  return problems;
}

// Guards run in both directions. A "did it go down" check alone would sail straight
// past a unit change to lb, which roughly doubles every number at once.
export function sanityCheck(stats, state, now = Date.now()) {
  if (!state || !Number.isFinite(state.lastTonnageKg)) return []; // first run has no baseline

  const current = stats.lifetime.tonnageKg;
  const previous = state.lastTonnageKg;
  const problems = [];

  if (current < previous) {
    problems.push('tonnage fell: ' + previous + ' -> ' + current + ' (partial paginated response?)');
  }

  const hours = state.lastSuccessAt
    ? Math.max(0.5, (now - new Date(state.lastSuccessAt).getTime()) / 3600000)
    : 3;
  const allowed = MAX_JUMP_KG_PER_3H * Math.max(1, hours / 3);
  if (current - previous > allowed) {
    problems.push(
      'tonnage jumped ' + Math.round(current - previous) + ' kg in ' + hours.toFixed(1) +
      'h (cap ' + Math.round(allowed) + ' kg) - unit change?'
    );
  }

  // The absolute cap alone has a blind spot: while lifetime tonnage is still small,
  // a unit change doubles it by less than the cap and sails straight through. A
  // near-doubling is the signature of that fault at any scale, so check the ratio
  // too. The floor keeps it away from the early runs, where one big session really
  // can be a large fraction of a small total.
  if (hours <= RATIO_GUARD_MAX_HOURS &&
      previous >= RATIO_GUARD_FLOOR_KG &&
      current >= previous * RATIO_GUARD_MULTIPLE) {
    problems.push(
      'tonnage nearly doubled: ' + previous + ' -> ' + current +
      ' (x' + (current / previous).toFixed(2) + ') - unit change?'
    );
  }
  return problems;
}
