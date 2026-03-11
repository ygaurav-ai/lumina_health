// Models.swift
// All Codable request/response types + app-wide constants.

import Foundation

// MARK: - App Constants

enum Config {
    /// Replit backend — update if you redeploy
    static let baseURL = "https://a7afbe9e-1e66-488d-b1c0-b7de5238b084-00-3fd4e7pc9cd8b.sisko.replit.dev"

    /// Hardcoded test user for Phase 1.5
    static let testUserID = "550e8400-e29b-41d4-a716-446655440000"

    /// UserDefaults key for incremental sync timestamp
    static let lastSyncKey = "lumina_last_sync_v1"
}

// MARK: - Ingest Request

struct PhysiologySample: Codable {
    let ts: String                    // ISO-8601
    let type: String                  // e.g. "hrv_sdnn"
    let value: Double
    let source: String                // always "apple_health"
    let meta: [String: String]?       // optional stage metadata
}

struct IngestRequest: Codable {
    let user_id: String
    let samples: [PhysiologySample]
}

struct IngestResponse: Codable {
    let inserted: Int
    let errors: [String]
}

// MARK: - Explain Request / Response

struct ExplainRequest: Codable {
    let user_id: String
    let question: String
}

struct ExplainResponse: Codable {
    let user_id: String
    let question: String
    let explanation_text: String
    let top_3_data_items: [DataItem]
    let action_hint: String
    let confidence: String
    let generated_by: String
}

struct DataItem: Codable, Identifiable {
    var id: String { "\(label)|\(value)" }
    let label: String
    let value: String
    let direction: String
}

// MARK: - Dashboard Response

struct DashboardResponse: Codable {
    let user_id: String
    let date: String
    let recovery: RecoveryBlock
    let sleep: SleepBlock
    let nutrition: NutritionBlock
    let strain: StrainBlock
    let illness_flag: Bool?
    let evidence: [EvidenceItem]
}

struct RecoveryBlock: Codable {
    let score: Double
    let confidence: String
    let band: String
    let breakdown: RecoveryBreakdown
}

struct RecoveryBreakdown: Codable {
    let hrv_score: Double?
    let sleep_score: Double?
    let rhr_score: Double?
    let resp_score: Double?
}

struct SleepBlock: Codable {
    let score: Double
    let confidence: String
    let breakdown: SleepBreakdown
    let total_sleep_h: Double
    let sleep_need_h: Double
    let sleep_debt_h: Double
    let deep_pct: Double?
    let rem_pct: Double?
    let efficiency_pct: Double?
}

struct SleepBreakdown: Codable {
    let duration_score: Double
    let deep_score: Double
    let rem_score: Double
    let efficiency_score: Double
}

struct NutritionBlock: Codable {
    let available: Bool
    let protein_score: Double?
    let protein_consumed_g: Double?
    let protein_target_g: Double?
    let sleep_interference: Double?
    let metabolic_balance: Double?
    let hydration_pct: Double?
}

struct StrainBlock: Codable {
    let score: Double?
    let confidence: String
}

struct EvidenceItem: Codable, Identifiable {
    var id: String { "\(label)|\(value)" }
    let label: String
    let value: String
    let direction: String  // "up" | "down" | "neutral"
}
