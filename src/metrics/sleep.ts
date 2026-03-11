/**
 * src/metrics/sleep.ts
 * Sleep Score computation — Part B.5 of the Engineering Spec v2.0.
 *
 * computeSleepScore() implements the 4-component formula:
 *   score = SW_DURATION*duration_score + SW_DEEP*deep_score +
 *           SW_REM*rem_score + SW_EFFICIENCY*efficiency_score
 *
 * computeSleepDebt() accumulates deficits over the last 7 days (B.5).
 */

import {
  SW_DURATION, SW_DEEP, SW_REM, SW_EFFICIENCY,
  IDEAL_DEEP_PCT, IDEAL_REM_PCT,
  SLEEP_DEBT_WINDOW_DAYS, SLEEP_DEBT_MAX_HOURS,
  SLEEP_NEED_MAX_HOURS,
  SLEEP_STRAIN_ALPHA, SLEEP_DEBT_BETA,
} from '../constants';
import { clamp, normalizeDuration } from './helpers';
import { UserProfile } from '../types';

// ─── DB interface (narrow — only what this module needs) ─────────────────────

export interface SleepDbClient {
  getSleepSession(
    userId: string,
    dateStr: string
  ): Promise<{ onset: Date; offset: Date } | null>;

  getSleepStages(
    userId: string,
    dateStr: string
  ): Promise<{
    deep_min: number;
    rem_min: number;
    core_min: number;
    wake_min: number;
  } | null>;

  getTotalSleepHours(userId: string, dateStr: string): Promise<number | null>;

  /** Previous-day strain score (0–21). Null if no workout recorded. */
  getStrainScore(userId: string, dateStr: string): Promise<number | null>;
}

// ─── Result types ─────────────────────────────────────────────────────────────

export type Confidence = 'HIGH' | 'MEDIUM' | 'LOW';

export interface SleepScoreResult {
  score: number;
  confidence: Confidence;
  breakdown: {
    duration_score: number;
    deep_score: number;
    rem_score: number;
    efficiency_score: number;
  };
  total_sleep_h: number;
  sleep_need_h: number;
  sleep_debt_h: number;
  deep_pct: number;
  rem_pct: number;
  efficiency_pct: number;
}

// ─── Sleep Need ───────────────────────────────────────────────────────────────

/**
 * Computes the dynamic sleep need for a given night.
 * Increases with yesterday's strain and accumulated sleep debt.
 * Clamped to [sleep_target_hours, SLEEP_NEED_MAX_HOURS].
 */
export function computeSleepNeed(
  profile: Pick<UserProfile, 'sleep_target_hours'>,
  yesterdayStrain: number,
  sleepDebtH: number
): number {
  const raw =
    profile.sleep_target_hours +
    SLEEP_STRAIN_ALPHA * yesterdayStrain +
    SLEEP_DEBT_BETA * sleepDebtH;
  return clamp(raw, profile.sleep_target_hours, SLEEP_NEED_MAX_HOURS);
}

// ─── Sleep Debt ───────────────────────────────────────────────────────────────

/**
 * Accumulates sleep deficits over the last SLEEP_DEBT_WINDOW_DAYS (7) days.
 * Surplus nights do not carry over. Capped at SLEEP_DEBT_MAX_HOURS (15h).
 *
 * Note: this requires historical sleep data. Returns 0 if history is absent.
 */
export async function computeSleepDebt(
  userId: string,
  todayStr: string,
  db: SleepDbClient,
  profile: Pick<UserProfile, 'sleep_target_hours'>
): Promise<number> {
  const todayDate = new Date(todayStr);
  let totalDebtH = 0;

  for (let d = 1; d <= SLEEP_DEBT_WINDOW_DAYS; d++) {
    const dayDate = new Date(todayDate);
    dayDate.setUTCDate(dayDate.getUTCDate() - d);
    const dayStr = dayDate.toISOString().slice(0, 10);

    const actualH = await db.getTotalSleepHours(userId, dayStr);
    if (actualH === null) continue;

    // Use static target for historical nights (no recursive strain lookup)
    const need = profile.sleep_target_hours;
    const deficit = Math.max(0, need - actualH);
    totalDebtH += deficit;
  }

  return Math.min(totalDebtH, SLEEP_DEBT_MAX_HOURS);
}

