// ═══════════════════════════════════════════════════════════════════════════
// LUMINA HEALTH — Shared TypeScript Types
// ═══════════════════════════════════════════════════════════════════════════

// ─── Physiology ─────────────────────────────────────────────────────────────

export type PhysiologySampleType =
  | 'hrv_sdnn'
  | 'heart_rate'
  | 'resting_hr'
  | 'body_mass'
  | 'active_energy'
  | 'sleep_onset'
  | 'sleep_offset'
  | 'sleep_stage'
  | 'resp_rate'
  | 'vo2max'
  | 'spo2'
  | 'water_ml';

export type PhysiologySource = 'apple_health' | 'manual';

export interface PhysiologySampleMeta {
  sample_count?: number;
  sleep_stage?: string;   // e.g. 'asleepDeep' — only for type=sleep_stage
  workout_id?: string;    // UUID — links HR sample to a workout
}

export interface PhysiologySample {
  ts: string;                   // ISO8601 with timezone
  type: PhysiologySampleType;
  value: number;
  meta?: PhysiologySampleMeta;
}

export interface IngestPhysiologyBody {
  user_id: string;              // UUID
  source: PhysiologySource;
  samples: PhysiologySample[];
}

export interface IngestPhysiologyResult {
  inserted: number;
  errors: string[];
}

// ─── Nutrition ───────────────────────────────────────────────────────────────

export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack' | 'other';
export type NutritionSource = 'healthifyme_csv' | 'healthkit' | 'manual';

export interface NutritionEvent {
  user_id: string;
  ts: string;                   // ISO8601 with timezone
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  sugar_g: number;
  sodium_mg: number | null;     // optional field
  meal_type: MealType;
  source: NutritionSource;
}

/** One row from a HealthifyMe CSV export (pre-normalisation) */
export interface CsvNutritionRow {
  timestamp: string;
  calories: string;
  protein_g: string;
  carbs_g: string;
  fat_g: string;
  sugar_g: string;
  sodium_mg?: string;           // column may be absent
  meal_type: string;
}

export interface IngestNutritionCsvResult {
  rows_parsed: number;
  rows_inserted: number;
  errors: string[];
}

// ─── Baselines (Phase 1) ─────────────────────────────────────────────────────

export interface BaselineResult {
  user_id:              string;
  hrv_median:           number | null;
  rhr_median:           number | null;
  resp_median:          number | null;
  days_of_data:         number;
  baseline_established: boolean; // true when days_of_data >= 14
  window_days:          number;
  computed_at:          string;
}

// ─── Dashboard (Phase 1) ─────────────────────────────────────────────────────

export interface DashboardNutritionBlock {
  available:          boolean;
  protein_score:      number | null;
  protein_consumed_g: number | null;
  protein_target_g:   number | null;
  sleep_interference: number | null;
  metabolic_balance:  number | null;
  hydration_pct:      number | null;
}

// ─── AI Explain (Phase 1) ────────────────────────────────────────────────────

export interface ExplainResponse {
  user_id:          string;
  question:         string;
  explanation_text: string;
  top_3_data_items: Array<{ label: string; value: string; direction: string }>;
  action_hint:      string;
  confidence:       string;
  generated_by:     string; // 'template_v1' (Phase 1) → 'llm_v1' (Phase 3)
}

// ─── User Profile ────────────────────────────────────────────────────────────

export type BiologicalSex = 'male' | 'female' | 'prefer_not_to_say';
export type FitnessGoal = 'performance' | 'endurance' | 'weight_loss' | 'longevity' | 'general_health';
export type Chronotype = 'morning' | 'intermediate' | 'evening';
export type BmrFormula = 'mifflin' | 'harris';

export interface UserProfile {
  user_id: string;
  weight_kg: number;
  height_cm: number;
  age: number;
  biological_sex: BiologicalSex;
  fitness_goal: FitnessGoal;
  sleep_target_hours: number;
  chronotype: Chronotype;
  bmr_formula: BmrFormula;
  protein_multiplier_override: number | null;
  baseline_window_days: number;
  max_hr_override: number | null;
  watch_model: string | null;
  menstrual_cycle_tracking: boolean;
  created_at: string;
  updated_at: string;
}
