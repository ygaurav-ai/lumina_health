/**
 * src/metrics/recovery.ts
 * Recovery Score computation — Part B.3 of the Engineering Spec v2.0.
 *
 * Two-layer architecture:
 *   Layer 1 — Physiological Base Score (Apple Health only)
 *   Layer 2 — Nutritional & Strain modifiers
 *
 * Layer 2 modifiers default to 0 when no nutrition data exists.
 * This means the score works without nutrition from day one — nutrition
 * data upgrades the score, it does not gate it.
 */

import {
  W_HRV, W_SLEEP, W_RHR, W_RESP,
  HRV_RATIO_MIN, HRV_RATIO_MAX,
  RHR_SENSITIVITY,
  SLEEP_INTERFERENCE_PENALTY,
  PROTEIN_RECOVERY_BONUS,
} from '../constants';
import {
  clamp, sigmoid, redistribute,
  strainToRecoveryPenalty,
  getRecoveryBand, RecoveryBand,
} from './helpers';
import { SleepScoreResult, Confidence, SleepDbClient } from './sleep';
import { UserProfile } from '../types';

// ─── DB interface ─────────────────────────────────────────────────────────────

export interface RecoveryDbClient extends SleepDbClient {
  /** Morning HRV SDNN (ms) from 04:00–09:00 window. Null if unavailable. */
  getMorningHRV(userId: string, dateStr: string): Promise<number | null>;

  /** Daily resting heart rate from HealthKit. Null if unavailable. */
  getDailyRHR(userId: string, dateStr: string): Promise<number | null>;

  /** Rolling median for a given metric type over windowDays. */
  getRollingMedian(
    userId: string,
    metricType: string,
    windowDays: number
  ): Promise<number | null>;

  /** Respiratory rate captured during sleep (optional — requires Apple Watch). */
  getSleepRespRate(userId: string, dateStr: string): Promise<number | null>;

  /** Yesterday's Strain score (0–21). Null if no workout recorded. */
  getStrainScore(userId: string, dateStr: string): Promise<number | null>;

  /** Returns null when no nutrition data has been ingested for that day. */
  getNutritionSummary(
    userId: string,
    dateStr: string
  ): Promise<{
    protein_consumed_g: number;
    sleep_interference_score: number; // 0–100, pre-computed
    protein_score: number;            // 0–100, pre-computed
  } | null>;

  getUserProfile(userId: string): Promise<UserProfile | null>;
}

// ─── Result types ─────────────────────────────────────────────────────────────

export interface RecoveryResult {
  score: number;
  band: RecoveryBand;
  confidence: Confidence;
  breakdown: {
    physio_base: number;
    hrv_component: number;
    sleep_component: number;
    rhr_component: number;
    resp_component: number;
    nutrition_modifier_pts: number;
    strain_penalty_pts: number;
  };
}

// ─── Confidence computation ───────────────────────────────────────────────────

function computeRecoveryConfidence(
  hrv: number | null,
  sleepResult: SleepScoreResult
): Confidence {
  const hasHRV   = hrv !== null;
  const hasStages = sleepResult.confidence === 'HIGH';

  if (hasHRV && hasStages) return 'HIGH';
  if (hasHRV || hasStages) return 'MEDIUM';
  return 'LOW';
}

// ─── Recovery Score ───────────────────────────────────────────────────────────

/**
 * Computes the full Recovery Score for a given user and date.
 *
 * Layer 1 (physiology):
 *   physio_base = W_HRV*hrv_score + W_SLEEP*sleep_score + W_RHR*rhr_score
 *               + W_RESP*resp_score
 *   Missing signals are removed and weights redistributed proportionally.
 *
 * Layer 2 (nutrition + strain):
 *   nutrition_modifier = protein_bonus - interference_penalty
 *   final = clamp(physio_base * (1 + modifier) + strain_penalty, 0, 100)
 *
 * @param userId   - user UUID
 * @param dateStr  - ISO date string e.g. '2026-03-11'
 * @param db       - DB client (mocked in tests)
 * @param sleepResult - pre-computed sleep score (avoids duplicate DB queries)
 */
