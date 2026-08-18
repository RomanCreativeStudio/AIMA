import Foundation
import Observation

/// The response-playback state for the most recently synthesized reply.
/// This view model never plays audio itself (no `AVAudioPlayer`/platform
/// audio dependency, so this package stays Linux-buildable) — the view
/// drives this state by calling `markPlaybackStarted()`/`markPlaybackFinished()`
/// around its own playback call.
public enum VoicePlaybackState: Equatable, Sendable {
    case idle
    case playing
    case finished
}

/// Backs the macOS Voice UI foundation (Phase 3.2, item 4): starting/ending
/// a voice session, submitting a voice turn (audio in, audio out), the
/// transcript history, and response-playback state. Scoped to one
/// workspace, like `ExecutionsViewModel`/`WorkflowsViewModel`. Uses
/// `@Observable` (not Combine) so this package stays Linux-buildable.
///
/// Every session must be explicitly started and ended by the caller (item
/// 5: "user control required to start sessions") — there is no wake word,
/// background listening, or autonomous conversation anywhere in this class.
@MainActor
@Observable
public final class VoiceSessionViewModel {
    public private(set) var session: VoiceSession?
    public private(set) var turns: [VoiceTurn] = []
    public private(set) var playbackState: VoicePlaybackState = .idle
    public private(set) var lastResponseAudio: Data?
    public private(set) var lastResponseAudioMimeType: String?
    public private(set) var isLoading = false
    public private(set) var errorMessage: String?
    /// Set when the most recent failure was the speech-to-text/text-to-speech
    /// provider itself (backend `VoiceProviderError`, HTTP 502) rather than a
    /// session-lifecycle or network problem — lets the view show a distinct
    /// "voice provider unavailable" state instead of a generic error.
    public private(set) var isProviderError = false
    /// The backend's configured speech-to-text/text-to-speech provider names
    /// (Phase 3.3) — fetched via `GET /health`, the same shallow,
    /// configuration-only check the Dashboard's system status uses. `nil`
    /// until `loadProviderStatus()` is called.
    public private(set) var providerStatus: SystemHealth.CheckResult?

    private let apiClient: APIClient
    private let workspaceId: String

    public init(apiClient: APIClient, workspaceId: String) {
        self.apiClient = apiClient
        self.workspaceId = workspaceId
    }

    public var isSessionActive: Bool { session?.isActive ?? false }

    /// Fetches the configured voice provider names for display — a plain
    /// read, never a live call to the vendor itself (mirrors `HealthService.
    /// checkVoiceProviders`'s shallow, configuration-only check).
    public func loadProviderStatus() async {
        do {
            providerStatus = try await apiClient.getHealth().checks.voiceProviders
        } catch {
            // Non-fatal — the voice screen still works without this, so don't surface it as errorMessage.
            providerStatus = nil
        }
    }

    /// Requires an explicit user-initiated call — starts a fresh session (and its backing conversation) every time.
    public func startSession() async {
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }

        do {
            session = try await apiClient.startVoiceSession(workspaceId: workspaceId)
            turns = []
            lastResponseAudio = nil
            lastResponseAudioMimeType = nil
            playbackState = .idle
        } catch let error as APIError {
            errorMessage = error.userMessage
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    public func stopSession() async {
        guard let sessionId = session?.id else { return }
        errorMessage = nil

        do {
            session = try await apiClient.endVoiceSession(workspaceId: workspaceId, voiceSessionId: sessionId)
        } catch let error as APIError {
            errorMessage = error.userMessage
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    /// Submits one voice turn: audio in, audio out. Appends the resulting
    /// turn to the transcript history and stores the synthesized response
    /// audio for the view to play — this method never plays it.
    public func submitVoiceRequest(audioData: Data, audioMimeType: String, configuration: VoiceConfiguration? = nil) async {
        guard let sessionId = session?.id else { return }
        isLoading = true
        errorMessage = nil
        isProviderError = false
        defer { isLoading = false }

        do {
            let response = try await apiClient.submitVoiceRequest(
                workspaceId: workspaceId,
                voiceSessionId: sessionId,
                audioData: audioData,
                audioMimeType: audioMimeType,
                configuration: configuration
            )
            turns.append(response.turn)
            lastResponseAudio = response.audioData
            lastResponseAudioMimeType = response.audioMimeType
            playbackState = .idle
        } catch let error as APIError {
            errorMessage = error.userMessage
            if case .server(let statusCode, _) = error, statusCode == 502 {
                isProviderError = true
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    public func loadTurns() async {
        guard let sessionId = session?.id else { return }
        errorMessage = nil

        do {
            turns = try await apiClient.listVoiceTurns(workspaceId: workspaceId, voiceSessionId: sessionId)
        } catch let error as APIError {
            errorMessage = error.userMessage
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    /// Called by the view immediately before it starts playing `lastResponseAudio`.
    public func markPlaybackStarted() {
        guard lastResponseAudio != nil else { return }
        playbackState = .playing
    }

    /// Called by the view once playback completes (or is stopped).
    public func markPlaybackFinished() {
        playbackState = .finished
    }
}
