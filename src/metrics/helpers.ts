/**
 * src/metrics/helpers.ts
 * Pure helper functions — Part B.2 of the Engineering Spec v2.0.
 * No imports, no side-effects. Every formula references constants by name.
 */

import {
  HRV_RATIO_MIN, HRV_RATIO_MAX,
  STRAIN_PENALTY_MAX,
  PROTEIN_MULTIPLIER_LOW, PROTEIN_MULTIPLIER_MOD, PROTEIN_MULTIPLIER_HIGH,
} from '../constants';
import { UserProfile, BiologicalSex } from '../types';

// ─── B.2 Helper functions ────────────────────────────────────────────────────

/** Returns value constrained within [min, max]. */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Smooth S-curve. Output range 0–100, inflection point at x=0.
 * sigmoid(0) = 50, sigmoid(+large) → 100, sigmoid(-large) → 0.
 */
export function sigmoid(x: number): number {
  return 100 / (1 + Math.exp(-x));
}

/**
 * Maps a ratio (value/ideal) to 0–100.
 * At value == ideal: output = 80 (room for overperformance).
 * At ratio == max_ratio: output = 100 (cap).
 * At ratio == 0: output = 0.
 * Shape: linear up to max_ratio, capped.
 */
export function normalizeRatio(
  value: number,
  ideal: number,
  maxRatio = 1.25
): number {
  if (ideal <= 0) return 0;
  const ratio = clamp(value / ideal, 0, maxRatio);
  return (ratio / maxRatio) * 100;
}

/**
 * Scores a sleep stage percentage against its ideal.
 * ideal_pct → score ≈ 83 (ratio=1.0 → (1.0/1.2)*100=83).
 * 120% of ideal → 100. Excess beyond 120% capped at 100.
 */
export function normalizePct(actualPct: number, idealPct: number): number {
  if (idealPct <= 0) return 0;
  const ratio = clamp(actualPct / idealPct, 0, 1.2);
  return clamp((ratio / 1.2) * 100 * 1.2, 0, 100);
}

/**
 * Maps sleep duration to 0–100 score.
 * Below 50% of target → 0. At 115%+ of target → 100.
 * Linear mapping: [0.5, 1.15] → [0, 100].
 *
 * Example: 7.5h / 7.5h target → ratio=1.00 → score = 76.9
 * Example: 6.0h / 7.5h target → ratio=0.80 → score = 46.2
 */
export function normalizeDuration(
  totalSleepH: number,
  targetSleepH: number
): number {
  if (targetSleepH <= 0) return 0;
  const ratio = clamp(totalSleepH / targetSleepH, 0.50, 1.15);
  return ((ratio - 0.50) / (1.15 - 0.50)) * 100;
}

/**
 * Maps prior-day strain (0–21) to a Recovery Score penalty (0 to −15 pts).
 * Linear: strain=0 → 0 penalty; strain=21 → −15 pts.
 *
 * Example: strain=14 → penalty = −10 pts
 * Example: strain=7  → penalty = −5 pts
 */
export function strainToRecoveryPenalty(strain: number): number {
  return -1 * (strain / 21) * STRAIN_PENALTY_MAX;
}

/**
 * Returns the appropriate protein multiplier (g/kg) for today's strain level.
 * Strain ≤ 8  → 1.4 (sedentary)
 * Strain 9–14 → 1.6 (moderate)
 * Strain ≥ 15 → 2.0 (high intensity)
 */
export function getProteinMultiplier(strain: number): number {
  if (strain >= 15) return PROTEIN_MULTIPLIER_HIGH; // 2.0
  if (strain >= 9)  return PROTEIN_MULTIPLIER_MOD;  // 1.6
  return PROTEIN_MULTIPLIER_LOW;                     // 1.4
}

/**
 * Returns strain capacity factor (0.0–1.10) controlling training intensity today.
 * recovery ≥ 85 → 1.10 (PEAK — overload training)
 * recovery ≥ 70 → 1.00 (HIGH — full training)
 * recovery ≥ 50 → 0.85 (MODERATE — standard session)
 * recovery ≥ 30 → 0.65 (LOW — light movement only)
 * recovery < 30 → 0.30 (REST — active recovery)
 */
export function getStrainCapacityFactor(recovery: number): number {
  if (recovery >= 85) return 1.10;
  if (recovery >= 70) return 1.00;
  if (recovery >= 50) return 0.85;
  if (recovery >= 30) return 0.65;
  return 0.30;
}

/**
 * Removes a key from a weights object and rescales the remaining weights
 * proportionally so they still sum to 1.00.
 * Used when an optional signal (HRV, resp) is unavailable.
 *
 * Example: redistribute({hrv:0.45, sleep:0.30, rhr:0.20, resp:0.05}, 'resp')
 *          → {hrv:0.474, sleep:0.316, rhr:0.211}  (all ÷ 0.95)
 */
export function redistribute(
  weights: Record<string, number>,
  removeKey: string
): Record<string, number> {
  const result: Record<string, number> = { ...weights };
  delete result[removeKey];
  const total = Object.values(result).reduce((s, w) => s + w, 0);
  if (total === 0) return result;
  for (const k of Object.keys(result)) {
    result[k] = result[k] / total;
  }
  return result;
}

// ─── Recovery band helper ─────────────────────────────────────────────────────

export type RecoveryBand = 'PEAK' | 'HIGH' | 'MODERATE' | 'LOW' | 'REST';

/** Maps a numeric Recovery Score (0–100) to its labelled band. */
export function getRecoveryBand(score: number): RecoveryBand {
  if (score >= 90) return 'PEAK';
  if (score >= 70) return 'HIGH';
  if (score >= 50) return 'MODERATE';
  if (score >= 30) return 'LOW';
  return 'REST';
}

// ─── BMR computation (B.1) ───────────────────────────────────────────────────

/**
 * Computes Basal Metabolic Rate from a user profile.
 * Defaults to Mifflin-St Jeor. Falls back to Harris-Benedict when
 * profile.bmr_formula === 'harris'.
 * For 'prefer_not_to_say': average of male and female formulas.
 */
export function computeBMR(profile: Pick<UserProfile,
  'weight_kg' | 'height_cm' | 'age' | 'biological_sex' | 'bmr_formula'>
): number {
  const { weight_kg, height_cm, age, biological_sex, bmr_formula } = profile;

  if (bmr_formula === 'harris') {
    // Harris-Benedict
    if (biological_sex === 'male') {
      return (13.397 * weight_kg) + (4.799 * height_cm) - (5.677 * age) + 88.362;
    } else if (biological_sex === 'female') {
      return (9.247 * weight_kg) + (3.098 * height_cm) - (4.330 * age) + 447.593;
    } else {
      const male   = (13.397 * weight_kg) + (4.799 * height_cm) - (5.677 * age) + 88.362;
      const female = (9.247  * weight_kg) + (3.098 * height_cm) - (4.330 * age) + 447.593;
      return (male + female) / 2;
    }
  }

  // Mifflin-St Jeor (default — most accurate for most populations)
  if (biological_sex === 'male') {
    return (10 * weight_kg) + (6.25 * height_cm) - (5 * age) + 5;
  } else if (biological_sex === 'female') {
    return (10 * weight_kg) + (6.25 * height_cm) - (5 * age) - 161;
  } else {
    const male   = (10 * weight_kg) + (6.25 * height_cm) - (5 * age) + 5;
    const female = (10 * weight_kg) + (6.25 * height_cm) - (5 * age) - 161;
    return (male + female) / 2;
  }
}
