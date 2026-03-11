// APIClient.swift
// Thin URLSession wrapper — all calls are async/await, JSON in / JSON out.

import Foundation

enum APIError: LocalizedError {
    case httpError(Int)
    case noData

    var errorDescription: String? {
        switch self {
        case .httpError(let code): return "Server returned HTTP \(code)."
        case .noData: return "No data received from server."
        }
    }
}

final class APIClient {
    static let shared = APIClient()

    private let session: URLSession = {
        let cfg = URLSessionConfiguration.default
        cfg.timeoutIntervalForRequest  = 30
        cfg.timeoutIntervalForResource = 60
        return URLSession(configuration: cfg)
    }()

    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()

    // MARK: - Public API

    /// Upload physiology samples; returns the ingest result.
    func ingestSamples(_ samples: [PhysiologySample]) async throws -> IngestResponse {
        let body = IngestRequest(user_id: Config.testUserID, samples: samples)
        return try await post("/api/v1/ingest/physiology", body: body)
    }

    /// Fetch today's dashboard. Pass an explicit ISO date string to override.
    func fetchDashboard(date: String? = nil) async throws -> DashboardResponse {
        var path = "/api/v1/user/\(Config.testUserID)/dashboard"
        if let d = date { path += "?date=\(d)" }
        return try await get(path)
    }

    /// Call the explain endpoint with the current recovery score.
    func explain(recoveryScore: Int) async throws -> ExplainResponse {
        let body = ExplainRequest(
            user_id:  Config.testUserID,
            question: "Why is my recovery \(recoveryScore)?"
        )
        return try await post("/api/v1/ai/explain", body: body)
    }

    // MARK: - Private helpers

    private func post<Body: Encodable, Resp: Decodable>(
        _ path: String, body: Body
    ) async throws -> Resp {
        var req = URLRequest(url: makeURL(path))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try encoder.encode(body)
        return try await execute(req)
    }

    private func get<Resp: Decodable>(_ path: String) async throws -> Resp {
        let req = URLRequest(url: makeURL(path))
        return try await execute(req)
    }

    private func execute<Resp: Decodable>(_ req: URLRequest) async throws -> Resp {
        let (data, response) = try await session.data(for: req)
        if let http = response as? HTTPURLResponse,
           !(200...299).contains(http.statusCode) {
            throw APIError.httpError(http.statusCode)
        }
        return try decoder.decode(Resp.self, from: data)
    }

    private func makeURL(_ path: String) -> URL {
        URL(string: Config.baseURL + path)!
    }
}
