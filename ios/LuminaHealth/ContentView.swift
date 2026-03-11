// ContentView.swift
// Root view + all child views for the Lumina Health dashboard.
// Kept in one file to simplify Xcode setup — feel free to split per-view later.

import SwiftUI

// MARK: - Root

struct ContentView: View {
    @StateObject private var vm = DashboardViewModel()

    var body: some View {
        NavigationStack {
            phaseContent
                .navigationTitle("Lumina Health")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .navigationBarTrailing) {
                        if case .ready = vm.phase {
                            Button {
                                Task { await vm.syncAndLoad() }
                            } label: {
                                Image(systemName: "arrow.clockwise")
                            }
                        }
                    }
                }
        }
        .sheet(isPresented: $vm.showExplainSheet) {
            if let response = vm.explainResponse {
                ExplainSheet(response: response)
            }
        }
        .task { await vm.start() }
    }

    // Separate @ViewBuilder computed var to silence compiler "switch in body" warnings
    @ViewBuilder
    private var phaseContent: some View {
        switch vm.phase {
        case .idle:
            LoadingView(message: "Starting…")
        case .requestingAuth:
            LoadingView(message: "Requesting HealthKit access…")
        case .syncing:
            LoadingView(message: vm.syncMessage.isEmpty ? "Uploading health data…" : vm.syncMessage)
        case .loading:
            LoadingView(message: "Loading your dashboard…")
        case .ready:
            if let dash = vm.dashboard {
                DashboardView(dashboard: dash, vm: vm)
            } else {
                LoadingView(message: "Loading…")
            }
        case .error(let message):
            ErrorView(message: message) {
                Task { await vm.syncAndLoad() }
            }
        }
    }
}

// MARK: - Dashboard

struct DashboardView: View {
    let dashboard: DashboardResponse
    @ObservedObject var vm: DashboardViewModel

    var body: some View {
        ScrollView {
            VStack(spacing: 16) {
                RecoveryCard(recovery: dashboard.recovery, vm: vm)
                SleepCard(sleep: dashboard.sleep)
                if !dashboard.evidence.isEmpty {
                    EvidenceCard(items: dashboard.evidence)
                }
                SyncStatusBar(vm: vm)
            }
            .padding(.horizontal)
            .padding(.vertical, 12)
        }
        .background(Color(.systemGroupedBackground))
    }
}

// MARK: - Recovery Card

struct RecoveryCard: View {
    let recovery: RecoveryBlock
    @ObservedObject var vm: DashboardViewModel

    private var bandColor: Color {
        switch recovery.band {
        case "PEAK":     return Color(hex: "059669")
        case "HIGH":     return Color(hex: "0D9488")
        case "MODERATE": return Color(hex: "D97706")
        case "LOW":      return Color(hex: "DC2626")
        default:         return Color(hex: "7C3AED")  // REST
        }
    }

    private var displayBand: String {
        recovery.band == "REST" ? "REST DAY" : recovery.band
    }

    var body: some View {
        VStack(spacing: 14) {

            // Headline
            Text("Recovery Score")
                .font(.subheadline.weight(.medium))
                .foregroundStyle(.secondary)

            // Big score
            Text("\(Int(round(recovery.score)))")
                .font(.system(size: 96, weight: .bold, design: .rounded))
                .foregroundStyle(bandColor)
                .contentTransition(.numericText())

            // Band pill
            Text(displayBand)
                .font(.headline)
                .foregroundStyle(bandColor)
                .padding(.horizontal, 18)
                .padding(.vertical, 6)
                .background(bandColor.opacity(0.13))
                .clipShape(Capsule())

            // Confidence
            Text("Confidence: \(recovery.confidence)")
                .font(.caption)
                .foregroundStyle(.tertiary)

            // Score breakdown mini-grid
            if let hrv = recovery.breakdown.hrv_score,
               let sl  = recovery.breakdown.sleep_score,
               let rhr = recovery.breakdown.rhr_score {
                HStack(spacing: 0) {
                    ScoreChip(label: "HRV",   value: hrv,  color: bandColor)
                    Divider().frame(height: 28)
                    ScoreChip(label: "Sleep",  value: sl,  color: bandColor)
                    Divider().frame(height: 28)
                    ScoreChip(label: "RHR",    value: rhr, color: bandColor)
                }
                .background(bandColor.opacity(0.06))
                .clipShape(RoundedRectangle(cornerRadius: 10))
            }

            // Explain button
            Button {
                Task { await vm.requestExplanation() }
            } label: {
                HStack(spacing: 8) {
                    if vm.isExplaining {
                        ProgressView().tint(.white)
                            .scaleEffect(0.85)
                    } else {
                        Image(systemName: "sparkles")
                    }
                    Text("Why is my recovery \(Int(round(recovery.score)))?")
                        .fontWeight(.semibold)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 13)
                .background(bandColor)
                .foregroundStyle(.white)
                .clipShape(RoundedRectangle(cornerRadius: 13))
            }
            .disabled(vm.isExplaining)
        }
        .padding(20)
        .background(Color(.secondarySystemGroupedBackground))
        .clipShape(RoundedRectangle(cornerRadius: 18))
        .shadow(color: .black.opacity(0.04), radius: 4, y: 2)
    }
}

