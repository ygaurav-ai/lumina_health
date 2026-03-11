/**
 * src/metrics/db_queries.ts
 * Concrete PostgreSQL implementations of the metric DB interfaces.
 * Route handlers import `buildMetricsDb()` which wraps the shared pg pool.
 */

import { query } from '../db/client';
import { UserProfile } from '../types';
import { RecoveryDbClient } from './recovery';

/** Returns the ISO date string for N days before a given ISO date string. */
function daysAgo(dateStr: string, n: number): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

/** Computes the median of a sorted numeric array. Returns null for empty. */
function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

// ─── Concrete DB client ───────────────────────────────────────────────────────

export function buildMetricsDb(): RecoveryDbClient {
  return {

    async getUserProfile(userId: string): Promise<UserProfile | null> {
      const res = await query<UserProfile>(
        `SELECT * FROM user_profile WHERE user_id = $1`, [userId]
      );
      return res.rows[0] ?? null;
    },

    /**
     * Morning HRV — samples between 04:00 and 09:00 local-equivalent UTC
     * for the given date. Returns the mean if multiple samples exist.
     */
    async getMorningHRV(userId: string, dateStr: string): Promise<number | null> {
      const res = await query<{ value: string }>(
        `SELECT value FROM physiology_samples
         WHERE user_id = $1
           AND type = 'hrv_sdnn'
           AND ts >= ($2::date + interval '4 hours')::timestamptz
           AND ts <  ($2::date + interval '9 hours')::timestamptz
         ORDER BY ts`,
        [userId, dateStr]
      );
      if (res.rows.length === 0) return null;
      const values = res.rows.map(r => parseFloat(r.value));
      return values.reduce((s, v) => s + v, 0) / values.length;
    },

    async getDailyRHR(userId: string, dateStr: string): Promise<number | null> {
      const res = await query<{ value: string }>(
        `SELECT value FROM physiology_samples
         WHERE user_id = $1 AND type = 'resting_hr'
           AND ts::date = $2::date
         ORDER BY ts DESC LIMIT 1`,
        [userId, dateStr]
      );
      return res.rows[0] ? parseFloat(res.rows[0].value) : null;
    },

    /**
     * Rolling median over the last windowDays days for any metric type.
     * Fetches all samples in the window and computes the median in-process.
     */
    async getRollingMedian(
      userId: string,
      metricType: string,
      windowDays: number
    ): Promise<number | null> {
      const res = await query<{ value: string }>(
        `SELECT value FROM physiology_samples
         WHERE user_id = $1 AND type = $2
           AND ts >= NOW() - ($3 || ' days')::interval
         ORDER BY ts`,
        [userId, metricType, windowDays]
      );
      if (res.rows.length === 0) return null;
      return median(res.rows.map(r => parseFloat(r.value)));
    },

    async getSleepRespRate(userId: string, dateStr: string): Promise<number | null> {
      const res = await query<{ value: string }>(
        `SELECT value FROM physiology_samples
         WHERE user_id = $1 AND type = 'resp_rate'
           AND ts::date = $2::date
         ORDER BY ts DESC LIMIT 1`,
        [userId, dateStr]
      );
      return res.rows[0] ? parseFloat(res.rows[0].value) : null;
    },

    /**
     * Strain score — stored as a pre-computed value by a future strain-service,
     * or estimated from active_energy_burned as a fallback.
     * Phase 0 stub: returns null (no workout data ingested yet).
     */
    async getStrainScore(userId: string, dateStr: string): Promise<number | null> {
      // Strain computation is Phase 2. Stub returns null (→ penalty = 0).
      return null;
    },

    async getSleepSession(
      userId: string,
      dateStr: string
    ): Promise<{ onset: Date; offset: Date } | null> {
      const res = await query<{ onset: string; offset: string }>(
        `SELECT
           MIN(CASE WHEN type = 'sleep_onset' THEN ts END) AS onset,
           MAX(CASE WHEN type = 'sleep_offset' THEN ts END) AS offset
         FROM physiology_samples
         WHERE user_id = $1
           AND type IN ('sleep_onset', 'sleep_offset')
           AND ts::date = $2::date`,
        [userId, dateStr]
      );
      const row = res.rows[0];
      if (!row?.onset || !row?.offset) return null;
      return { onset: new Date(row.onset), offset: new Date(row.offset) };
    },

    async getSleepStages(
      userId: string,
      dateStr: string
    ): Promise<{
      deep_min: number;
      rem_min: number;
      core_min: number;
      wake_min: number;
    } | null> {
      // Sleep stages are stored as individual samples with meta.sleep_stage
      const res = await query<{ meta: string; value: string }>(
        `SELECT meta, value FROM physiology_samples
         WHERE user_id = $1 AND type = 'sleep_stage'
           AND ts::date = $2::date`,
        [userId, dateStr]
      );
      if (res.rows.length === 0) return null;

      let deep_min = 0, rem_min = 0, core_min = 0, wake_min = 0;
      for (const row of res.rows) {
        const meta = typeof row.meta === 'string' ? JSON.parse(row.meta) : row.meta;
        const minutes = parseFloat(row.value);
        switch (meta?.sleep_stage) {
          case 'asleepDeep':  deep_min  += minutes; break;
          case 'asleepREM':   rem_min   += minutes; break;
          case 'asleepCore':  core_min  += minutes; break;
          case 'awake':       wake_min  += minutes; break;
        }
      }
      return { deep_min, rem_min, core_min, wake_min };
    },

    async getTotalSleepHours(userId: string, dateStr: string): Promise<number | null> {
      const stages = await this.getSleepStages(userId, dateStr);
      if (stages) {
        return (stages.deep_min + stages.rem_min + stages.core_min) / 60;
      }
      // Fallback: derive from onset/offset
      const session = await this.getSleepSession(userId, dateStr);
      if (!session) return null;
      const inBedH = (session.offset.getTime() - session.onset.getTime()) / 3_600_000;
      return inBedH * 0.90; // conservative efficiency estimate
    },

    async getNutritionSummary(userId: string, dateStr: string) {
      // Full nutrition computation is Phase 2. Returns null until nutrition is ingested.
      const res = await query<{ count: string }>(
        `SELECT COUNT(*) as count FROM nutrition_events
         WHERE user_id = $1 AND ts::date = $2::date`,
        [userId, dateStr]
      );
      if (parseInt(res.rows[0]?.count ?? '0', 10) === 0) return null;

      // Placeholder — actual interference + protein computation in Phase 2
      return {
        protein_consumed_g: 0,
        sleep_interference_score: 0,
        protein_score: 0,
      };
    },
  };
}
