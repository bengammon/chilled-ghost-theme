// Configuration for the Hevy training pipeline.
//
// The exercise lists below are FROZEN. Adding or removing an entry re-prices every
// past session, which moves lifetime tonnage retroactively — the one thing this
// pipeline must never do. If a new exercise needs classifying, add it BEFORE its
// first session is counted, never after.

// Overridable so the pipeline can be exercised end-to-end against a stub.
export const API_BASE = process.env.HEVY_API_BASE || 'https://api.hevyapp.com/v1';

// Exercises logged as the weight ONE limb moved. Doubled for total weight moved.
// Keyed by exerciseTemplateId, which is stable; names are display-only and can change.
export const PER_LIMB = new Set([
  '878CD1D0', // Shoulder Press (Dumbbell)
  'DE68C825', // Single Arm Lateral Raise (Cable)
  'AA1EB7D8', // Iso-Lateral Row (Machine) — includes the machine's 11kg starting resistance
  '293483AD', // Low Cable Fly Crossovers
  'C315DC2A', // Rear Delt Reverse Fly (Cable)
  'CC55119B', // Cable Core Pallof Press
]);

// Bodyweight-loaded: weight is null, so the lifter's bodyweight is the load.
// Any weight logged against these is ADDED (a weighted dip is bodyweight + belt).
export const BODYWEIGHT = new Set([
  '6FCD7755', // Chest Dip
  '1B2B1E7C', // Pull Up
]);

// Assisted: the logged weight is how much the machine took OFF, not what was lifted.
export const ASSISTED = new Set([
  '2C37EC5E', // Pull Up (Assisted)
]);

// Exercises with a null weight that are NOT bodyweight-loaded contribute 0 kg.
// They still count toward rep totals. Ab Wheel (99D5F10E) is the current example —
// listed here for the reader's benefit only; the code needs no membership test.

// Bodyweight used for dates before the first Hevy measurement entry. The API is the
// real source (see lib/bodyweight.js); this is the floor under a total API failure.
export const FALLBACK_BODYWEIGHT = [
  { date: '2026-06-26', kg: 93.4 },
];

// Milestone scales. Nearest-by-percentage is the one surfaced.
export const MILESTONES = {
  tonnageKg: 100_000,
  workouts: 100,
  reps: 10_000,
};

// A round milestone worth writing a post about — triggers a Brevo email.
export const EMAIL_MILESTONE_KG = 500_000;

// Jefit history, 2 January 2024 to 21 June 2026: the app used before Hevy. Added once
// to the Hevy lifetime totals rather than merged session by session, so the grid and
// the current streak stay Hevy-only. FROZEN, like the lists above: this is history,
// and changing it moves every lifetime figure retroactively.
//
// Derived from Jefit's CSV export, which is kept privately. It holds personal data and
// never belongs in this repo.
//   tonnageKg   Jefit's own per-session total_weight, summed. Jefit's rules, not ours:
//               it gives dips and pull-ups nothing, so this errs low.
//   reps, sets  Parsed from the set strings, reps > 0 only. Timed work (walking,
//               cycling, planks, dead bugs, dead hangs) is excluded, because Jefit
//               stores seconds in the reps field.
//   minutes     Session start to end. Five sessions count at the 71-minute median:
//               one left running for 122 days, four logged after the fact.
//   longestStreakWeeks  Consecutive weeks with a session, January to April 2024. The
//               best streak shown is the longer of this and Hevy's own.
export const JEFIT_BASELINE = Object.freeze({
  tonnageKg: 1_057_640.1,
  workouts: 169,
  reps: 29_227,
  sets: 3_425,
  minutes: 12_265,
  longestStreakWeeks: 16,
});

// Absurd comparison. Pick the largest unit still giving a count of 1 or more,
// so it re-rolls upward as the number climbs. Tonnes.
export const COMPARISONS = [
  { unit: 'London buses',  singular: 'London bus',  tonnes: 12,     emoji: '🚌' },
  { unit: 'blue whales',   singular: 'blue whale',  tonnes: 150,    emoji: '🐋' },
  { unit: 'Space Shuttles',singular: 'Space Shuttle',tonnes: 2_030, emoji: '🚀' },
  { unit: 'Eiffel Towers', singular: 'Eiffel Tower',tonnes: 10_100, emoji: '🗼' },
];
export const COMPARISON_MAX = 20;

// Grid colour buckets. Fixed thresholds so a colour means the same weight forever.
export const BUCKETS = [2_000, 4_000, 6_500];

// Refuse a run that adds more than this per 3 hours elapsed — catches a unit change
// to lb, which a "did it go down" check alone would sail straight past.
export const MAX_JUMP_KG_PER_3H = 30_000;

// Second guard, catching what the absolute cap misses while the lifetime total is
// still small: a near-doubling in one run is a unit change, not training. The floor
// keeps it clear of early runs, where one session is legitimately a big fraction.
export const RATIO_GUARD_FLOOR_KG = 25_000;
export const RATIO_GUARD_MULTIPLE = 1.9;
// Only meaningful at a normal cron cadence. After a long outage a genuine backlog of
// sessions can look like a doubling, so past this the absolute cap stands alone.
export const RATIO_GUARD_MAX_HOURS = 24;

// Retry policy for transient upstream failures (5xx, 429).
export const RETRY = { attempts: 3, baseDelayMs: 1_000 };

export const DAYS_RETAINED = 365;   // days[] window; the front-end shows a 90-day slice
export const PUBLIC_URL = process.env.PUBLIC_STATS_URL || 'https://bengammon.co.uk/training.json';
export const DATA_DIR = process.env.HEVY_DATA_DIR || '/var/www/hevy';
