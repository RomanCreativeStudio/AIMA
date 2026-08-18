import Foundation

/// Mirrors `backend/src/voice/types.ts#VoiceSessionStatus` (Phase 3.2).
public enum VoiceSessionStatus: String, Codable, Sendable {
    case active
    case ended
}

/// Mirrors `backend/src/voice/types.ts#VoiceSession` — a voice session is a
/// thin wrapper around a real, listable conversation (`conversationId`),
/// never a parallel history. Starting or ending one always requires an
/// explicit client call; there is no background or automatic session.
public struct VoiceSession: Codable, Identifiable, Equatable, Sendable {
    public let id: String
    public let workspaceId: String
    public let conversationId: String
    public let status: VoiceSessionStatus
    public let startedAt: String
    public let endedAt: String?
    public let createdAt: String
    public let updatedAt: String

    public init(
        id: String,
        workspaceId: String,
        conversationId: String,
        status: VoiceSessionStatus,
        startedAt: String,
        endedAt: String?,
        createdAt: String,
        updatedAt: String
    ) {
        self.id = id
        self.workspaceId = workspaceId
        self.conversationId = conversationId
        self.status = status
        self.startedAt = startedAt
        self.endedAt = endedAt
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }

    public var isActive: Bool { status == .active }
}

/// Mirrors `backend/src/voice/types.ts#Transcript`.
public struct Transcript: Codable, Equatable, Sendable {
    public let text: String
    public let confidence: Double?

    public init(text: String, confidence: Double?) {
        self.text = text
        self.confidence = confidence
    }
}

/// Mirrors `backend/src/voice/types.ts#VoiceTurn` — one persisted turn
/// (transcript in, response text out). No audio is ever persisted here by
/// design (Phase 3.2 security requirement).
public struct VoiceTurn: Codable, Identifiable, Equatable, Sendable {
    public let id: String
    public let voiceSessionId: String
    public let workspaceId: String
    public let transcript: Transcript
    public let responseText: String
    public let createdAt: String

    public init(
        id: String,
        voiceSessionId: String,
        workspaceId: String,
        transcript: Transcript,
        responseText: String,
        createdAt: String
    ) {
        self.id = id
        self.voiceSessionId = voiceSessionId
        self.workspaceId = workspaceId
        self.transcript = transcript
        self.responseText = responseText
        self.createdAt = createdAt
    }
}

/// Per-request speech synthesis preferences (Phase 3.2) — mirrors
/// `backend/src/voice/types.ts#VoiceConfiguration`. Forwarded to the
/// backend's `TextToSpeechProvider`, never persisted.
public struct VoiceConfiguration: Codable, Equatable, Sendable {
    public var voice: String?
    public var speakingRate: Double?

    public init(voice: String? = nil, speakingRate: Double? = nil) {
        self.voice = voice
        self.speakingRate = speakingRate
    }
}

/// Mirrors the JSON shape returned by `POST .../voice/sessions/:id/turns` —
/// audio travels as base64, decoded client-side for local playback.
public struct VoiceResponse: Codable, Sendable {
    public let turn: VoiceTurn
    public let audioBase64: String
    public let audioMimeType: String
    public let intent: IntentAnalysis
    public let approvalDecision: ApprovalDecision
    public let workflowSuggestion: WorkflowSuggestion?
    public let executionSuggestion: ExecutionSuggestion?

    public init(
        turn: VoiceTurn,
        audioBase64: String,
        audioMimeType: String,
        intent: IntentAnalysis,
        approvalDecision: ApprovalDecision,
        workflowSuggestion: WorkflowSuggestion?,
        executionSuggestion: ExecutionSuggestion?
    ) {
        self.turn = turn
        self.audioBase64 = audioBase64
        self.audioMimeType = audioMimeType
        self.intent = intent
        self.approvalDecision = approvalDecision
        self.workflowSuggestion = workflowSuggestion
        self.executionSuggestion = executionSuggestion
    }

    /// Decoded audio bytes, ready for local playback. `nil` if the base64 payload is malformed.
    public var audioData: Data? { Data(base64Encoded: audioBase64) }
}

/// Mirrors the body of `POST .../voice/sessions/:id/turns`.
public struct SubmitVoiceRequest: Encodable, Sendable {
    public var audioBase64: String
    public var audioMimeType: String
    public var configuration: VoiceConfiguration?

    public init(audioBase64: String, audioMimeType: String, configuration: VoiceConfiguration?) {
        self.audioBase64 = audioBase64
        self.audioMimeType = audioMimeType
        self.configuration = configuration
    }
}
