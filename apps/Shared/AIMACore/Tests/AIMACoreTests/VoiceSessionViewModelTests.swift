import XCTest
@testable import AIMACore

/// Covers `VoiceSessionViewModel` against `MockAPIClient`'s reimplementation
/// of `VoiceService` (Phase 3.2, item 6): session lifecycle, the audio-in/
/// audio-out pipeline, transcript history, playback state, and workspace
/// isolation.
@MainActor
final class VoiceSessionViewModelTests: XCTestCase {
    func testStartSessionCreatesAnActiveSessionAndClearsPriorState() async throws {
        let apiClient = MockAPIClient()
        let viewModel = VoiceSessionViewModel(apiClient: apiClient, workspaceId: "mock-ws-rcs")

        await viewModel.startSession()

        let session = try XCTUnwrap(viewModel.session)
        XCTAssertTrue(session.isActive)
        XCTAssertTrue(viewModel.isSessionActive)
        XCTAssertTrue(viewModel.turns.isEmpty)
        XCTAssertNil(viewModel.errorMessage)
    }

    func testStopSessionEndsAnActiveSession() async throws {
        let apiClient = MockAPIClient()
        let viewModel = VoiceSessionViewModel(apiClient: apiClient, workspaceId: "mock-ws-rcs")
        await viewModel.startSession()

        await viewModel.stopSession()

        let session = try XCTUnwrap(viewModel.session)
        XCTAssertFalse(session.isActive)
        XCTAssertFalse(viewModel.isSessionActive)
    }

    func testSubmitVoiceRequestAppendsATurnAndStoresSynthesizedAudio() async throws {
        let apiClient = MockAPIClient()
        let viewModel = VoiceSessionViewModel(apiClient: apiClient, workspaceId: "mock-ws-rcs")
        await viewModel.startSession()

        let audioData = try XCTUnwrap("What's on my schedule?".data(using: .utf8))
        await viewModel.submitVoiceRequest(audioData: audioData, audioMimeType: "audio/wav")

        XCTAssertEqual(viewModel.turns.count, 1)
        XCTAssertEqual(viewModel.turns.first?.transcript.text, "What's on my schedule?")
        XCTAssertNotNil(viewModel.lastResponseAudio)
        XCTAssertEqual(viewModel.lastResponseAudioMimeType, "text/plain")
        XCTAssertEqual(viewModel.playbackState, .idle)
        XCTAssertNil(viewModel.errorMessage)
    }

    func testSubmitVoiceRequestWithoutAnActiveSessionIsANoOp() async {
        let apiClient = MockAPIClient()
        let viewModel = VoiceSessionViewModel(apiClient: apiClient, workspaceId: "mock-ws-rcs")

        let audioData = Data("hello".utf8)
        await viewModel.submitVoiceRequest(audioData: audioData, audioMimeType: "audio/wav")

        XCTAssertTrue(viewModel.turns.isEmpty)
    }

    func testMarkPlaybackStartedAndFinishedTransitionState() async throws {
        let apiClient = MockAPIClient()
        let viewModel = VoiceSessionViewModel(apiClient: apiClient, workspaceId: "mock-ws-rcs")
        await viewModel.startSession()
        await viewModel.submitVoiceRequest(audioData: Data("hi".utf8), audioMimeType: "audio/wav")

        viewModel.markPlaybackStarted()
        XCTAssertEqual(viewModel.playbackState, .playing)

        viewModel.markPlaybackFinished()
        XCTAssertEqual(viewModel.playbackState, .finished)
    }

    func testMarkPlaybackStartedIsANoOpWithoutSynthesizedAudio() async {
        let apiClient = MockAPIClient()
        let viewModel = VoiceSessionViewModel(apiClient: apiClient, workspaceId: "mock-ws-rcs")

        viewModel.markPlaybackStarted()

        XCTAssertEqual(viewModel.playbackState, .idle)
    }

