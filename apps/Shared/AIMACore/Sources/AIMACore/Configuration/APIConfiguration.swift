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

    /// The `UserDefaults` key `resolved(environment:userDefaults:)`/`save(baseURL:to:)` share.
    private static let baseURLDefaultsKey = "AIMA_API_BASE_URL"

    /// Alpha Launch sprint: resolves the backend base URL with a clear precedence, so a physical iPhone (which
    /// has no launch-time environment variables outside an Xcode-tethered debug run) can still have a durable,
    /// user-set backend address instead of silently falling back to `developmentDefault`'s `127.0.0.1` — which
    /// on-device always means "the phone itself," never "my Mac on the LAN."
    ///
    /// 1. `AIMA_API_BASE_URL` in the process environment, if set — an explicit developer/CI override (e.g. an
    ///    Xcode scheme), always wins.
    /// 2. The most recently saved Settings value (`save(baseURL:to:)`) — persists across launches, so pointing
    ///    the app at a LAN address (the Mac's IP, for iPhone → Mac/backend over LAN) only needs to be entered
    ///    once, not every relaunch.
    /// 3. `developmentDefault`.
    public static func resolved(
        environment: [String: String] = ProcessInfo.processInfo.environment,
        userDefaults: UserDefaults = .standard
    ) -> APIConfiguration {
        if let rawURL = environment["AIMA_API_BASE_URL"], let url = URL(string: rawURL) {
            return APIConfiguration(baseURL: url)
        }
        if let savedURL = userDefaults.string(forKey: baseURLDefaultsKey), let url = URL(string: savedURL) {
            return APIConfiguration(baseURL: url)
        }
        return .developmentDefault
    }

    /// Persists `baseURL` so the next launch's `resolved(...)` picks it up — call this whenever the user changes
    /// the backend address (the Settings screen's `SettingsViewModel.applyBackendURL`, via `DependencyContainer`).
    public static func save(baseURL: URL, to userDefaults: UserDefaults = .standard) {
        userDefaults.set(baseURL.absoluteString, forKey: baseURLDefaultsKey)
    }
}
