/**
 * src/routes/profile.ts
 *
 * PUT /api/v1/user/:id/profile
 *   Upsert user profile. Validates all required fields. Computes and stores
 *   BMR on save using Mifflin-St Jeor (or Harris-Benedict) from B.1.
 *   Returns the saved profile object with computed_bmr appended.
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { query } from '../db/client';
import { computeBMR } from '../metrics/helpers';
import { UserProfile, BiologicalSex, FitnessGoal, Chronotype, BmrFormula } from '../types';

// ─── Validation helpers ───────────────────────────────────────────────────────

const VALID_SEX:       Set<BiologicalSex> = new Set(['male','female','prefer_not_to_say']);
const VALID_GOAL:      Set<FitnessGoal>   = new Set(['performance','endurance','weight_loss','longevity','general_health']);
const VALID_CHRONO:    Set<Chronotype>    = new Set(['morning','intermediate','evening']);
const VALID_BMR:       Set<BmrFormula>    = new Set(['mifflin','harris']);

/** Validates the request body and returns a list of error strings. */
function validateProfileBody(b: Record<string, unknown>): string[] {
  const errors: string[] = [];

  // Required fields
  if (typeof b.weight_kg !== 'number' || b.weight_kg <= 0)
    errors.push('weight_kg must be a positive number');
  if (typeof b.height_cm !== 'number' || b.height_cm <= 0)
    errors.push('height_cm must be a positive integer');
  if (typeof b.age !== 'number' || b.age < 1 || b.age > 130)
    errors.push('age must be a number between 1 and 130');
  if (!VALID_SEX.has(b.biological_sex as BiologicalSex))
    errors.push(`biological_sex must be one of: ${[...VALID_SEX].join(', ')}`);
  if (!VALID_GOAL.has(b.fitness_goal as FitnessGoal))
    errors.push(`fitness_goal must be one of: ${[...VALID_GOAL].join(', ')}`);
  if (typeof b.sleep_target_hours !== 'number' ||
      b.sleep_target_hours < 6.0 || b.sleep_target_hours > 10.0)
    errors.push('sleep_target_hours must be a number between 6.0 and 10.0');
  if (!VALID_CHRONO.has(b.chronotype as Chronotype))
    errors.push(`chronotype must be one of: ${[...VALID_CHRONO].join(', ')}`);

  // Optional fields — validate only when present
  if (b.bmr_formula !== undefined && !VALID_BMR.has(b.bmr_formula as BmrFormula))
    errors.push(`bmr_formula must be one of: ${[...VALID_BMR].join(', ')}`);
  if (b.sleep_target_hours !== undefined &&
      (typeof b.sleep_target_hours !== 'number' ||
       b.sleep_target_hours < 6 || b.sleep_target_hours > 10))
    errors.push('sleep_target_hours must be between 6.0 and 10.0');
  if (b.baseline_window_days !== undefined &&
      (typeof b.baseline_window_days !== 'number' || b.baseline_window_days < 14))
    errors.push('baseline_window_days must be >= 14');

  return errors;
}

// ─── Route handler ────────────────────────────────────────────────────────────

interface ProfileParams { id: string; }

async function putProfileHandler(
  request: FastifyRequest<{ Params: ProfileParams; Body: Record<string, unknown> }>,
  reply: FastifyReply
) {
  const userId = request.params.id;
  const b = request.body;

  const errors = validateProfileBody(b);
  if (errors.length > 0) {
    reply.code(400);
    return { error: 'Validation failed', details: errors };
  }

  // Build a typed profile snapshot for BMR computation
  const profileForBmr = {
    weight_kg:      b.weight_kg      as number,
    height_cm:      b.height_cm      as number,
    age:            b.age            as number,
    biological_sex: b.biological_sex as BiologicalSex,
    bmr_formula:    (b.bmr_formula   as BmrFormula) ?? 'mifflin',
  };
  const bmr = Math.round(computeBMR(profileForBmr) * 10) / 10;

  try {
    const res = await query<UserProfile & { computed_bmr: number }>(
      `INSERT INTO user_profile (
         user_id, weight_kg, height_cm, age, biological_sex, fitness_goal,
         sleep_target_hours, chronotype, bmr_formula, protein_multiplier_override,
         baseline_window_days, max_hr_override, watch_model,
         menstrual_cycle_tracking, created_at, updated_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6,
         $7, $8, $9, $10,
         $11, $12, $13,
         $14, NOW(), NOW()
       )
       ON CONFLICT (user_id) DO UPDATE SET
         weight_kg                  = EXCLUDED.weight_kg,
         height_cm                  = EXCLUDED.height_cm,
         age                        = EXCLUDED.age,
         biological_sex             = EXCLUDED.biological_sex,
         fitness_goal               = EXCLUDED.fitness_goal,
         sleep_target_hours         = EXCLUDED.sleep_target_hours,
         chronotype                 = EXCLUDED.chronotype,
         bmr_formula                = EXCLUDED.bmr_formula,
         protein_multiplier_override= EXCLUDED.protein_multiplier_override,
         baseline_window_days       = EXCLUDED.baseline_window_days,
         max_hr_override            = EXCLUDED.max_hr_override,
         watch_model                = EXCLUDED.watch_model,
         menstrual_cycle_tracking   = EXCLUDED.menstrual_cycle_tracking,
         updated_at                 = NOW()
       RETURNING *`,
      [
        userId,
        b.weight_kg,
        Math.round(b.height_cm as number),
        Math.round(b.age as number),
        b.biological_sex,
        b.fitness_goal,
        b.sleep_target_hours ?? 7.5,
        b.chronotype,
        b.bmr_formula ?? 'mifflin',
        b.protein_multiplier_override ?? null,
        b.baseline_window_days ?? 30,
        b.max_hr_override ?? null,
        b.watch_model ?? null,
        b.menstrual_cycle_tracking ?? false,
      ]
    );

    const saved = res.rows[0];
    reply.code(200);
    return { ...saved, computed_bmr: bmr };

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    reply.code(500);
    return { error: 'Database error', detail: msg };
  }
}

// ─── Route registration ───────────────────────────────────────────────────────

export async function profileRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.put<{ Params: ProfileParams; Body: Record<string, unknown> }>(
    '/api/v1/user/:id/profile',
    putProfileHandler
  );
}
