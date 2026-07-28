import Foundation

/// Mirrors `backend/src/health/healthService.ts`'s `GET /health` response
/// shape (Phase 1.6).
public struct SystemHealth: Codable, Equatable, Sendable {
    public struct CheckResult: Codable, Equatable, Sendable {
        public let status: String
        public let detail: String?

        public init(status: String, detail: String?) {
            self.status = status
            self.detail = detail
        }
    }

    public struct Checks: Codable, Equatable, Sendable {
        public let database: CheckResult
        public let aiProvider: CheckResult
        public let memory: CheckResult
        public let knowledge: CheckResult
        public let integrations: CheckResult

        public init(
            database: CheckResult,
            aiProvider: CheckResult,
            memory: CheckResult,
            knowledge: CheckResult,
            integrations: CheckResult
        ) {
            self.database = database
            self.aiProvider = aiProvider
            self.memory = memory
            self.knowledge = knowledge
            self.integrations = integrations
        }
    }

    public let status: String
    public let timestamp: String
    public let checks: Checks

    public init(status: String, timestamp: String, checks: Checks) {
        self.status = status
        self.timestamp = timestamp
        self.checks = checks
    }

    /// Convenience for the Dashboard's status indicator.
    public var isHealthy: Bool { status == "ok" }
}
