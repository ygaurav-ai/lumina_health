/**
 * src/routes/dashboard.ts
 *
 * GET  /api/v1/user/:id/baseline  — rolling 30-day medians
 * GET  /api/v1/user/:id/dashboard — full dashboard payload (Part D.1)
 * POST /api/v1/ai/explain          — deterministic template stub (Phase 1)
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { query } from '../db/client';
import { buildMetricsDb } from '../metrics/db_queries';
import { computeSleepScore } from '../metrics/sleep';
import { computeRecovery } from '../metrics/recovery';
import { getStrainCapacityFactor } from '../metrics/helpers';
import { BASELINE_WINDOW_DAYS } from '../constants';

interface UserParams { id: string; }

// ─── Median helper (in-process) ───────────────────────────────────────────────

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

// ─── GET /api/v1/user/:id/baseline ───────────────────────────────────────────

async function baselineHandler(
  request: FastifyRequest<{ Params: UserParams }>,
  reply: FastifyReply
) {
  const { id: userId } = request.params;

  // Check profile exists
  const profileRes = await query(
    `SELECT user_id FROM user_profile WHERE user_id = $1`, [userId]
  );
  if (profileRes.rows.length === 0) {
    reply.code(404);
    return { error: 'User not found' };
  }

  // Fetch rolling window samples for the three baseline metrics
  const [hrvRows, rhrRows, respRows] = await Promise.all([
    query<{ value: string }>(
      `SELECT value FROM physiology_samples
       WHERE user_id = $1 AND type = 'hrv_sdnn'
         AND ts >= NOW() - ($2 || ' days')::interval
       ORDER BY ts`,
      [userId, BASELINE_WINDOW_DAYS]
    ),
    query<{ value: string }>(
      `SELECT value FROM physiology_samples
       WHERE user_id = $1 AND type = 'resting_hr'
         AND ts >= NOW() - ($2 || ' days')::interval
       ORDER BY ts`,
      [userId, BASELINE_WINDOW_DAYS]
    ),
    query<{ value: string }>(
      `SELECT value FROM physiology_samples
       WHERE user_id = $1 AND type = 'resp_rate'
         AND ts >= NOW() - ($2 || ' days')::interval
       ORDER BY ts`,
      [userId, BASELINE_WINDOW_DAYS]
    ),
  ]);

  const hrvValues  = hrvRows.rows.map(r  => parseFloat(r.value));
  const rhrValues  = rhrRows.rows.map(r  => parseFloat(r.value));
  const respValues = respRows.rows.map(r => parseFloat(r.value));

  // Days of data = distinct dates that have at least one HRV reading
  // (HRV is the primary signal; use whichever metric has most data)
  const daysRes = await query<{ days: string }>(
    `SELECT COUNT(DISTINCT ts::date) AS days FROM physiology_samples
     WHERE user_id = $1
       AND type IN ('hrv_sdnn','resting_hr')
       AND ts >= NOW() - ($2 || ' days')::interval`,
    [userId, BASELINE_WINDOW_DAYS]
  );
  const daysOfData = parseInt(daysRes.rows[0]?.days ?? '0', 10);

  const hrv_median  = median(hrvValues);
  const rhr_median  = median(rhrValues);
  const resp_median = median(respValues);

  // Cache into baselines table for fast reads
  const computedAt = new Date().toISOString();
  const toCache: { metric: string; value: number | null }[] = [
    { metric: 'hrv_median',  value: hrv_median  },
    { metric: 'rhr_median',  value: rhr_median  },
    { metric: 'resp_median', value: resp_median },
  ];
  for (const { metric, value } of toCache) {
    if (value !== null) {
      await query(
        `INSERT INTO baselines (user_id, metric_type, median_value, computed_at)
         VALUES ($1, $2, $3, $4::timestamptz)
         ON CONFLICT (user_id, metric_type) DO UPDATE SET
           median_value = EXCLUDED.median_value,
           computed_at  = EXCLUDED.computed_at`,
        [userId, metric, value, computedAt]
      );
    }
  }

  reply.code(200);
  return {
    user_id:              userId,
    hrv_median:           hrv_median  !== null ? Math.round(hrv_median  * 10) / 10 : null,
    rhr_median:           rhr_median  !== null ? Math.round(rhr_median  * 10) / 10 : null,
    resp_median:          resp_median !== null ? Math.round(resp_median * 10) / 10 : null,
    days_of_data:         daysOfData,
    baseline_established: daysOfData >= 14,
    window_days:          BASELINE_WINDOW_DAYS,
    computed_at:          computedAt,
  };
}

// ─── GET /api/v1/user/:id/dashboard ──────────────────────────────────────────

async function dashboardHandler(
  request: FastifyRequest<{ Params: UserParams; Querystring: { date?: string } }>,
  reply: FastifyReply
) {
  const { id: userId } = request.params;
  const dateStr = (request.query as { date?: string }).date
    ?? new Date().toISOString().slice(0, 10);

  const db = buildMetricsDb();

  // Profile required
  const profile = await db.getUserProfile(userId);
  if (!profile) {
    reply.code(404);
    return { error: 'User not found' };
  }

  // Compute sleep + recovery
  const sleepResult = await computeSleepScore(userId, dateStr, db, profile);
  const recoveryResult = await computeRecovery(userId, dateStr, db, sleepResult);

  // Strain (Phase 0 stub → null)
  const strainScore = null;
  const capacityFactor = recoveryResult.score !== null
    ? getStrainCapacityFactor(recoveryResult.score)
    : null;

  // Nutrition block — null until Phase 2 nutrition metrics are implemented
  const nutritionData = await db.getNutritionSummary(userId, dateStr);

  reply.code(200);
  return {
    user_id: userId,
    date:    dateStr,

    recovery: {
      score:      recoveryResult.score,
      band:       recoveryResult.band,
      confidence: recoveryResult.confidence,
      breakdown:  recoveryResult.breakdown,
    },

    sleep: {
      score:          sleepResult.score,
      confidence:     sleepResult.confidence,
      total_hours:    sleepResult.total_sleep_h,
      sleep_need_hours: sleepResult.sleep_need_h,
      deep_pct:       sleepResult.deep_pct,
      rem_pct:        sleepResult.rem_pct,
      efficiency_pct: sleepResult.efficiency_pct,
      sleep_debt_hours: sleepResult.sleep_debt_h,
    },

    strain: {
      score:           strainScore,
      confidence:      'LOW',  // Phase 2 will add workout data
      target:          strainScore !== null && capacityFactor !== null
                         ? Math.round((strainScore as number) * capacityFactor * 10) / 10
                         : null,
      capacity_factor: capacityFactor,
    },

    nutrition: nutritionData
      ? {
          available:             true,
          protein_score:         nutritionData.protein_score,
          protein_consumed_g:    nutritionData.protein_consumed_g,
          protein_target_g:      null, // Phase 2
          sleep_interference:    nutritionData.sleep_interference_score,
          metabolic_balance:     null, // Phase 2
          hydration_pct:         null, // Phase 2
        }
      : {
          available:             false,
          protein_score:         null,
          protein_consumed_g:    null,
          protein_target_g:      null,
          sleep_interference:    null,
          metabolic_balance:     null,
          hydration_pct:         null,
        },

    illness_flag: null, // Phase 3

    metadata: {
      computed_at:         new Date().toISOString(),
      baseline_window_days: profile.baseline_window_days ?? BASELINE_WINDOW_DAYS,
      phase:               1,
    },
  };
}

// ─── POST /api/v1/ai/explain ──────────────────────────────────────────────────

interface ExplainBody {
  user_id: string;
  question?: string;
}

const BAND_DESCRIPTIONS: Record<string, string> = {
  PEAK:     'exceptional — your body is primed for peak performance',
  HIGH:     'strong — you have plenty of capacity for a full training session',
  MODERATE: 'adequate — standard training is fine but avoid maximum intensity',
  LOW:      'below your baseline — keep it light today',
  REST:     'significantly depleted — your body needs rest to recover',
};

async function aiExplainHandler(
  request: FastifyRequest<{ Body: ExplainBody }>,
  reply: FastifyReply
) {
  const { user_id, question } = request.body ?? {};
  if (!user_id) {
    reply.code(400);
    return { error: 'user_id is required' };
  }

  // Fetch today's dashboard data to ground the explanation
  const db = buildMetricsDb();
  const profile = await db.getUserProfile(user_id);
  const today   = new Date().toISOString().slice(0, 10);

  let recoveryScore = 0;
  let recoveryBand  = 'MODERATE';
  let sleepScore    = 0;
  let top3: { label: string; value: string; direction: string }[] = [];

  if (profile) {
    const sleepResult    = await computeSleepScore(user_id, today, db, profile);
    const recoveryResult = await computeRecovery(user_id, today, db, sleepResult);
    recoveryScore = recoveryResult.score;
    recoveryBand  = recoveryResult.band;
    sleepScore    = sleepResult.score;

    // Build evidence items from breakdown
    top3 = [
      {
        label:     'Recovery Score',
        value:     `${recoveryResult.score}/100`,
        direction: recoveryResult.score >= 70 ? 'above_baseline' : 'below_baseline',
      },
      {
        label:     'Sleep Score',
        value:     `${sleepResult.score}/100 (${sleepResult.total_sleep_h}h)`,
        direction: sleepResult.score >= 70 ? 'above_baseline' : 'below_baseline',
      },
      {
        label:     'Sleep Debt',
        value:     `${sleepResult.sleep_debt_h}h accumulated`,
        direction: sleepResult.sleep_debt_h > 2 ? 'below_baseline' : 'above_baseline',
      },
    ];
  }

  const bandDesc = BAND_DESCRIPTIONS[recoveryBand] ?? 'moderate';
  const displayQuestion = question ?? `Why is my Recovery ${recoveryScore} today?`;

  // Deterministic template — same JSON structure as the future LLM response (Phase 3)
  reply.code(200);
  return {
    user_id,
    question:    displayQuestion,
    explanation_text: [
      `Your Recovery Score is ${recoveryScore}/100 — ${bandDesc}.`,
      sleepScore > 0
        ? `Your Sleep Score of ${sleepScore}/100 was a key driver.`
        : 'No sleep data was available for last night.',
      recoveryBand === 'LOW' || recoveryBand === 'REST'
        ? 'Focus on rest, light movement, and recovery nutrition today.'
        : 'You have solid capacity — use it wisely.',
    ].join(' '),
    top_3_data_items: top3,
    action_hint: recoveryBand === 'PEAK'    ? 'Push hard today — ideal for a personal best attempt.' :
                 recoveryBand === 'HIGH'    ? 'Full training session is appropriate.' :
                 recoveryBand === 'MODERATE'? 'Standard session — avoid maximum intensity.' :
                 recoveryBand === 'LOW'     ? 'Light movement, stretching, or technique work only.' :
                                             'Rest day — active recovery or complete rest.',
    confidence:  'MEDIUM', // Phase 3 will compute this from data completeness
    generated_by: 'template_v1', // replaced with 'llm_v1' in Phase 3
  };
}

// ─── Route registration ───────────────────────────────────────────────────────

export async function dashboardRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get<{ Params: UserParams }>('/api/v1/user/:id/baseline', baselineHandler);
  fastify.get<{ Params: UserParams }>('/api/v1/user/:id/dashboard', dashboardHandler);
  fastify.post<{ Body: ExplainBody }>('/api/v1/ai/explain', aiExplainHandler);
}
