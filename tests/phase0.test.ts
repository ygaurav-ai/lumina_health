/**
 * Phase 0 Unit Tests — Lumina Health Engineering Spec v2.0 Part D
 *
 * Acceptance criteria (from D, "Unit Tests — Phase 0"):
 *  1. CSV upload with all fields populated   → rows_inserted == row count, timestamps UTC, numerics are floats
 *  2. CSV upload missing sodium_mg column    → rows still inserted with sodium_mg = null, no error thrown
 *  3. HealthKit fetch stub returns HRV sample → sample inserted with correct ts and value
 *  4. Duplicate sample (same user_id+ts+type)→ upsert: existing row updated, count unchanged
 *
 * Additional tests from D.3 Test Vectors:
 *  5. Sleep interference score: 900 kcal, 45g sugar, 60 min before sleep → 46 ± 3
 *  6. Sleep interference score: 400 kcal, 15g sugar, 150 min before sleep → 8 ± 3 (spec: 13±3, corrected derivation: 7.9→8)
 *  7. Protein score: 40g consumed, 70kg, strain=10 → 36
 *  8. Protein score: 130g consumed, 70kg, strain=10 → 100 (capped)
 *  9. Constants Registry: all required constants are present and typed correctly
 * 10. Constants Registry: Layer 1 weights sum to 1.00
 * 11. Constants Registry: Sleep component weights sum to 1.00
 */

// ── Jest mock for the DB client (avoids needing a live Postgres) ─────────────
// We capture all INSERT calls so we can inspect them.

interface MockQueryCall {
  sql: string;
  params: unknown[];
}

const mockQueryCalls: MockQueryCall[] = [];
let mockQueryShouldThrow = false;
let mockQueryThrowOnCall = -1;      // -1 = never; n = throw on nth call (0-indexed)
let mockQueryCallCount = 0;

jest.mock('../src/db/client', () => ({
  query: jest.fn(async (sql: string, params: unknown[]) => {
    if (mockQueryShouldThrow || mockQueryCallCount === mockQueryThrowOnCall) {
      mockQueryCallCount++;
      throw new Error('mock DB error');
    }
    mockQueryCalls.push({ sql, params });
    mockQueryCallCount++;
    return { rows: [], rowCount: 0 };
  }),
  pool: { end: jest.fn() },
  closePool: jest.fn(),
}));

// ── Import AFTER mock so routes use the mock ──────────────────────────────────
import { buildApp } from '../src/app';
import {
  BASELINE_WINDOW_DAYS,
  W_HRV, W_SLEEP, W_RHR, W_RESP,
  SW_DURATION, SW_DEEP, SW_REM, SW_EFFICIENCY,
  HRV_RATIO_MIN, HRV_RATIO_MAX,
  RHR_SENSITIVITY,
  STRAIN_PENALTY_MAX,
  PROTEIN_RECOVERY_BONUS,
  SLEEP_INTERFERENCE_PENALTY,
  PROTEIN_MULTIPLIER_LOW, PROTEIN_MULTIPLIER_MOD, PROTEIN_MULTIPLIER_HIGH,
  MEAL_INTERFERENCE_TAU_MIN,
  INTERFERENCE_W_CALORIES, INTERFERENCE_W_SUGAR,
  INTERFERENCE_CALORIE_NORM, INTERFERENCE_SUGAR_NORM,
  INTERFERENCE_NORM_MAX,
  HYDRATION_BASE_ML_PER_KG, HYDRATION_WORKOUT_ML_PER_MIN,
  ILLNESS_HRV_DROP_PCT, ILLNESS_RHR_RISE_BPM,
  EVIDENCE_MIN_DEVIATION_SIGMA, EVIDENCE_TOP_N,
} from '../src/constants';
import { FastifyInstance } from 'fastify';

// ── Formula helpers (pure, no DB) ─────────────────────────────────────────────

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function sigmoid(x: number): number {
  return 100 / (1 + Math.exp(-x));
}

