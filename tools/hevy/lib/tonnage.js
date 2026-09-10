import { PER_LIMB, BODYWEIGHT, ASSISTED } from '../config.js';

// Total weight moved = sum of weight x reps across every set, warmups included.
// This is total weight moved, not total productive weight moved. The absurd number
// is the point.

export function setTonnage(templateId, set, bodyweightKg) {
  const reps = Number(set.reps) || 0;
  if (reps <= 0) return 0;
  // The REST API returns weight_kg; the hevy-mcp wrapper renames it to weight.
  // Accept both so the same logic works against a live pull and a captured fixture.
  const logged = Number(set.weight_kg ?? set.weight) || 0;

  if (ASSISTED.has(templateId)) {
    // The logged figure is what the machine took off, so the lifter moved the rest.
    // Clamped at zero: an assist heavier than bodyweight is a logging slip, not
    // negative work.
    return Math.max(0, bodyweightKg - logged) * reps;
  }

  if (BODYWEIGHT.has(templateId)) {
    // Any logged weight is additional load — a weighted dip is bodyweight plus belt.
    return (bodyweightKg + logged) * reps;
  }

  // Everything else. A null weight here (ab wheel, stretches) is genuinely zero load;
  // the reps still count toward rep totals, just not toward weight moved.
  return logged * reps * (PER_LIMB.has(templateId) ? 2 : 1);
}

// Reduces one workout to the figures stats.json cares about.
export function summariseWorkout(workout, bodyweightOn) {
  const date = String(workout.start_time || workout.startTime || '').slice(0, 10);
  const bodyweightKg = bodyweightOn(date);

  let kg = 0;
  let reps = 0;
  let sets = 0;
  for (const exercise of workout.exercises ?? []) {
    const templateId = exercise.exercise_template_id ?? exercise.exerciseTemplateId;
    for (const set of exercise.sets ?? []) {
      const r = Number(set.reps) || 0;
      if (r > 0) sets++;
      reps += r;
      kg += setTonnage(templateId, set, bodyweightKg);
    }
  }

  const start = new Date(workout.start_time ?? workout.startTime);
  const end = new Date(workout.end_time ?? workout.endTime);
  const durationMin = Number.isFinite(start.getTime()) && Number.isFinite(end.getTime())
    ? Math.max(0, Math.round((end - start) / 60_000))
    : 0;

  return {
    id: workout.id,
    date,
    name: workout.title || 'Workout',
    // Kept unrounded on purpose: cable stacks are imperial and land on odd decimals.
    // Sum raw, round once at display time.
    kg,
    reps,
    sets,
    durationMin,
    bodyweightKg,
  };
}
