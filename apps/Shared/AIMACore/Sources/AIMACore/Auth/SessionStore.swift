import Foundation

/// The session + identity pair a `SessionStore` persists together — bundled rather than storing `AuthSession`
/// alone so a restored session (a fresh process, no prior `signIn` call) can also answer `AuthClient
/// .currentUser()` without a second round trip the backend's login response doesn't support (there is no
/// "fetch the session I already have" endpoint — see `BackendAuthClient`'s doc comment).
public struct PersistedSession: Equatable, Sendable {
    public let session: AuthSession
    public let user: AuthenticatedUser

    public init(session: AuthSession, user: AuthenticatedUser) {
        self.session = session
        self.user = user
    }
}

/// Where an `AuthClient` persists a session across app relaunches — its own protocol, not folded into
/// `AuthClient` itself, so the storage mechanism can vary by platform without touching any HTTP logic:
/// `KeychainSessionStore` on Apple platforms, `InMemorySessionStore` everywhere else (tests, previews, and this
/// package's Linux build — Keychain Services has no Linux implementation, see `KeychainSessionStore.swift`).
public protocol SessionStore: Sendable {
    func save(_ persisted: PersistedSession) async
    func load() async -> PersistedSession?
    func clear() async
}

/// The default `SessionStore` — holds the session in memory for the process's lifetime only, nothing durable.
/// Used wherever a real `KeychainSessionStore` isn't supplied: `AuthClientTests`, `#Preview`s, and this
/// package's own Linux `swift test` run. An `actor` for the same reason `BackendAuthClient`/`MockAuthClient`
/// are — safe mutable state under Swift concurrency without extra locking.
public actor InMemorySessionStore: SessionStore {
    private var stored: PersistedSession?

    public init() {}

    public func save(_ persisted: PersistedSession) async {
        stored = persisted
    }

    public func load() async -> PersistedSession? {
        stored
    }

    public func clear() async {
        stored = nil
    }
}