// ─── Sleep Score ──────────────────────────────────────────────────────────────

// Fallback stage percentages when Apple Watch stage data is unavailable
const FALLBACK_DEEP_PCT = 0.18;
const FALLBACK_REM_PCT  = 0.20;
const FALLBACK_EFF_PCT  = 0.90;

/**
 * Computes the Sleep Score (0–100) using the 4-component formula (B.5).
 *
 * Confidence rules:
 *   HIGH   — stage-level data (deep, REM, core) present
 *   MEDIUM — total sleep + efficiency only (no stages)
 *   LOW    — in-bed time only (session but no stages and no total sleep)
 */
export async function computeSleepScore(
  userId: string,
  dateStr: string,
  db: SleepDbClient,
  profile: Pick<UserProfile, 'sleep_target_hours'>,
  yesterdayStrain = 0,
  sleepDebtH?: number
): Promise<SleepScoreResult> {

  const debtH = sleepDebtH ?? await computeSleepDebt(userId, dateStr, db, profile);
  const session = await db.getSleepSession(userId, dateStr);
  const stages  = await db.getSleepStages(userId, dateStr);

  // ── Case 1: No session at all ─────────────────────────────────────────────
  if (!session) {
    const sleepNeedH = computeSleepNeed(profile, yesterdayStrain, debtH);
    return {
      score: 0,
      confidence: 'LOW',
      breakdown: { duration_score: 0, deep_score: 0, rem_score: 0, efficiency_score: 0 },
      total_sleep_h: 0,
      sleep_need_h: sleepNeedH,
      sleep_debt_h: debtH,
      deep_pct: 0,
      rem_pct: 0,
      efficiency_pct: 0,
    };
  }

  const timeInBedH =
    (session.offset.getTime() - session.onset.getTime()) / 3_600_000;

  let totalSleepH: number;
  let deepPct: number;
  let remPct: number;
  let efficiencyPct: number;
  let confidence: Confidence;

  // ── Case 2: Full stage data available ────────────────────────────────────
  if (stages) {
    totalSleepH = (stages.deep_min + stages.rem_min + stages.core_min) / 60;
    efficiencyPct = clamp(totalSleepH / timeInBedH, 0, 1) * 100;
    deepPct = totalSleepH > 0 ? stages.deep_min / (totalSleepH * 60) : 0;
    remPct  = totalSleepH > 0 ? stages.rem_min  / (totalSleepH * 60) : 0;
    confidence = 'HIGH';
  } else {
    // ── Case 3: In-bed time only — use fallback ratios ───────────────────
    totalSleepH  = timeInBedH * FALLBACK_EFF_PCT;
    efficiencyPct = FALLBACK_EFF_PCT * 100;
    deepPct = FALLBACK_DEEP_PCT;
    remPct  = FALLBACK_REM_PCT;
    confidence = 'LOW';
  }

  const sleepNeedH = computeSleepNeed(profile, yesterdayStrain, debtH);

  // ── 4-component scores ────────────────────────────────────────────────────
  const durationScore   = normalizeDuration(totalSleepH, sleepNeedH);
  const deepScore       = clamp((deepPct / IDEAL_DEEP_PCT) * 100, 0, 100);
  const remScore        = clamp((remPct  / IDEAL_REM_PCT)  * 100, 0, 100);
  const efficiencyScore = clamp(efficiencyPct, 0, 100);

  const score = clamp(
    SW_DURATION   * durationScore +
    SW_DEEP       * deepScore +
    SW_REM        * remScore +
    SW_EFFICIENCY * efficiencyScore,
    0, 100
  );

  return {
    score: Math.round(score * 10) / 10,
    confidence,
    breakdown: {
      duration_score:   Math.round(durationScore),
      deep_score:       Math.round(deepScore),
      rem_score:        Math.round(remScore),
      efficiency_score: Math.round(efficiencyScore),
    },
    total_sleep_h:  Math.round(totalSleepH * 100) / 100,
    sleep_need_h:   Math.round(sleepNeedH  * 100) / 100,
    sleep_debt_h:   Math.round(debtH       * 100) / 100,
    deep_pct:       Math.round(deepPct     * 1000) / 1000,
    rem_pct:        Math.round(remPct      * 1000) / 1000,
    efficiency_pct: Math.round(efficiencyPct * 10) / 10,
  };
}
