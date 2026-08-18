#if canImport(Security)
import Foundation
import Security

/// Persists the current session in the platform Keychain (`kSecClassGenericPassword`) — the real `SessionStore`
/// for production use. Only compiles where `Security` is available (macOS/iOS/tvOS — exactly `Package.swift`'s
/// existing platform list), so this package's Linux build never sees it; `InMemorySessionStore` is what Linux,
/// tests, and previews get instead. Not an `actor`: every `SecItem*` call is already synchronous and
/// thread-safe at the OS level, so there's no mutable state of this type's own left to protect.
public struct KeychainSessionStore: SessionStore {
    private let service: String
    private let account: String
    private let encoder: JSONEncoder
    private let decoder: JSONDecoder

    public init(service: String = "com.aima.app.session", account: String = "current") {
        self.service = service
        self.account = account
        self.encoder = JSONEncoder()
        self.decoder = JSONDecoder()
    }

    public func save(_ persisted: PersistedSession) async {
        guard let data = try? encoder.encode(StoredPayload(persisted)) else { return }
        SecItemDelete(query as CFDictionary)
        var attributes = query
        attributes[kSecValueData as String] = data
        // Available as soon as the user unlocks the device once after a restart — a background process
        // shouldn't need to refresh a session before the user has ever unlocked, and this app never runs one
        // (explicit actions only, no hidden background behavior).
        attributes[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        SecItemAdd(attributes as CFDictionary, nil)
    }

    public func load() async -> PersistedSession? {
        var lookupQuery = query
        lookupQuery[kSecReturnData as String] = true
        lookupQuery[kSecMatchLimit as String] = kSecMatchLimitOne

        var result: AnyObject?
        let status = SecItemCopyMatching(lookupQuery as CFDictionary, &result)
        guard status == errSecSuccess,
              let data = result as? Data,
              let payload = try? decoder.decode(StoredPayload.self, from: data) else {
            return nil
        }
        return payload.asPersistedSession
    }

    public func clear() async {
        SecItemDelete(query as CFDictionary)
    }

    private var query: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
    }
}

/// What actually goes into the Keychain item's data blob — a flat, `Codable` shape independent of
/// `AuthSession`/`AuthenticatedUser`'s own definitions, so those types are free to change without this stored
/// format silently breaking (or worse, silently misreading old data) on the next app update.
private struct StoredPayload: Codable {
    let accessToken: String
    let refreshToken: String
    let expiresAt: Date
    let userId: String
    let email: String
    let displayName: String?

    init(_ persisted: PersistedSession) {
        accessToken = persisted.session.accessToken
        refreshToken = persisted.session.refreshToken
        expiresAt = persisted.session.expiresAt
        userId = persisted.session.userId
        email = persisted.user.email
        displayName = persisted.user.displayName
    }

    var asPersistedSession: PersistedSession {
        PersistedSession(
            session: AuthSession(accessToken: accessToken, refreshToken: refreshToken, expiresAt: expiresAt, userId: userId),
            user: AuthenticatedUser(id: userId, email: email, displayName: displayName)
        )
    }
}
#endif