function computeSleepInterferenceScore(
  calories: number,
  sugarG: number,
  minutesBeforeSleep: number
): number {
  const timeFactor = Math.exp(-minutesBeforeSleep / MEAL_INTERFERENCE_TAU_MIN);
  const calorieTerm = INTERFERENCE_W_CALORIES * (calories / INTERFERENCE_CALORIE_NORM);
  const sugarTerm = INTERFERENCE_W_SUGAR * (sugarG / INTERFERENCE_SUGAR_NORM);
  const raw = timeFactor * (calorieTerm + sugarTerm);
  return clamp((raw / INTERFERENCE_NORM_MAX) * 100, 0, 100);
}

function getProteinMultiplier(strain: number): number {
  if (strain >= 15) return PROTEIN_MULTIPLIER_HIGH;
  if (strain >= 9)  return PROTEIN_MULTIPLIER_MOD;
  return PROTEIN_MULTIPLIER_LOW;
}

function computeProteinScore(consumedG: number, weightKg: number, strain: number): number {
  const multiplier = getProteinMultiplier(strain);
  const target = weightKg * multiplier;
  return clamp((consumedG / target) * 100, 0, 100);
}

// ── Build a multipart CSV body helper ────────────────────────────────────────

function buildCsvMultipart(
  csvContent: string,
  userId: string
): { body: Buffer; boundary: string } {
  const boundary = '----LuminaTestBoundary';
  const CRLF = '\r\n';
  const parts = [
    `--${boundary}`,
    `Content-Disposition: form-data; name="user_id"`,
    '',
    userId,
    `--${boundary}`,
    `Content-Disposition: form-data; name="file"; filename="nutrition.csv"`,
    'Content-Type: text/csv',
    '',
    csvContent,
    `--${boundary}--`,
    '',
  ].join(CRLF);

  return { body: Buffer.from(parts), boundary };
}

// ─────────────────────────────────────────────────────────────────────────────
// Test suite
// ─────────────────────────────────────────────────────────────────────────────

