import Foundation
import Observation

/// Backs the Settings screen (Phase 2.1, item 2): backend connection,
/// user profile/preferences, and configuration. Editing the backend
/// connection here doesn't reach into `URLSessionAPIClient` directly —
/// `onBackendURLChange` hands the new `URL` back to whatever constructed
/// this view model (the app's `DependencyContainer`), since rebuilding the
/// `APIClient` is a dependency-injection concern, not a view model one.
/// Uses `@Observable` (not Combine's `ObservableObject`) so this package
/// stays Linux-buildable — see `Package.swift`.
@MainActor
@Observable
public final class SettingsViewModel {
    public private(set) var user: UserProfile?
    public var backendBaseURLText: String
    public private(set) var isLoading = false
    public private(set) var isSaving = false
    public private(set) var errorMessage: String?
    public private(set) var saveConfirmation: String?

    public var onBackendURLChange: ((URL) -> Void)?

    private let apiClient: APIClient
    private let userId: String

    public init(apiClient: APIClient, userId: String, currentConfiguration: APIConfiguration) {
        self.apiClient = apiClient
        self.userId = userId
        self.backendBaseURLText = currentConfiguration.baseURL.absoluteString
    }

    public func load() async {
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }

        do {
            user = try await apiClient.getUser(id: userId)
        } catch let error as APIError {
            errorMessage = error.userMessage
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    public func saveProfile(displayName: String, communicationStyle: String) async {
        isSaving = true
        errorMessage = nil
        saveConfirmation = nil
        defer { isSaving = false }

        do {
            let request = UpdateUserProfileRequest(
                displayName: displayName.isEmpty ? nil : displayName,
                communicationStyle: communicationStyle.isEmpty ? nil : communicationStyle
            )
            user = try await apiClient.updateUserProfile(id: userId, request: request)
            saveConfirmation = "Saved."
        } catch let error as APIError {
            errorMessage = error.userMessage
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    /// Validates `backendBaseURLText` and, if it's a real URL, hands it to `onBackendURLChange`.
    public func applyBackendURL() {
        guard let url = URL(string: backendBaseURLText), url.scheme != nil, url.host != nil else {
            errorMessage = "Enter a valid URL, e.g. http://127.0.0.1:4000"
            return
        }
        errorMessage = nil
        onBackendURLChange?(url)
    }
}
