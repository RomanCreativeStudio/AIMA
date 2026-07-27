import Foundation

/// Environment configuration for talking to the AIMA backend (Phase 2.1,
/// item 1). Kept as plain, `Sendable` data so it can be constructed from a
/// launch argument, environment variable, or a value the user enters on the
/// Settings screen (backend connection) without any platform-specific code.
public struct APIConfiguration: Equatable, Sendable {
    public var baseURL: URL
    public var requestTimeout: TimeInterval

    public init(baseURL: URL, requestTimeout: TimeInterval = 30) {
        self.baseURL = baseURL
        self.requestTimeout = requestTimeout
    }

    /// The backend's default local development address (`backend/README.md`).
    public static let developmentDefault = APIConfiguration(baseURL: URL(string: "http://127.0.0.1:4000")!)

    /// Reads `AIMA_API_BASE_URL` from the process environment if present,
    /// otherwise falls back to `developmentDefault` — lets the app, its
    /// tests, and CI point at a different backend without a code change.
    public static func fromEnvironment(_ environment: [String: String] = ProcessInfo.processInfo.environment) -> APIConfiguration {
        guard let rawURL = environment["AIMA_API_BASE_URL"], let url = URL(string: rawURL) else {
            return .developmentDefault
        }
        return APIConfiguration(baseURL: url)
    }
}