private struct ScoreChip: View {
    let label: String
    let value: Double
    let color: Color

    var body: some View {
        VStack(spacing: 2) {
            Text(label)
                .font(.caption2)
                .foregroundStyle(.secondary)
            Text("\(Int(round(value)))")
                .font(.headline.weight(.semibold))
                .foregroundStyle(color)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 8)
    }
}

// MARK: - Sleep Card

struct SleepCard: View {
    let sleep: SleepBlock

    private var scoreColor: Color {
        switch Int(round(sleep.score)) {
        case 80...: return Color(hex: "0D9488")
        case 60...: return Color(hex: "D97706")
        default:    return Color(hex: "DC2626")
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {

            Label("Sleep Score", systemImage: "moon.stars.fill")
                .font(.subheadline.weight(.medium))
                .foregroundStyle(.indigo)

            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text("\(Int(round(sleep.score)))")
                    .font(.system(size: 52, weight: .bold, design: .rounded))
                    .foregroundStyle(scoreColor)
                Text("/ 100")
                    .font(.title2)
                    .foregroundStyle(.secondary)
                Spacer()
                Text(sleep.confidence)
                    .font(.caption.weight(.medium))
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(Color(.tertiarySystemFill))
                    .clipShape(Capsule())
            }

            // Three stats in a row
            HStack {
                SleepStat(label: "Slept",    value: String(format: "%.1fh", sleep.total_sleep_h))
                Spacer()
                SleepStat(label: "Need",     value: String(format: "%.1fh", sleep.sleep_need_h))
                Spacer()
                SleepStat(label: "Debt",     value: String(format: "%.1fh", sleep.sleep_debt_h),
                          valueColor: sleep.sleep_debt_h > 1 ? .red : .primary)
            }

            // Stage bar if we have pct data
            if let deep = sleep.deep_pct, let rem = sleep.rem_pct {
                SleepStageBar(deepPct: deep, remPct: rem)
            }
        }
        .padding(20)
        .background(Color(.secondarySystemGroupedBackground))
        .clipShape(RoundedRectangle(cornerRadius: 18))
        .shadow(color: .black.opacity(0.04), radius: 4, y: 2)
    }
}

private struct SleepStat: View {
    let label: String
    let value: String
    var valueColor: Color = .primary

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(.caption).foregroundStyle(.secondary)
            Text(value).font(.title3.weight(.semibold)).foregroundStyle(valueColor)
        }
    }
}

private struct SleepStageBar: View {
    let deepPct: Double   // 0–1
    let remPct:  Double   // 0–1

    private var corePct: Double { max(0, 1 - deepPct - remPct) }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Stage breakdown").font(.caption2).foregroundStyle(.tertiary)
            GeometryReader { geo in
                HStack(spacing: 2) {
                    Capsule()
                        .fill(Color(hex: "4F46E5"))          // deep — indigo
                        .frame(width: geo.size.width * deepPct)
                    Capsule()
                        .fill(Color(hex: "7C3AED"))          // REM — purple
                        .frame(width: geo.size.width * remPct)
                    Capsule()
                        .fill(Color(hex: "94A3B8"))          // core — slate
                        .frame(maxWidth: .infinity)
                }
            }
            .frame(height: 8)
            HStack {
                Legend(color: Color(hex: "4F46E5"), label: "Deep \(Int(deepPct * 100))%")
                Legend(color: Color(hex: "7C3AED"), label: "REM \(Int(remPct * 100))%")
                Legend(color: Color(hex: "94A3B8"), label: "Core")
            }
        }
    }

    private struct Legend: View {
        let color: Color; let label: String
        var body: some View {
            HStack(spacing: 4) {
                Circle().fill(color).frame(width: 6, height: 6)
                Text(label).font(.caption2).foregroundStyle(.secondary)
            }
        }
    }
}

// MARK: - Evidence Card

struct EvidenceCard: View {
    let items: [EvidenceItem]

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Label("Key Signals", systemImage: "waveform.path.ecg")
                .font(.subheadline.weight(.medium))
                .padding(.bottom, 12)