export async function computeRecovery(
  userId: string,
  dateStr: string,
  db: RecoveryDbClient,
  sleepResult: SleepScoreResult
): Promise<RecoveryResult> {

  // ── Layer 1: Physiology ───────────────────────────────────────────────────
  const [hrv, baseHRV, rhr, baseRHR, respRate, baseResp, yesterdayStrain] =
    await Promise.all([
      db.getMorningHRV(userId, dateStr),
      db.getRollingMedian(userId, 'hrv_sdnn', 30),
      db.getDailyRHR(userId, dateStr),
      db.getRollingMedian(userId, 'resting_hr', 30),
      db.getSleepRespRate(userId, dateStr),
      db.getRollingMedian(userId, 'resp_rate', 30),
      db.getStrainScore(userId, (() => {
        const d = new Date(dateStr + 'T00:00:00Z');
        d.setUTCDate(d.getUTCDate() - 1);
        return d.toISOString().slice(0, 10);
      })()),
    ]);

  // HRV component
  let hrvScore: number | null = null;
  if (hrv !== null && baseHRV !== null && baseHRV > 0) {
    const ratio = clamp(hrv / baseHRV, HRV_RATIO_MIN, HRV_RATIO_MAX);
    hrvScore = ((ratio - HRV_RATIO_MIN) / (HRV_RATIO_MAX - HRV_RATIO_MIN)) * 100;
  }

  // RHR component — sigmoid on delta (positive delta = better)
  let rhrScore = 50; // neutral default
  if (rhr !== null && baseRHR !== null) {
    const rhrDelta = baseRHR - rhr; // positive = lower than usual = better
    rhrScore = sigmoid(rhrDelta / RHR_SENSITIVITY);
  }

  // Respiratory rate component (optional)
  let respScore: number | null = null;
  if (respRate !== null && baseResp !== null) {
    respScore = clamp(100 - ((respRate - baseResp) / 2) * 20, 0, 100);
  }

  // Sleep score
  const sleepScore = sleepResult.score;

  // Weight normalisation — remove unavailable signals, rescale
  let weights: Record<string, number> = {
    hrv:   W_HRV,
    sleep: W_SLEEP,
    rhr:   W_RHR,
    resp:  W_RESP,
  };
  if (hrvScore === null)  weights = redistribute(weights, 'hrv');
  if (respScore === null) weights = redistribute(weights, 'resp');

  const physioBase = clamp(
    (weights.hrv   ?? 0) * (hrvScore  ?? 0) +
    (weights.sleep ?? 0) * sleepScore +
    (weights.rhr   ?? 0) * rhrScore +
    (weights.resp  ?? 0) * (respScore ?? 0),
    0, 100
  );

  // ── Layer 2: Nutrition & Strain ───────────────────────────────────────────
  const nutritionData = await db.getNutritionSummary(userId, dateStr);

  const interferenceScore = nutritionData?.sleep_interference_score ?? 0;
  const proteinScore      = nutritionData?.protein_score ?? 0;

  const interferencePenalty = (interferenceScore / 100) * SLEEP_INTERFERENCE_PENALTY;
  const proteinBonus        = (proteinScore      / 100) * PROTEIN_RECOVERY_BONUS;
  const nutritionModifier   = proteinBonus - interferencePenalty;

  const strainPenalty = yesterdayStrain !== null
    ? strainToRecoveryPenalty(yesterdayStrain)
    : 0;

  const recoveryRaw = physioBase * (1 + nutritionModifier) + strainPenalty;
  const score       = Math.round(clamp(recoveryRaw, 0, 100));

  const confidence = computeRecoveryConfidence(hrv, sleepResult);

  return {
    score,
    band: getRecoveryBand(score),
    confidence,
    breakdown: {
      physio_base:           Math.round(physioBase),
      hrv_component:         Math.round((weights.hrv   ?? 0) * (hrvScore  ?? 0)),
      sleep_component:       Math.round((weights.sleep ?? 0) * sleepScore),
      rhr_component:         Math.round((weights.rhr   ?? 0) * rhrScore),
      resp_component:        Math.round((weights.resp  ?? 0) * (respScore ?? 0)),
      nutrition_modifier_pts: Math.round(nutritionModifier * physioBase),
      strain_penalty_pts:    Math.round(strainPenalty),
    },
  };
}
