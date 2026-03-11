// DashboardViewModel.swift
// Drives the UI — owns state machine, orchestrates HK fetch → ingest → dashboard load.

import SwiftUI

@MainActor
final class DashboardViewModel: ObservableObject {

    // MARK: - State machine

    enum Phase: Equatable {
        case idle
        case requestingAuth
        case syncing
        case loading
        case ready
        case error(String)
    }

    // MARK: - Published state

    @Published var phase:            Phase             = .idle
    @Published var dashboard:        DashboardResponse? = nil
    @Published var explainResponse:  ExplainResponse?  = nil
    @Published var lastSyncDate:     Date?
    @Published var isExplaining:     Bool              = false
    @Published var showExplainSheet: Bool              = false
    @Published var syncMessage:      String            = ""

    // MARK: - Dependencies

    private let hk  = HealthKitManager.shared
    private let api = APIClient.shared

    // MARK: - Computed

    var lastSyncText: String {
        guard let d = lastSyncDate else { return "Not yet synced" }
        let fmt = RelativeDateTimeFormatter()
        fmt.unitsStyle = .full
        return "Synced \(fmt.localizedString(for: d, relativeTo: Date()))"
    }

    // MARK: - Entry point

    /// Called once on first appearance.
    func start() async {
        guard phase == .idle else { return }
        phase = .requestingAuth

        do {
            try await hk.requestAuthorization()
        } catch {
            phase = .error("HealthKit unavailable: \(error.localizedDescription)")
            return
        }

        await syncAndLoad()
    }

    // MARK: - Sync + Load (also called by the refresh button)

    func syncAndLoad() async {
        phase = .syncing
        syncMessage = "Uploading health data…"

        // Upload HealthKit samples (non-fatal if it fails — we still show dashboard)
        do {
            let samples = try await hk.fetchSamples()
            if !samples.isEmpty {
                let result = try await api.ingestSamples(samples)
                syncMessage = "Uploaded \(result.inserted) samples"
            } else {
                syncMessage = "No new samples to upload"
            }
            lastSyncDate = Date()
        } catch {
            syncMessage = "Upload skipped: \(error.localizedDescription)"
            // non-fatal — continue to dashboard fetch
        }

        // Fetch dashboard
        phase = .loading
        do {
            dashboard = try await api.fetchDashboard()
            phase = .ready
        } catch {
            phase = .error("Could not reach the Lumina backend.\n\nMake sure your Replit is running and you have an internet connection.")
        }
    }

    // MARK: - Explain

    func requestExplanation() async {
        guard let score = dashboard.map({ Int(round($0.recovery.score)) }) else { return }
        isExplaining = true
        defer { isExplaining = false }

        do {
            explainResponse = try await api.explain(recoveryScore: score)
            showExplainSheet = true
        } catch {
            // Silently ignore — user can try again
        }
    }
}