            ForEach(Array(items.prefix(3).enumerated()), id: \.offset) { idx, item in
                HStack(alignment: .center, spacing: 12) {
                    directionIcon(item.direction)
                        .font(.title3)
                        .frame(width: 28)

                    VStack(alignment: .leading, spacing: 2) {
                        Text(item.label)
                            .font(.subheadline.weight(.medium))
                        Text(item.value)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                }
                .padding(.vertical, 8)

                if idx < min(items.count, 3) - 1 {
                    Divider()
                }
            }
        }
        .padding(20)
        .background(Color(.secondarySystemGroupedBackground))
        .clipShape(RoundedRectangle(cornerRadius: 18))
        .shadow(color: .black.opacity(0.04), radius: 4, y: 2)
    }

    @ViewBuilder
    private func directionIcon(_ direction: String) -> some View {
        switch direction {
        case "up":
            Image(systemName: "arrow.up.circle.fill").foregroundStyle(.green)
        case "down":
            Image(systemName: "arrow.down.circle.fill").foregroundStyle(.red)
        default:
            Image(systemName: "minus.circle.fill").foregroundStyle(.gray)
        }
    }
}

// MARK: - Sync Status Bar

struct SyncStatusBar: View {
    @ObservedObject var vm: DashboardViewModel

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: "checkmark.icloud.fill")
                .foregroundStyle(.green)
                .font(.caption)
            Text(vm.lastSyncText)
                .font(.caption)
                .foregroundStyle(.secondary)
            Spacer()
        }
        .padding(.horizontal, 4)
        .padding(.bottom, 8)
    }
}

// MARK: - Loading

struct LoadingView: View {
    let message: String

    var body: some View {
        VStack(spacing: 24) {
            ProgressView()
                .scaleEffect(1.4)
            Text(message)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 40)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(.systemGroupedBackground))
    }
}

// MARK: - Error

struct ErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: 24) {
            Image(systemName: "wifi.exclamationmark")
                .font(.system(size: 56))
                .foregroundStyle(.red.opacity(0.8))

            Text(message)
                .font(.body)
                .multilineTextAlignment(.center)
                .foregroundStyle(.secondary)
                .padding(.horizontal, 32)

            Button("Try Again", action: onRetry)
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(.systemGroupedBackground))
    }
}

// MARK: - Explain Sheet

struct ExplainSheet: View {
    let response: ExplainResponse
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {

                    // Main explanation
                    Text(response.explanation_text)
                        .font(.body)
                        .lineSpacing(4)
                        .padding(.horizontal)

                    // Top 3 data items
                    if !response.top_3_data_items.isEmpty {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Supporting Data")
                                .font(.headline)
                                .padding(.horizontal)
                            ForEach(response.top_3_data_items) { item in
                                HStack(alignment: .top, spacing: 10) {
                                    directionBadge(item.direction)
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(item.label)
                                            .font(.subheadline.weight(.medium))
                                        Text(item.value)
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                    }
                                    Spacer()
                                }
                                .padding(.horizontal)
                                .padding(.vertical, 6)
                            }
                        }
                    }

                    // Action hint
                    if !response.action_hint.isEmpty {
                        HStack(alignment: .top, spacing: 12) {
                            Image(systemName: "lightbulb.fill")
                                .foregroundStyle(.orange)
                                .font(.title3)
                            VStack(alignment: .leading, spacing: 4) {
                                Text("Today's Action")
                                    .font(.headline)
                                Text(response.action_hint)
                                    .font(.body)
                            }
                        }
                        .padding(16)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(Color.orange.opacity(0.09))
                        .clipShape(RoundedRectangle(cornerRadius: 14))
                        .padding(.horizontal)
                    }

                    // Footer
                    HStack {
                        Text("Confidence: \(response.confidence)")
                        Text("·")
                        Text(response.generated_by)
                    }
                    .font(.caption)
                    .foregroundStyle(.tertiary)
                    .padding(.horizontal)
                    .padding(.bottom, 20)
                }
                .padding(.top, 8)
            }
            .navigationTitle("Recovery Insight")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }

    @ViewBuilder
    private func directionBadge(_ direction: String) -> some View {
        switch direction {
        case "up":
            Image(systemName: "arrow.up.circle.fill").foregroundStyle(.green)
        case "down":
            Image(systemName: "arrow.down.circle.fill").foregroundStyle(.red)
        default:
            Image(systemName: "minus.circle.fill").foregroundStyle(.gray)
        }
    }
}

// MARK: - Color(hex:) convenience

extension Color {
    /// Initialise from a 6-character hex string (no leading #).
    init(hex: String) {
        let hex = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        var value: UInt64 = 0
        Scanner(string: hex).scanHexInt64(&value)
        self.init(
            red:   Double((value >> 16) & 0xFF) / 255,
            green: Double((value >>  8) & 0xFF) / 255,
            blue:  Double( value        & 0xFF) / 255
        )
    }
}
