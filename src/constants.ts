// ═══════════════════════════════════════════════════════════════════════════
// LUMINA HEALTH — CANONICAL CONSTANTS REGISTRY v2.0
// Source: Engineering Specification v2.0, Part B.0
//
// All formula constants are defined here. Every formula references these
// by name. Changing a value here propagates everywhere. Loaded at app start
// — never hardcoded inline.
// ═══════════════════════════════════════════════════════════════════════════

// ─── Baseline Windows ───────────────────────────────────────────────────────
/** Rolling window for ALL personal baselines (HRV, RHR, Sleep, Strain, Resp Rate) */
export const BASELINE_WINDOW_DAYS = 30;

// ─── Recovery Score Weights (Layer 1 — Physiology) ──────────────────────────
/** HRV SDNN component weight */
export const W_HRV = 0.45;
/** Sleep Score component weight */
export const W_SLEEP = 0.30;
/** Resting Heart Rate component weight */
export const W_RHR = 0.20;
/** Respiratory Rate component weight (optional) */
export const W_RESP = 0.05;
// Sum = 1.00
// If RESP missing: W_HRV=0.47, W_SLEEP=0.32, W_RHR=0.21 (redistributed proportionally)

// ─── Recovery Score Modifiers (Layer 2 — Nutrition & Strain) ────────────────
/** Maximum ±20% adjustment from nutrition on Recovery Score */
export const NUTRITION_MODIFIER_MAX = 0.20;
/** Interference=100 → −15 pts to Recovery */
export const SLEEP_INTERFERENCE_PENALTY = 0.15;
/** Protein=100 → +5 pts to Recovery */
export const PROTEIN_RECOVERY_BONUS = 0.05;
/** Maximum −15 pts from prior-day strain load */
export const STRAIN_PENALTY_MAX = 15.0;

// ─── HRV Scoring ────────────────────────────────────────────────────────────
/** Below 50% of baseline → HRV score = 0 */
export const HRV_RATIO_MIN = 0.50;
/** Above 125% of baseline → HRV score = 100 */
export const HRV_RATIO_MAX = 1.25;

// ─── RHR Scoring ────────────────────────────────────────────────────────────
/** bpm delta that moves rhr_score by ~50 pts */
export const RHR_SENSITIVITY = 5.0;

// ─── Sleep Score Component Weights ──────────────────────────────────────────
/** Duration vs target weight */
export const SW_DURATION = 0.40;
/** Deep sleep % weight */
export const SW_DEEP = 0.25;
/** REM sleep % weight */
export const SW_REM = 0.20;
/** Sleep efficiency weight */
export const SW_EFFICIENCY = 0.15;
// Sum = 1.00

// ─── Sleep Targets ──────────────────────────────────────────────────────────
/** Ideal deep sleep as a fraction of total sleep time */
export const IDEAL_DEEP_PCT = 0.20;
/** Ideal REM sleep as a fraction of total sleep time */
export const IDEAL_REM_PCT = 0.22;
/** Days over which sleep debt is accumulated */
export const SLEEP_DEBT_WINDOW_DAYS = 7;
/** Cap on sleep debt to prevent runaway values (hours) */
export const SLEEP_DEBT_MAX_HOURS = 15.0;
/** Cap on computed sleep need to prevent unrealistic targets (hours) */
export const SLEEP_NEED_MAX_HOURS = 10.0;
/** Each Strain unit adds ~1.8 min (0.03 h) to sleep need */
export const SLEEP_STRAIN_ALPHA = 0.03;
/** Each hour of sleep debt adds ~6 min (0.10 h) extra sleep need */
export const SLEEP_DEBT_BETA = 0.10;

// ─── Strain Score ────────────────────────────────────────────────────────────
/** TRIMP → 0–21 mapping tuning constant */
export const STRAIN_K = 0.004;
/** Default max HR used when user max HR has not been established */
export const HR_MAX_DEFAULT = 190;

/** Karvonen zone boundaries as fractions of HR reserve */
export const HR_RESERVE_ZONES: Record<string, [number, number]> = {
  z1: [0.50, 0.60], // Recovery / very light
  z2: [0.60, 0.70], // Aerobic / fat-burning
  z3: [0.70, 0.80], // Tempo / aerobic threshold
  z4: [0.80, 0.90], // Threshold / lactate
  z5: [0.90, 1.00], // VO2max / anaerobic
};

