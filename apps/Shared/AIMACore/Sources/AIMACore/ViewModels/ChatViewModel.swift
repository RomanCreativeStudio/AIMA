import Foundation
import Observation

/// Backs the Chat screen (Phase 2.1, item 2): conversation list, message
/// history for the selected conversation, and sending a new message.
/// Scoped to one workspace at a time — switching workspaces means
/// constructing (or reloading) a `ChatViewModel` for the new workspace,
/// the same isolation boundary the backend enforces server-side. Uses
/// `@Observable` (not Combine's `ObservableObject`) so this package stays
/// Linux-buildable — see `Package.swift`.
@MainActor
@Observable
public final class ChatViewModel {
    public private(set) var conversations: [Conversation] = []
    public private(set) var selectedConversationId: String?
    public private(set) var messages: [Message] = []
    public var draftMessage: String = ""
    public private(set) var isLoadingConversations = false
    public private(set) var isSending = false
    public private(set) var errorMessage: String?
    public private(set) var lastIntent: IntentAnalysis?
    public private(set) var lastApprovalDecision: ApprovalDecision?

    private let apiClient: APIClient
    private let workspaceId: String

    public init(apiClient: APIClient, workspaceId: String) {
        self.apiClient = apiClient
        self.workspaceId = workspaceId
    }

    public func loadConversations() async {
        isLoadingConversations = true
        errorMessage = nil
        defer { isLoadingConversations = false }

        do {
            conversations = try await apiClient.listConversations(workspaceId: workspaceId)
            if selectedConversationId == nil, let first = conversations.first {
                await selectConversation(first.id)
            }
        } catch let error as APIError {
            errorMessage = error.userMessage
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    public func startNewConversation(title: String? = nil) async {
        do {
            let conversation = try await apiClient.createConversation(workspaceId: workspaceId, title: title)
            conversations.insert(conversation, at: 0)
            await selectConversation(conversation.id)
        } catch let error as APIError {
            errorMessage = error.userMessage
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    public func selectConversation(_ conversationId: String) async {
        selectedConversationId = conversationId
        errorMessage = nil
        do {
            messages = try await apiClient.listMessages(workspaceId: workspaceId, conversationId: conversationId, limit: nil)
        } catch let error as APIError {
            errorMessage = error.userMessage
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    public func sendDraftMessage() async {
        let content = draftMessage.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !content.isEmpty, let conversationId = selectedConversationId, !isSending else { return }

        isSending = true
        errorMessage = nil
        defer { isSending = false }

        do {
            let result = try await apiClient.sendMessage(workspaceId: workspaceId, conversationId: conversationId, content: content)
            messages.append(contentsOf: [result.userMessage, result.assistantMessage])
            lastIntent = result.intent
            lastApprovalDecision = result.approvalDecision
            draftMessage = ""

            // A reply is the same "recently active" signal the backend
            // uses to reorder its own list — move this conversation to the
            // top locally rather than re-fetching the whole list.
            if let index = conversations.firstIndex(where: { $0.id == conversationId }) {
                let conversation = conversations.remove(at: index)
                conversations.insert(conversation, at: 0)
            }
        } catch let error as APIError {
            errorMessage = error.userMessage
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
