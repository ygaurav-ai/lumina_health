// HealthKitManager.swift
// Handles HealthKit authorisation, incremental fetch, and mapping to API schema.

import HealthKit
import Foundation

final class HealthKitManager {
    static let shared = HealthKitManager()
    private let store = HKHealthStore()

    // MARK: - Types to read

    /// (HKQuantityTypeIdentifier, API type string, HKUnit)
    private let quantityTypes: [(HKQuantityTypeIdentifier, String, HKUnit)] = [
        (.heartRateVariabilitySDNN, "hrv_sdnn",      .secondUnit(with: .milli)),
        (.restingHeartRate,         "resting_hr",     .count().unitDivided(by: .minute())),
        (.activeEnergyBurned,       "active_energy",  .kilocalorie()),
        (.bodyMass,                 "body_mass",      .gramUnit(with: .kilo)),
    ]

    var isAvailable: Bool { HKHealthStore.isHealthDataAvailable() }

    // MARK: - Authorisation

    func requestAuthorization() async throws {
        guard isAvailable else {
            throw NSError(domain: "LuminaHealth", code: 1,
                          userInfo: [NSLocalizedDescriptionKey: "HealthKit is not available on this device."])
        }

        var readTypes: Set<HKObjectType> = [
            HKCategoryType(.sleepAnalysis),
        ]
        for (id, _, _) in quantityTypes {
            readTypes.insert(HKQuantityType(id))
        }

        // requestAuthorization does not throw — it always calls the completion.
        // We wrap it so a denial is surfaced as an error only if the store is actually inaccessible.
        try await store.requestAuthorization(toShare: [], read: readTypes)
    }

    // MARK: - Incremental fetch

    /// Fetches samples since last sync (or last 7 days on first launch).
    /// Updates `Config.lastSyncKey` in UserDefaults on success.
    func fetchSamples() async throws -> [PhysiologySample] {
        let lastSync = UserDefaults.standard.object(forKey: Config.lastSyncKey) as? Date
        let startDate = lastSync ?? Calendar.current.date(byAdding: .day, value: -7, to: Date())!
        let predicate = HKQuery.predicateForSamples(withStart: startDate, end: Date(), options: .strictEndDate)

        var all: [PhysiologySample] = []

        // Quantity types
        for (typeID, apiType, unit) in quantityTypes {
            let samples = try await fetchQuantitySamples(typeID: typeID, predicate: predicate)
            all += samples.map { s in
                PhysiologySample(
                    ts:     iso8601(s.startDate),
                    type:   apiType,
                    value:  s.quantity.doubleValue(for: unit),
                    source: "apple_health",
                    meta:   nil
                )
            }
        }

        // Sleep
        all += try await fetchSleepSamples(predicate: predicate)

        // Persist sync timestamp
        UserDefaults.standard.set(Date(), forKey: Config.lastSyncKey)

        return all
    }

    // MARK: - Private: quantity fetch

    private func fetchQuantitySamples(
        typeID: HKQuantityTypeIdentifier,
        predicate: NSPredicate
    ) async throws -> [HKQuantitySample] {
        try await withCheckedThrowingContinuation { continuation in
            let query = HKSampleQuery(
                sampleType: HKQuantityType(typeID),
                predicate: predicate,
                limit: HKObjectQueryNoLimit,
                sortDescriptors: [NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: true)]
            ) { _, results, error in
                if let error {
                    continuation.resume(throwing: error)
                } else {
                    continuation.resume(returning: (results as? [HKQuantitySample]) ?? [])
                }
            }
            store.execute(query)
        }
    }

    // MARK: - Private: sleep fetch + mapping

    private func fetchSleepSamples(predicate: NSPredicate) async throws -> [PhysiologySample] {
        let raw: [HKCategorySample] = try await withCheckedThrowingContinuation { continuation in
            let query = HKSampleQuery(
                sampleType: HKCategoryType(.sleepAnalysis),
                predicate: predicate,
                limit: HKObjectQueryNoLimit,
                sortDescriptors: [NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: true)]
            ) { _, results, error in
                if let error {
                    continuation.resume(throwing: error)
                } else {
                    continuation.resume(returning: (results as? [HKCategorySample]) ?? [])
                }
            }
            store.execute(query)
        }

        guard !raw.isEmpty else { return [] }

        var out: [PhysiologySample] = []

        // sleep_onset — first sample's start
        out.append(PhysiologySample(
            ts: iso8601(raw.first!.startDate),
            type: "sleep_onset", value: 1,
            source: "apple_health", meta: nil
        ))

        // sleep_offset — last sample's end
        out.append(PhysiologySample(
            ts: iso8601(raw.last!.endDate),
            type: "sleep_offset", value: 1,
            source: "apple_health", meta: nil
        ))

        // Per-stage samples
        for s in raw {
            let durationMin = s.endDate.timeIntervalSince(s.startDate) / 60
            out.append(PhysiologySample(
                ts:     iso8601(s.startDate),
                type:   "sleep_stage",
                value:  Double(s.value),
                source: "apple_health",
                meta:   [
                    "stage_name":   stageName(s.value),
                    "duration_min": String(format: "%.1f", durationMin),
                ]
            ))
        }

        return out
    }

    // MARK: - Helpers

    private func iso8601(_ date: Date) -> String {
        ISO8601DateFormatter().string(from: date)
    }

    /// Maps HKCategoryValueSleepAnalysis integer to a human-readable string.
    /// Values: 0=inBed, 1=asleepUnspecified, 2=awake, 3=core, 4=deep, 5=REM (iOS 16+)
    private func stageName(_ value: Int) -> String {
        switch value {
        case 0:  return "in_bed"
        case 1:  return "asleep"
        case 2:  return "awake"
        case 3:  return "core"
        case 4:  return "deep"
        case 5:  return "rem"
        default: return "unknown"
        }
    }
}