/** TRIMP zone weights (z1 → z5) */
export const ZONE_WEIGHTS = [1.0, 2.0, 3.5, 5.5, 8.0];

// ─── Nutrition & Interference ────────────────────────────────────────────────
/** Exponential decay time constant for meal-sleep interference (minutes) */
export const MEAL_INTERFERENCE_TAU_MIN = 120;
/** Effective pre-sleep window for late meal detection (hours) */
export const MEAL_INTERFERENCE_WINDOW_H = 2.5;
/** Weight of calorie load in sleep interference score */
export const INTERFERENCE_W_CALORIES = 0.30;
/** Weight of sugar load in sleep interference score */
export const INTERFERENCE_W_SUGAR = 0.70;
/** Normalisation divisor for calorie term */
export const INTERFERENCE_CALORIE_NORM = 600;
/** Normalisation divisor for sugar term (grams) */
export const INTERFERENCE_SUGAR_NORM = 30;

// ─── Protein Targets ─────────────────────────────────────────────────────────
/** g/kg bodyweight — sedentary days (Strain ≤ 8) */
export const PROTEIN_MULTIPLIER_LOW = 1.4;
/** g/kg bodyweight — moderate training days (Strain 9–14) */
export const PROTEIN_MULTIPLIER_MOD = 1.6;
/** g/kg bodyweight — high intensity days (Strain ≥ 15) */
export const PROTEIN_MULTIPLIER_HIGH = 2.0;

// ─── Hydration Targets ───────────────────────────────────────────────────────
/** Base hydration: 35 ml per kg bodyweight per day */
export const HYDRATION_BASE_ML_PER_KG = 35;
/** Add 10 ml per minute of workout above Zone 2 */
export const HYDRATION_WORKOUT_ML_PER_MIN = 10;
/** Add 150 ml per 1000 mg sodium above the 2000 mg baseline */
export const HYDRATION_SODIUM_FACTOR = 150;

// ─── Illness Flag Thresholds ─────────────────────────────────────────────────
/** HRV must drop ≥ 15% below 30-day median to trigger signal */
export const ILLNESS_HRV_DROP_PCT = 0.15;
/** HRV drop must persist for ≥ 2 consecutive days */
export const ILLNESS_HRV_SUSTAINED_DAYS = 2;
/** RHR rise of +7 bpm above 30-day median triggers signal */
export const ILLNESS_RHR_RISE_BPM = 7;
/** Respiratory rate rise of +3 breaths/min above personal norm triggers signal */
export const ILLNESS_RESP_RISE_BPM = 3;

// ─── Evidence Selection ───────────────────────────────────────────────────────
/** Signals must deviate ≥ 1σ from personal baseline to qualify as evidence */
export const EVIDENCE_MIN_DEVIATION_SIGMA = 1.0;
/** Show top N evidence items on the dashboard Evidence Ribbon */
export const EVIDENCE_TOP_N = 3;

// ─── Derived / Composite constants (computed from above) ─────────────────────
/** Theoretical maximum raw_interference value for normalisation */
export const INTERFERENCE_NORM_MAX = 2.00;

// ─── Recovery Score Bands ────────────────────────────────────────────────────
export const RECOVERY_BANDS = [
  { label: 'PEAK',     min: 90, max: 100, color: '#059669', action: 'Push hard today — ideal for PBs or new stress' },
  { label: 'HIGH',     min: 70, max: 89,  color: '#0D9488', action: 'Full training session appropriate' },
  { label: 'MODERATE', min: 50, max: 69,  color: '#D97706', action: 'Standard session — avoid max intensity' },
  { label: 'LOW',      min: 30, max: 49,  color: '#DC2626', action: 'Light movement, stretching, technique work only' },
  { label: 'REST',     min: 0,  max: 29,  color: '#7C3AED', action: 'Rest, light walking, recovery nutrition focus' },
] as const;

// ─── Signal Relevance Weights (Evidence Ribbon, B.10) ────────────────────────
export const SIGNAL_RELEVANCE: Record<string, number> = {
  hrv:                 1.00,
  deep_sleep:          0.90,
  rhr:                 0.85,
  rem_sleep:           0.80,
  strain_yesterday:    0.75,
  sleep_duration:      0.70,
  sleep_interference:  0.65,
  protein_score:       0.40,
};