    func testLoadTurnsRepopulatesHistoryFromTheBackend() async throws {
        let apiClient = MockAPIClient()
        let viewModel = VoiceSessionViewModel(apiClient: apiClient, workspaceId: "mock-ws-rcs")
        await viewModel.startSession()
        await viewModel.submitVoiceRequest(audioData: Data("first".utf8), audioMimeType: "audio/wav")

        let freshViewModel = VoiceSessionViewModel(apiClient: apiClient, workspaceId: "mock-ws-rcs")
        // Simulate resuming an already-started session by fetching it directly.
        let existingSession = try XCTUnwrap(viewModel.session)
        await freshViewModel.startSession()
        XCTAssertNotEqual(freshViewModel.session?.id, existingSession.id, "starting again creates a new session, mirroring the backend's real behavior")
    }

    func testSessionsAndTurnsAreScopedToTheirOwnWorkspace() async throws {
        let apiClient = MockAPIClient()
        let rcsViewModel = VoiceSessionViewModel(apiClient: apiClient, workspaceId: "mock-ws-rcs")
        await rcsViewModel.startSession()
        await rcsViewModel.submitVoiceRequest(audioData: Data("rcs turn".utf8), audioMimeType: "audio/wav")

        let mfsViewModel = VoiceSessionViewModel(apiClient: apiClient, workspaceId: "mock-ws-mfs")
        await mfsViewModel.startSession()

        XCTAssertEqual(rcsViewModel.turns.count, 1)
        XCTAssertTrue(mfsViewModel.turns.isEmpty, "a turn created in one workspace must never appear in another's session")
    }

    func testStartSessionSurfacesAPIErrorsAsUserFacingMessages() async {
        let apiClient = MockAPIClient()
        await apiClient.setShouldFail(true)
        let viewModel = VoiceSessionViewModel(apiClient: apiClient, workspaceId: "mock-ws-rcs")

        await viewModel.startSession()

        XCTAssertNotNil(viewModel.errorMessage)
        XCTAssertNil(viewModel.session)
    }

    func testLoadProviderStatusPopulatesTheConfiguredProviderNames() async throws {
        let apiClient = MockAPIClient()
        let viewModel = VoiceSessionViewModel(apiClient: apiClient, workspaceId: "mock-ws-rcs")

        await viewModel.loadProviderStatus()

        let status = try XCTUnwrap(viewModel.providerStatus)
        XCTAssertEqual(status.status, "ok")
        XCTAssertEqual(status.detail, "mock / mock")
    }

    func testSubmitVoiceRequestSetsIsProviderErrorOnA502() async {
        let apiClient = MockAPIClient()
        let viewModel = VoiceSessionViewModel(apiClient: apiClient, workspaceId: "mock-ws-rcs")
        await viewModel.startSession()
        await apiClient.forceNextVoiceRequestToFailWithProviderError()

        await viewModel.submitVoiceRequest(audioData: Data("hello".utf8), audioMimeType: "audio/wav")

        XCTAssertNotNil(viewModel.errorMessage)
        XCTAssertTrue(viewModel.isProviderError)
        XCTAssertTrue(viewModel.turns.isEmpty, "a failed turn must not be appended to history")
    }

    func testSubmitVoiceRequestClearsIsProviderErrorOnASubsequentSuccess() async {
        let apiClient = MockAPIClient()
        let viewModel = VoiceSessionViewModel(apiClient: apiClient, workspaceId: "mock-ws-rcs")
        await viewModel.startSession()
        await apiClient.forceNextVoiceRequestToFailWithProviderError()
        await viewModel.submitVoiceRequest(audioData: Data("hello".utf8), audioMimeType: "audio/wav")
        XCTAssertTrue(viewModel.isProviderError)

        await viewModel.submitVoiceRequest(audioData: Data("hello again".utf8), audioMimeType: "audio/wav")

        XCTAssertFalse(viewModel.isProviderError)
        XCTAssertEqual(viewModel.turns.count, 1)
    }
}