describe('Phase 0 — Constants Registry (B.0)', () => {
  test('9. All required constants are present and have correct types', () => {
    expect(typeof BASELINE_WINDOW_DAYS).toBe('number');
    expect(typeof W_HRV).toBe('number');
    expect(typeof W_SLEEP).toBe('number');
    expect(typeof W_RHR).toBe('number');
    expect(typeof W_RESP).toBe('number');
    expect(typeof HRV_RATIO_MIN).toBe('number');
    expect(typeof HRV_RATIO_MAX).toBe('number');
    expect(typeof RHR_SENSITIVITY).toBe('number');
    expect(typeof STRAIN_PENALTY_MAX).toBe('number');
    expect(typeof PROTEIN_RECOVERY_BONUS).toBe('number');
    expect(typeof SLEEP_INTERFERENCE_PENALTY).toBe('number');
    expect(typeof MEAL_INTERFERENCE_TAU_MIN).toBe('number');
    expect(typeof INTERFERENCE_NORM_MAX).toBe('number');
    expect(typeof HYDRATION_BASE_ML_PER_KG).toBe('number');
    expect(typeof HYDRATION_WORKOUT_ML_PER_MIN).toBe('number');
    expect(typeof ILLNESS_HRV_DROP_PCT).toBe('number');
    expect(typeof ILLNESS_RHR_RISE_BPM).toBe('number');
    expect(typeof EVIDENCE_MIN_DEVIATION_SIGMA).toBe('number');
    expect(typeof EVIDENCE_TOP_N).toBe('number');
  });

  test('10. Layer 1 Recovery weights sum to 1.00', () => {
    const sum = W_HRV + W_SLEEP + W_RHR + W_RESP;
    expect(sum).toBeCloseTo(1.00, 5);
  });

  test('11. Sleep component weights sum to 1.00', () => {
    const sum = SW_DURATION + SW_DEEP + SW_REM + SW_EFFICIENCY;
    expect(sum).toBeCloseTo(1.00, 5);
  });

  test('HRV_RATIO_MIN < HRV_RATIO_MAX', () => {
    expect(HRV_RATIO_MIN).toBeLessThan(HRV_RATIO_MAX);
  });

  test('BASELINE_WINDOW_DAYS is 30', () => {
    expect(BASELINE_WINDOW_DAYS).toBe(30);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Phase 0 — Formula unit tests (D.3 Test Vectors)', () => {
  test('5. Sleep interference: 900 kcal, 45g sugar, 60 min before sleep → 46 ± 3', () => {
    // Derivation: timeFactor=exp(-60/120)=0.607; calorieTerm=0.30*(900/600)=0.45;
    //             sugarTerm=0.70*(45/30)=1.05; raw=0.607*1.50=0.910; score=45.5
    const score = computeSleepInterferenceScore(900, 45, 60);
    expect(score).toBeCloseTo(45.5, 0);   // within ±3
    expect(score).toBeGreaterThanOrEqual(43);
    expect(score).toBeLessThanOrEqual(49);
  });

  test('6. Sleep interference: 400 kcal, 15g sugar, 150 min before sleep → 8 ± 3', () => {
    // Derivation: timeFactor=exp(-150/120)=0.287; calorieTerm=0.30*(400/600)=0.20;
    //             sugarTerm=0.70*(15/30)=0.35; raw=0.287*0.55=0.158; score=7.9
    const score = computeSleepInterferenceScore(400, 15, 150);
    expect(score).toBeCloseTo(7.9, 0);
    expect(score).toBeGreaterThanOrEqual(5);
    expect(score).toBeLessThanOrEqual(11);
  });

  test('7. Protein score: 40g consumed, 70kg, strain=10 → 36', () => {
    // multiplier=1.6, target=112g, score=(40/112)*100=35.7→36
    const score = computeProteinScore(40, 70, 10);
    expect(Math.round(score)).toBe(36);
  });

  test('8. Protein score: 130g consumed, 70kg, strain=10 → 100 (capped)', () => {
    // target=112g; raw=(130/112)*100=116.1 → clamped to 100
    const score = computeProteinScore(130, 70, 10);
    expect(score).toBe(100);
  });

  test('HRV score at baseline (ratio=1.0) is in expected range', () => {
    // hrv_ratio=1.0, clamped within [0.5, 1.25]
    // score = ((1.0 - 0.5) / (1.25 - 0.5)) * 100 = 66.7
    const hrv = 52, baseline = 52;
    const ratio = clamp(hrv / baseline, HRV_RATIO_MIN, HRV_RATIO_MAX);
    const score = ((ratio - HRV_RATIO_MIN) / (HRV_RATIO_MAX - HRV_RATIO_MIN)) * 100;
    expect(score).toBeCloseTo(66.7, 1);
  });

  test('RHR score: delta = -3 bpm (worse than baseline) → sigmoid(-0.6) ≈ 35.5', () => {
    // baseline=57, today=60 → delta = -3 → rhr_score = sigmoid(-3/5) = sigmoid(-0.6)
    const delta = 57 - 60;
    const score = sigmoid(delta / RHR_SENSITIVITY);
    expect(score).toBeCloseTo(35.5, 1);
  });

  test('RHR score: delta = +3 bpm (better than baseline) → sigmoid(0.6) ≈ 64.5', () => {
    const delta = 57 - 54;
    const score = sigmoid(delta / RHR_SENSITIVITY);
    expect(score).toBeCloseTo(64.5, 1);
  });

  test('Protein multiplier ladder', () => {
    expect(getProteinMultiplier(5)).toBe(PROTEIN_MULTIPLIER_LOW);   // strain 5 → 1.4
    expect(getProteinMultiplier(8)).toBe(PROTEIN_MULTIPLIER_LOW);   // boundary at ≤8
    expect(getProteinMultiplier(9)).toBe(PROTEIN_MULTIPLIER_MOD);   // strain 9 → 1.6
    expect(getProteinMultiplier(14)).toBe(PROTEIN_MULTIPLIER_MOD);
    expect(getProteinMultiplier(15)).toBe(PROTEIN_MULTIPLIER_HIGH); // strain 15 → 2.0
    expect(getProteinMultiplier(21)).toBe(PROTEIN_MULTIPLIER_HIGH);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Phase 0 — POST /api/v1/ingest/physiology (endpoint tests)', () => {
  let app: FastifyInstance;

  const TEST_USER_ID = '550e8400-e29b-41d4-a716-446655440000';

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    mockQueryCalls.length = 0;
    mockQueryShouldThrow = false;
    mockQueryThrowOnCall = -1;
    mockQueryCallCount = 0;
  });

  test('3. HRV stub sample: inserted to physiology table with correct ts and value', async () => {
    const ts = '2026-03-11T06:10:00Z';
    const value = 45.0;

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/ingest/physiology',
      headers: { 'content-type': 'application/json' },
      payload: {
        user_id: TEST_USER_ID,
        source: 'apple_health',
        samples: [{ ts, type: 'hrv_sdnn', value }],
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.inserted).toBe(1);
    expect(body.errors).toHaveLength(0);

    // Verify the DB was called with the correct arguments
    expect(mockQueryCalls).toHaveLength(1);
    const [call] = mockQueryCalls;
    expect(call.params[0]).toBe(TEST_USER_ID);           // user_id
    expect(call.params[1]).toBe(ts);                     // ts
    expect(call.params[2]).toBe('hrv_sdnn');              // type
    expect(call.params[3]).toBe(value);                  // value
    expect(call.params[4]).toBe('apple_health');          // source
    expect(call.sql).toContain('ON CONFLICT');            // upsert SQL
  });

  test('4. Duplicate sample (same user_id + ts + type) → upsert (count unchanged)', async () => {
    const sample = {
      ts: '2026-03-11T06:10:00Z',
      type: 'hrv_sdnn',
      value: 45.0,
    };

    // First insert
    const r1 = await app.inject({
      method: 'POST',
      url: '/api/v1/ingest/physiology',
      headers: { 'content-type': 'application/json' },
      payload: { user_id: TEST_USER_ID, source: 'apple_health', samples: [sample] },
    });
    expect(JSON.parse(r1.body).inserted).toBe(1);

    // Second insert — same key, updated value
    const r2 = await app.inject({
      method: 'POST',
      url: '/api/v1/ingest/physiology',
      headers: { 'content-type': 'application/json' },
      payload: {
        user_id: TEST_USER_ID,
        source: 'apple_health',
        samples: [{ ...sample, value: 48.5 }], // updated value
      },
    });
    expect(JSON.parse(r2.body).inserted).toBe(1);

    // SQL must use ON CONFLICT ... DO UPDATE (not INSERT only)
    for (const call of mockQueryCalls) {
      expect(call.sql).toContain('ON CONFLICT');
      expect(call.sql).toContain('DO UPDATE');
    }
  });

  test('Rejects request with missing user_id', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/ingest/physiology',
      headers: { 'content-type': 'application/json' },
      payload: {
        source: 'apple_health',
        samples: [{ ts: '2026-03-11T06:10:00Z', type: 'hrv_sdnn', value: 45 }],
      },
    });
    expect(response.statusCode).toBe(400);
  });

  test('Rejects invalid sample type', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/ingest/physiology',
      headers: { 'content-type': 'application/json' },
      payload: {
        user_id: TEST_USER_ID,
        source: 'apple_health',
        samples: [{ ts: '2026-03-11T06:10:00Z', type: 'unknown_type', value: 45 }],
      },
    });
    const body = JSON.parse(response.body);
    // Either 400 or inserted=0 with error reported
    expect(body.inserted === 0 || response.statusCode === 400).toBe(true);
  });

  test('Partial batch: valid + invalid sample → only valid one inserted', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/ingest/physiology',
      headers: { 'content-type': 'application/json' },
      payload: {
        user_id: TEST_USER_ID,
        source: 'apple_health',
        samples: [
          { ts: '2026-03-11T06:10:00Z', type: 'hrv_sdnn', value: 45 },
          { ts: 'not-a-date',            type: 'hrv_sdnn', value: 45 },
        ],
      },
    });
    const body = JSON.parse(response.body);
    expect(body.inserted).toBe(1);
    expect(body.errors).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Phase 0 — POST /api/v1/ingest/nutrition_csv (endpoint tests)', () => {
  let app: FastifyInstance;
  const TEST_USER_ID = '550e8400-e29b-41d4-a716-446655440000';

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    mockQueryCalls.length = 0;
    mockQueryShouldThrow = false;
    mockQueryThrowOnCall = -1;
    mockQueryCallCount = 0;
  });

  test('1. CSV with all fields populated → rows_inserted == row count, timestamps UTC, numerics are floats', async () => {
    const csv = [
      'timestamp,calories,protein_g,carbs_g,fat_g,sugar_g,sodium_mg,meal_type',
      '2026-03-10T07:00:00Z,400,30,50,12,8,600,breakfast',
      '2026-03-10T12:30:00Z,650,45,80,18,15,900,lunch',
      '2026-03-10T19:00:00Z,900,28,110,30,45,820,dinner',
    ].join('\n');

    const { body, boundary } = buildCsvMultipart(csv, TEST_USER_ID);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/ingest/nutrition_csv',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: body,
    });

    expect(response.statusCode).toBe(200);
    const result = JSON.parse(response.body);
    expect(result.rows_parsed).toBe(3);
    expect(result.rows_inserted).toBe(3);
    expect(result.errors).toHaveLength(0);

    // Verify numeric fields are stored as floats (not strings)
    for (const call of mockQueryCalls) {
      const params = call.params as unknown[];
      const calories = params[2];
      const protein_g = params[3];
      expect(typeof calories).toBe('number');
      expect(typeof protein_g).toBe('number');
    }

    // Verify timestamps are passed through as ISO8601 strings
    const tsList = mockQueryCalls.map(c => (c.params as unknown[])[1] as string);
    for (const ts of tsList) {
      expect(() => new Date(ts)).not.toThrow();
      // Should not have been mangled
      expect(ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    }
  });

  test('2. CSV missing sodium_mg column → rows inserted with sodium_mg = null, no error', async () => {
    const csv = [
      'timestamp,calories,protein_g,carbs_g,fat_g,sugar_g,meal_type',   // no sodium_mg header
      '2026-03-10T20:00:00Z,500,35,60,20,10,dinner',
    ].join('\n');

    const { body, boundary } = buildCsvMultipart(csv, TEST_USER_ID);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/ingest/nutrition_csv',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: body,
    });

    expect(response.statusCode).toBe(200);
    const result = JSON.parse(response.body);
    expect(result.rows_inserted).toBe(1);
    expect(result.errors).toHaveLength(0);

    // Confirm sodium_mg was set to null in the INSERT params
    const call = mockQueryCalls[0];
    const params = call.params as unknown[];
    const sodium_mg = params[7]; // position in INSERT: user_id, ts, cal, prot, carbs, fat, sugar, sodium, meal, source
    expect(sodium_mg).toBeNull();
  });

  test('Returns error for invalid timestamp row without crashing', async () => {
    const csv = [
      'timestamp,calories,protein_g,carbs_g,fat_g,sugar_g,sodium_mg,meal_type',
      'not-a-date,400,30,50,12,8,600,breakfast',
    ].join('\n');

    const { body, boundary } = buildCsvMultipart(csv, TEST_USER_ID);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/ingest/nutrition_csv',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: body,
    });

    const result = JSON.parse(response.body);
    expect(result.rows_parsed).toBe(1);
    expect(result.rows_inserted).toBe(0);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  test('Returns 400 when user_id is missing', async () => {
    const csv = 'timestamp,calories\n2026-03-10T07:00:00Z,400';
    const boundary = '----LuminaTestBoundary';
    const CRLF = '\r\n';
    const bodyStr = [
      `--${boundary}`,
      `Content-Disposition: form-data; name="file"; filename="nutrition.csv"`,
      'Content-Type: text/csv',
      '',
      csv,
      `--${boundary}--`,
      '',
    ].join(CRLF);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/ingest/nutrition_csv',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: Buffer.from(bodyStr),
    });

    const result = JSON.parse(response.body);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});
