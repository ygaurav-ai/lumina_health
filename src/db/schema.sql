-- ═══════════════════════════════════════════════════════════════════════════
-- LUMINA HEALTH — Phase 0 + Phase 1 PostgreSQL Schema
-- Run once against your database: psql $DATABASE_URL -f schema.sql
-- ═══════════════════════════════════════════════════════════════════════════

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─── user_profile ──────────────────────────────────────────────────────────
-- Foundational data object; required before any formula can run.
-- Collected at onboarding (see B.1).
CREATE TABLE IF NOT EXISTS user_profile (
  user_id                    UUID        PRIMARY KEY,
  weight_kg                  FLOAT       NOT NULL,
  height_cm                  INTEGER     NOT NULL,
  age                        INTEGER     NOT NULL,
  biological_sex             TEXT        NOT NULL CHECK (biological_sex IN ('male', 'female', 'prefer_not_to_say')),
  fitness_goal               TEXT        NOT NULL CHECK (fitness_goal IN ('performance', 'endurance', 'weight_loss', 'longevity', 'general_health')),
  sleep_target_hours         FLOAT       NOT NULL DEFAULT 7.5 CHECK (sleep_target_hours BETWEEN 6.0 AND 10.0),
  chronotype                 TEXT        NOT NULL CHECK (chronotype IN ('morning', 'intermediate', 'evening')),
  bmr_formula                TEXT        NOT NULL DEFAULT 'mifflin' CHECK (bmr_formula IN ('mifflin', 'harris')),
  protein_multiplier_override FLOAT      NULL,
  baseline_window_days       INTEGER     NOT NULL DEFAULT 30 CHECK (baseline_window_days >= 14),
  max_hr_override            INTEGER     NULL,
  watch_model                TEXT        NULL,
  menstrual_cycle_tracking   BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── physiology_samples ────────────────────────────────────────────────────
-- Time-series storage for all Apple HealthKit data types.
-- Upsert on (user_id, ts, type) to handle duplicate ingestion gracefully.
CREATE TABLE IF NOT EXISTS physiology_samples (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        NOT NULL REFERENCES user_profile(user_id) ON DELETE CASCADE,
  ts         TIMESTAMPTZ NOT NULL,
  type       TEXT        NOT NULL CHECK (type IN (
               'hrv_sdnn', 'heart_rate', 'resting_hr', 'body_mass',
               'active_energy', 'sleep_onset', 'sleep_offset',
               'sleep_stage', 'resp_rate', 'vo2max', 'spo2', 'water_ml'
             )),
  value      FLOAT       NOT NULL,
  source     TEXT        NOT NULL CHECK (source IN ('apple_health', 'manual')),
  meta       JSONB       NULL,       -- sample_count, sleep_stage label, workout_id
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, ts, type)
);

CREATE INDEX IF NOT EXISTS idx_physiology_user_ts  ON physiology_samples (user_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_physiology_user_type ON physiology_samples (user_id, type, ts DESC);

-- ─── nutrition_events ──────────────────────────────────────────────────────
-- One row per meal / eating event.  sodium_mg is optional.
-- Upsert on (user_id, ts, meal_type) — same meal reported twice → overwrite.
CREATE TABLE IF NOT EXISTS nutrition_events (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        NOT NULL REFERENCES user_profile(user_id) ON DELETE CASCADE,
  ts         TIMESTAMPTZ NOT NULL,
  calories   FLOAT       NOT NULL,
  protein_g  FLOAT       NOT NULL,
  carbs_g    FLOAT       NOT NULL,
  fat_g      FLOAT       NOT NULL,
  sugar_g    FLOAT       NOT NULL,
  sodium_mg  FLOAT       NULL,       -- optional; null when source lacks this field
  meal_type  TEXT        NOT NULL CHECK (meal_type IN ('breakfast', 'lunch', 'dinner', 'snack', 'other')),
  source     TEXT        NOT NULL CHECK (source IN ('healthifyme_csv', 'healthkit', 'manual')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, ts, meal_type)
);

CREATE INDEX IF NOT EXISTS idx_nutrition_user_ts ON nutrition_events (user_id, ts DESC);

-- ─── baselines ─────────────────────────────────────────────────────────────
-- Caches rolling-median baseline computations so the dashboard does not
-- need to re-scan 30 days of physiology_samples on every request.
-- One row per (user_id, metric_type). Recomputed nightly (or on demand via
-- GET /api/v1/user/:id/baseline).
--
-- metric_type examples: 'hrv_median', 'rhr_median', 'resp_median'
CREATE TABLE IF NOT EXISTS baselines (
  user_id      UUID        NOT NULL REFERENCES user_profile(user_id) ON DELETE CASCADE,
  metric_type  TEXT        NOT NULL,
  median_value FLOAT       NOT NULL,
  computed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY  (user_id, metric_type)
);

CREATE INDEX IF NOT EXISTS idx_baselines_user ON baselines (user_id);
