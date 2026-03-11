/**
 * Ingest routes — Phase 0
 *
 * POST /api/v1/ingest/physiology
 *   Body: { user_id, source, samples: [{ts, type, value, meta?}] }
 *   Returns: { inserted: N, errors: [] }
 *
 * POST /api/v1/ingest/nutrition_csv
 *   Multipart: file (CSV), user_id
 *   Returns: { rows_parsed: N, rows_inserted: N, errors: [] }
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { parse } from 'fast-csv';
import { Readable } from 'stream';
import { query } from '../db/client';
import {
  IngestPhysiologyBody,
  IngestPhysiologyResult,
  IngestNutritionCsvResult,
  CsvNutritionRow,
  MealType,
  NutritionSource,
} from '../types';

// ─── Valid enum values (mirrors SQL CHECK constraints) ──────────────────────

const VALID_SAMPLE_TYPES = new Set([
  'hrv_sdnn', 'heart_rate', 'resting_hr', 'body_mass',
  'active_energy', 'sleep_onset', 'sleep_offset',
  'sleep_stage', 'resp_rate', 'vo2max', 'spo2', 'water_ml',
]);

const VALID_PHYSIOLOGY_SOURCES = new Set(['apple_health', 'manual']);

const VALID_MEAL_TYPES = new Set<MealType>([
  'breakfast', 'lunch', 'dinner', 'snack', 'other',
]);

// ─── Physiology ingest ───────────────────────────────────────────────────────

async function physiologyIngestHandler(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<IngestPhysiologyResult> {
  const body = request.body as IngestPhysiologyBody;
  const { user_id, source, samples } = body;

  const result: IngestPhysiologyResult = { inserted: 0, errors: [] };

  if (!user_id || typeof user_id !== 'string') {
    reply.code(400);
    return { inserted: 0, errors: ['user_id is required'] };
  }

  if (!VALID_PHYSIOLOGY_SOURCES.has(source as 'apple_health' | 'manual')) {
    reply.code(400);
    return { inserted: 0, errors: [`source must be one of: ${[...VALID_PHYSIOLOGY_SOURCES].join(', ')}`] };
  }

  if (!Array.isArray(samples) || samples.length === 0) {
    reply.code(400);
    return { inserted: 0, errors: ['samples must be a non-empty array'] };
  }

  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    try {
      // Validate individual sample
      if (!s.ts || isNaN(Date.parse(s.ts))) {
        result.errors.push(`samples[${i}]: ts is not a valid ISO8601 timestamp`);
        continue;
      }
      if (!VALID_SAMPLE_TYPES.has(s.type)) {
        result.errors.push(`samples[${i}]: invalid type '${s.type}'`);
        continue;
      }
      if (typeof s.value !== 'number' || isNaN(s.value)) {
        result.errors.push(`samples[${i}]: value must be a number`);
        continue;
      }

      // Upsert: on duplicate (user_id, ts, type) update the existing row
      await query(
        `INSERT INTO physiology_samples (user_id, ts, type, value, source, meta)
         VALUES ($1, $2::timestamptz, $3, $4, $5, $6::jsonb)
         ON CONFLICT (user_id, ts, type)
         DO UPDATE SET value = EXCLUDED.value,
                       source = EXCLUDED.source,
                       meta   = EXCLUDED.meta`,
        [
          user_id,
          s.ts,
          s.type,
          s.value,
          source,
          s.meta ? JSON.stringify(s.meta) : null,
        ]
      );

      result.inserted += 1;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(`samples[${i}]: ${msg}`);
    }
  }

  reply.code(200);
  return result;
}

// ─── Nutrition CSV ingest ────────────────────────────────────────────────────

async function nutritionCsvIngestHandler(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<IngestNutritionCsvResult> {
  const result: IngestNutritionCsvResult = { rows_parsed: 0, rows_inserted: 0, errors: [] };

  // Read multipart parts
  const parts = request.parts();
  let csvBuffer: Buffer | null = null;
  let user_id: string | null = null;

  for await (const part of parts) {
    if (part.type === 'field' && part.fieldname === 'user_id') {
      user_id = part.value as string;
    } else if (part.type === 'file' && part.fieldname === 'file') {
      const chunks: Buffer[] = [];
      for await (const chunk of part.file) {
        chunks.push(chunk);
      }
      csvBuffer = Buffer.concat(chunks);
    }
  }

  if (!user_id) {
    reply.code(400);
    return { rows_parsed: 0, rows_inserted: 0, errors: ['user_id is required'] };
  }
  if (!csvBuffer || csvBuffer.length === 0) {
    reply.code(400);
    return { rows_parsed: 0, rows_inserted: 0, errors: ['CSV file is required'] };
  }

  // Parse CSV
  const rows: CsvNutritionRow[] = await new Promise((resolve, reject) => {
    const collected: CsvNutritionRow[] = [];
    const stream = Readable.from(csvBuffer!);
    stream
      .pipe(parse({ headers: true, trim: true, ignoreEmpty: true }))
      .on('data', (row: CsvNutritionRow) => collected.push(row))
      .on('end', () => resolve(collected))
      .on('error', reject);
  });

  result.rows_parsed = rows.length;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    try {
      // Validate timestamp
      const ts = row.timestamp;
      if (!ts || isNaN(Date.parse(ts))) {
        result.errors.push(`row ${i + 1}: invalid timestamp '${ts}'`);
        continue;
      }

      // Parse numeric fields — strict float conversion
      const calories = parseFloat(row.calories);
      const protein_g = parseFloat(row.protein_g);
      const carbs_g = parseFloat(row.carbs_g);
      const fat_g = parseFloat(row.fat_g);
      const sugar_g = parseFloat(row.sugar_g);
      // sodium_mg is optional; null if column absent or empty
      const sodium_mg =
        row.sodium_mg !== undefined && row.sodium_mg !== ''
          ? parseFloat(row.sodium_mg)
          : null;

      if ([calories, protein_g, carbs_g, fat_g, sugar_g].some(isNaN)) {
        result.errors.push(`row ${i + 1}: one or more required numeric fields are invalid`);
        continue;
      }

      // Validate meal_type — coerce to lowercase, default to 'other'
      const rawMealType = (row.meal_type || '').toLowerCase().trim();
      const meal_type: MealType = VALID_MEAL_TYPES.has(rawMealType as MealType)
        ? (rawMealType as MealType)
        : 'other';

      const source: NutritionSource = 'healthifyme_csv';

      await query(
        `INSERT INTO nutrition_events
           (user_id, ts, calories, protein_g, carbs_g, fat_g, sugar_g, sodium_mg, meal_type, source)
         VALUES ($1, $2::timestamptz, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (user_id, ts, meal_type)
         DO UPDATE SET calories  = EXCLUDED.calories,
                       protein_g = EXCLUDED.protein_g,
                       carbs_g   = EXCLUDED.carbs_g,
                       fat_g     = EXCLUDED.fat_g,
                       sugar_g   = EXCLUDED.sugar_g,
                       sodium_mg = EXCLUDED.sodium_mg,
                       source    = EXCLUDED.source`,
        [user_id, ts, calories, protein_g, carbs_g, fat_g, sugar_g, sodium_mg, meal_type, source]
      );

      result.rows_inserted += 1;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(`row ${i + 1}: ${msg}`);
    }
  }

  reply.code(200);
  return result;
}

// ─── Route registration ──────────────────────────────────────────────────────

export async function ingestRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * POST /api/v1/ingest/physiology
   * Ingests HealthKit physiology samples. Upserts on (user_id, ts, type).
   */
  fastify.post<{ Body: IngestPhysiologyBody }>(
    '/api/v1/ingest/physiology',
    {
      schema: {
        body: {
          type: 'object',
          required: ['user_id', 'source', 'samples'],
          properties: {
            user_id: { type: 'string', format: 'uuid' },
            source: { type: 'string', enum: ['apple_health', 'manual'] },
            samples: {
              type: 'array',
              minItems: 1,
              items: {
                type: 'object',
                required: ['ts', 'type', 'value'],
                properties: {
                  ts:    { type: 'string' },
                  type:  { type: 'string' },
                  value: { type: 'number' },
                  meta:  { type: 'object', nullable: true },
                },
              },
            },
          },
        },
      },
    },
    physiologyIngestHandler
  );

  /**
   * POST /api/v1/ingest/nutrition_csv
   * Accepts a multipart upload (file + user_id). Parses the CSV and
   * upserts each row into nutrition_events.
   */
  fastify.post(
    '/api/v1/ingest/nutrition_csv',
    nutritionCsvIngestHandler
  );
}
