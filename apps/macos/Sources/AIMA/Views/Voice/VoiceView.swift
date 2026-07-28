import AIMACore
import SwiftUI

/// The Voice UI Foundation (Phase 3.2, item 4): explicit start/stop session
/// controls, a transcript history, and a response-playback state indicator.
/// No wake word, background listening, or autonomous conversation exists
/// anywhere here — every turn requires the user to type an utterance and
/// press Send, and every session requires an explicit Start/Stop tap
/// (item 5: "user control required to start sessions").
///
/// Real microphone capture (`AVAudioEngine`) is a later phase's work — this
/// foundation encodes the typed utterance as UTF-8 bytes and sends it as the
/// "audio" payload, which is exactly what the backend's `MockSpeechToTextProvider`
/// expects in this environment (`ai-engine/src/voice/MockSpeechToTextProvider.ts`)
/// while no vendor STT is wired up. Swapping in real audio capture later only
/// changes what produces the `Data` passed to `submitVoiceRequest` — the
/// session lifecycle, transcript display, and playback-state UI below don't change.
struct VoiceView: View {
    let container: DependencyContainer
    @State private var viewModel: VoiceSessionViewModel
    @State private var utterance = ""

    init(container: DependencyContainer, workspaceId: String) {
        self.container = container
        _viewModel = State(initialValue: container.makeVoiceSessionViewModel(workspaceId: workspaceId))
    }

    var body: some View {
        VStack(spacing: 0) {
            sessionControls
                .padding()
            Divider()
            transcriptList
            Divider()
            composer
                .padding()
        }
        .navigationTitle("Voice")
    }

    private var sessionControls: some View {
        HStack {
            Circle()
                .fill(viewModel.isSessionActive ? .green : .secondary)
                .frame(width: 10, height: 10)
            Text(sessionStatusText)
                .font(.subheadline)
                .foregroundStyle(.secondary)

            Spacer()

            if viewModel.isSessionActive {
                Button("Stop Session") {
                    Task { await viewModel.stopSession() }
                }
            } else {
                Button("Start Session") {
                    Task { await viewModel.startSession() }
                }
                .buttonStyle(.borderedProminent)
            }
        }
    }

    private var sessionStatusText: String {
        guard let session = viewModel.session else { return "No session" }
        return session.isActive ? "Session active" : "Session ended"
    }

    private var transcriptList: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 12) {
                if viewModel.turns.isEmpty {
                    Text("No turns yet. Start a session and send an utterance below.")
                        .foregroundStyle(.secondary)
                        .padding()
                } else {
                    ForEach(viewModel.turns) { turn in
                        VoiceTurnRow(turn: turn)
                    }
                }

                if let errorMessage = viewModel.errorMessage {
                    Label(errorMessage, systemImage: "exclamationmark.triangle.fill")
                        .foregroundStyle(.red)
                        .font(.caption)
                }
            }
            .padding(.horizontal)
        }
    }

    private var composer: some View {
        VStack(alignment: .leading, spacing: 8) {
            if viewModel.lastResponseAudio != nil {
                playbackControl
            }

            HStack {
                TextField("Type an utterance…", text: $utterance)
                    .textFieldStyle(.roundedBorder)
                    .disabled(!viewModel.isSessionActive)
                    .onSubmit(submit)

                Button("Send", action: submit)
                    .disabled(!viewModel.isSessionActive || utterance.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }

            if viewModel.isLoading {
                ProgressView().controlSize(.small)
            }
        }
    }

    private var playbackControl: some View {
        HStack {
            Image(systemName: playbackIcon)
                .foregroundStyle(.secondary)
            Text(playbackText)
                .font(.caption)
                .foregroundStyle(.secondary)
            Spacer()
            if viewModel.playbackState != .playing {
                Button("Play Response") {
                    viewModel.markPlaybackStarted()
                    // Real audio playback (AVAudioPlayer) is a later phase's
                    // work — this foundation only tracks playback state.
                    viewModel.markPlaybackFinished()
                }
            }
        }
    }

    private var playbackIcon: String {
        switch viewModel.playbackState {
        case .idle: return "speaker.wave.2"
        case .playing: return "speaker.wave.3.fill"
        case .finished: return "checkmark.circle"
        }
    }

    private var playbackText: String {
        switch viewModel.playbackState {
        case .idle: return "Response ready"
        case .playing: return "Playing…"
        case .finished: return "Playback finished"
        }
    }

    private func submit() {
        let trimmed = utterance.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, let audioData = trimmed.data(using: .utf8) else { return }
        utterance = ""
        Task { await viewModel.submitVoiceRequest(audioData: audioData, audioMimeType: "audio/wav") }
    }
}

private struct VoiceTurnRow: View {
    let turn: VoiceTurn

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Label(turn.transcript.text, systemImage: "mic.fill")
                .font(.callout)
            Label(turn.responseText, systemImage: "waveform")
                .font(.callout)
                .foregroundStyle(.secondary)
        }
        .padding(.vertical, 4)
    }
}

#Preview {
    VoiceView(container: .preview, workspaceId: "mock-ws-rcs")
        .frame(width: 500, height: 500)
}
