import XCTest
@testable import AIMACore

@MainActor
final class ChatViewModelTests: XCTestCase {
    func testLoadConversationsSelectsTheFirstConversationAndLoadsItsMessages() async {
        let apiClient = MockAPIClient()
        let viewModel = ChatViewModel(apiClient: apiClient, workspaceId: "mock-ws-rcs")

        await viewModel.loadConversations()

        XCTAssertEqual(viewModel.conversations.count, 1)
        XCTAssertEqual(viewModel.selectedConversationId, "mock-conv-1")
        XCTAssertEqual(viewModel.messages.count, 2)
    }

    func testStartNewConversationInsertsAndSelectsIt() async {
        let apiClient = MockAPIClient()
        let viewModel = ChatViewModel(apiClient: apiClient, workspaceId: "mock-ws-rcs")
        await viewModel.loadConversations()

        await viewModel.startNewConversation(title: "New thread")

        XCTAssertEqual(viewModel.conversations.count, 2)
        XCTAssertEqual(viewModel.conversations.first?.title, "New thread")
        XCTAssertEqual(viewModel.selectedConversationId, viewModel.conversations.first?.id)
        XCTAssertTrue(viewModel.messages.isEmpty, "a brand-new conversation has no messages yet")
    }

    func testSendDraftMessageAppendsBothMessagesAndClearsTheDraft() async {
        let apiClient = MockAPIClient()
        let viewModel = ChatViewModel(apiClient: apiClient, workspaceId: "mock-ws-rcs")
        await viewModel.loadConversations()
        let messageCountBefore = viewModel.messages.count

        viewModel.draftMessage = "What's next for Acme?"
        await viewModel.sendDraftMessage()

        XCTAssertEqual(viewModel.messages.count, messageCountBefore + 2)
        XCTAssertEqual(viewModel.messages.last?.role, .assistant)
        XCTAssertEqual(viewModel.draftMessage, "")
        XCTAssertNotNil(viewModel.lastIntent)
        XCTAssertNotNil(viewModel.lastApprovalDecision)
        XCTAssertFalse(viewModel.isSending)
    }

    func testSendDraftMessageIgnoresWhitespaceOnlyInput() async {
        let apiClient = MockAPIClient()
        let viewModel = ChatViewModel(apiClient: apiClient, workspaceId: "mock-ws-rcs")
        await viewModel.loadConversations()
        let messageCountBefore = viewModel.messages.count

        viewModel.draftMessage = "   \n  "
        await viewModel.sendDraftMessage()

        XCTAssertEqual(viewModel.messages.count, messageCountBefore, "whitespace-only input should never be sent")
    }

    func testSendDraftMessageDoesNothingWithoutASelectedConversation() async {
        let apiClient = MockAPIClient()
        let viewModel = ChatViewModel(apiClient: apiClient, workspaceId: "mock-ws-rcs")
        // Deliberately skip loadConversations(), so nothing is selected yet.

        viewModel.draftMessage = "hello"
        await viewModel.sendDraftMessage()

        XCTAssertTrue(viewModel.messages.isEmpty)
        XCTAssertEqual(viewModel.draftMessage, "hello", "the draft is preserved since nothing was sent")
    }

    func testSendDraftMessageFetchesTheFullPendingApprovalWhenOneIsRequired() async {
        let apiClient = MockAPIClient()
        let viewModel = ChatViewModel(apiClient: apiClient, workspaceId: "mock-ws-rcs")
        await viewModel.loadConversations()
        _ = await apiClient.forceNextMessageToRequireApproval(workspaceId: "mock-ws-rcs", actionType: "send_email")

        viewModel.draftMessage = "Draft the client reply"
        await viewModel.sendDraftMessage()

        XCTAssertEqual(viewModel.lastApprovalDecision?.state, "pending")
        XCTAssertNotNil(viewModel.lastPendingApproval)
        XCTAssertEqual(viewModel.lastPendingApproval?.actionType, "send_email")
    }

    func testApproveLastApprovalResolvesTheCardAndClearsIt() async {
        let apiClient = MockAPIClient()
        let viewModel = ChatViewModel(apiClient: apiClient, workspaceId: "mock-ws-rcs")
        await viewModel.loadConversations()
        _ = await apiClient.forceNextMessageToRequireApproval(workspaceId: "mock-ws-rcs", actionType: "send_email")
        viewModel.draftMessage = "Draft the client reply"
        await viewModel.sendDraftMessage()

        await viewModel.approveLastApproval()

        XCTAssertNil(viewModel.lastPendingApproval)
        XCTAssertEqual(viewModel.lastApprovalDecision?.state, "approved")
    }

    func testRejectLastApprovalResolvesTheCardAndClearsIt() async {
        let apiClient = MockAPIClient()
        let viewModel = ChatViewModel(apiClient: apiClient, workspaceId: "mock-ws-rcs")
        await viewModel.loadConversations()
        _ = await apiClient.forceNextMessageToRequireApproval(workspaceId: "mock-ws-rcs", actionType: "send_email")
        viewModel.draftMessage = "Draft the client reply"
        await viewModel.sendDraftMessage()

        await viewModel.rejectLastApproval()

        XCTAssertNil(viewModel.lastPendingApproval)
        XCTAssertEqual(viewModel.lastApprovalDecision?.state, "rejected")
    }

    func testSelectingAConversationClearsStaleIntentAndApprovalState() async {
        let apiClient = MockAPIClient()
        let viewModel = ChatViewModel(apiClient: apiClient, workspaceId: "mock-ws-rcs")
        await viewModel.loadConversations()
        await viewModel.startNewConversation(title: "Second thread")
        _ = await apiClient.forceNextMessageToRequireApproval(workspaceId: "mock-ws-rcs", actionType: "send_email")
        viewModel.draftMessage = "Draft the client reply"
        await viewModel.sendDraftMessage()
        XCTAssertNotNil(viewModel.lastPendingApproval, "sanity check: the card exists before switching")

        await viewModel.selectConversation(viewModel.conversations.last!.id)

        XCTAssertNil(viewModel.lastIntent)
        XCTAssertNil(viewModel.lastApprovalDecision)
        XCTAssertNil(viewModel.lastPendingApproval)
    }

    func testSendDraftMessageSurfacesAForcedWorkflowSuggestion() async {
        let apiClient = MockAPIClient()
        let viewModel = ChatViewModel(apiClient: apiClient, workspaceId: "mock-ws-rcs")
        await viewModel.loadConversations()
        let suggestion = WorkflowSuggestion(
            workflowKey: .dailyWorkspaceBriefing, displayName: "Daily Workspace Briefing",
            description: "Gather a snapshot.", confidence: 0.8,
            steps: [WorkflowStepDefinition(key: "gather_snapshot", displayName: "Gather workspace snapshot", capability: nil)],
            extractedInput: [:]
        )
        await apiClient.forceNextMessageToSuggestWorkflow(suggestion)

        viewModel.draftMessage = "Give me my daily briefing"
        await viewModel.sendDraftMessage()

        XCTAssertEqual(viewModel.lastWorkflowSuggestion?.workflowKey, .dailyWorkspaceBriefing)
    }

    func testWorkflowSuggestionDoesNotPersistPastTheNextOrdinaryMessage() async {
        let apiClient = MockAPIClient()
        let viewModel = ChatViewModel(apiClient: apiClient, workspaceId: "mock-ws-rcs")
        await viewModel.loadConversations()
        let suggestion = WorkflowSuggestion(
            workflowKey: .draftEmailReply, displayName: "Draft Email Reply",
            description: "Compose a reply.", confidence: 0.6, steps: [], extractedInput: [:]
        )
        await apiClient.forceNextMessageToSuggestWorkflow(suggestion)
        viewModel.draftMessage = "reply to Acme"
        await viewModel.sendDraftMessage()
        precondition(viewModel.lastWorkflowSuggestion != nil, "sanity check: the suggestion exists before the next message")

        viewModel.draftMessage = "thanks"
        await viewModel.sendDraftMessage()

        XCTAssertNil(viewModel.lastWorkflowSuggestion, "an ordinary follow-up message must not keep a stale suggestion around")
    }

    func testSendDraftMessageSurfacesAForcedExecutionSuggestion() async {
        let apiClient = MockAPIClient()
        let viewModel = ChatViewModel(apiClient: apiClient, workspaceId: "mock-ws-rcs")
        await viewModel.loadConversations()
        let suggestion = ExecutionSuggestion(
            actionType: "send_email", provider: .gmail, confidence: 0.8,
            extractedPayload: ["to": .string("client@example.com")]
        )
        await apiClient.forceNextMessageToSuggestExecution(suggestion)

        viewModel.draftMessage = "send an email to the client"
        await viewModel.sendDraftMessage()

        XCTAssertEqual(viewModel.lastExecutionSuggestion?.actionType, "send_email")
    }

    func testExecutionSuggestionDoesNotPersistPastTheNextOrdinaryMessage() async {
        let apiClient = MockAPIClient()
        let viewModel = ChatViewModel(apiClient: apiClient, workspaceId: "mock-ws-rcs")
        await viewModel.loadConversations()
        let suggestion = ExecutionSuggestion(actionType: "send_email", provider: .gmail, confidence: 0.6, extractedPayload: [:])
        await apiClient.forceNextMessageToSuggestExecution(suggestion)
        viewModel.draftMessage = "send an email"
        await viewModel.sendDraftMessage()
        precondition(viewModel.lastExecutionSuggestion != nil, "sanity check: the suggestion exists before the next message")

        viewModel.draftMessage = "thanks"
        await viewModel.sendDraftMessage()

        XCTAssertNil(viewModel.lastExecutionSuggestion, "an ordinary follow-up message must not keep a stale suggestion around")
    }

    func testSendDraftMessageSurfacesForcedActionSuggestions() async {
        let apiClient = MockAPIClient()
        let viewModel = ChatViewModel(apiClient: apiClient, workspaceId: "mock-ws-rcs")
        await viewModel.loadConversations()
        let suggestion = ActionSuggestion(content: "Follow up on the Acme contract", category: .followUp, confidence: 0.8, reason: "test")
        await apiClient.forceNextMessageToSuggestActions([suggestion])

        viewModel.draftMessage = "follow up on the Acme contract"
        await viewModel.sendDraftMessage()

        XCTAssertEqual(viewModel.lastActionSuggestions, [suggestion])
    }

    func testActionSuggestionsDoNotPersistPastTheNextOrdinaryMessage() async {
        let apiClient = MockAPIClient()
        let viewModel = ChatViewModel(apiClient: apiClient, workspaceId: "mock-ws-rcs")
        await viewModel.loadConversations()
        let suggestion = ActionSuggestion(content: "I need to email the client", category: .todo, confidence: 0.7, reason: "test")
        await apiClient.forceNextMessageToSuggestActions([suggestion])
        viewModel.draftMessage = "I need to email the client"
        await viewModel.sendDraftMessage()
        precondition(!viewModel.lastActionSuggestions.isEmpty, "sanity check: the suggestion exists before the next message")

        viewModel.draftMessage = "thanks"
        await viewModel.sendDraftMessage()

        XCTAssertTrue(viewModel.lastActionSuggestions.isEmpty, "an ordinary follow-up message must not keep stale suggestions around")
    }

    func testAcceptActionSuggestionCreatesATaskAndRemovesTheSuggestion() async {
        let apiClient = MockAPIClient()
        let viewModel = ChatViewModel(apiClient: apiClient, workspaceId: "mock-ws-rcs")
        await viewModel.loadConversations()
        let suggestion = ActionSuggestion(content: "Follow up on the Acme contract", category: .followUp, confidence: 0.8, reason: "test")
        await apiClient.forceNextMessageToSuggestActions([suggestion])
        viewModel.draftMessage = "follow up on the Acme contract"
        await viewModel.sendDraftMessage()

        await viewModel.acceptActionSuggestion(suggestion)

        XCTAssertTrue(viewModel.lastActionSuggestions.isEmpty, "accepting removes the card")
        let tasks = try! await apiClient.listTasks(workspaceId: "mock-ws-rcs", status: nil)
        let accepted = tasks.first { $0.title == "Follow up on the Acme contract" }
        XCTAssertEqual(accepted?.source, "conversation_suggestion")
    }

    func testDismissActionSuggestionRemovesItWithoutCreatingATask() async {
        let apiClient = MockAPIClient()
        let viewModel = ChatViewModel(apiClient: apiClient, workspaceId: "mock-ws-rcs")
        await viewModel.loadConversations()
        let suggestion = ActionSuggestion(content: "Let's schedule a meeting", category: .meeting, confidence: 0.7, reason: "test")
        await apiClient.forceNextMessageToSuggestActions([suggestion])
        viewModel.draftMessage = "Let's schedule a meeting"
        await viewModel.sendDraftMessage()
        let tasksBefore = try! await apiClient.listTasks(workspaceId: "mock-ws-rcs", status: nil)

        viewModel.dismissActionSuggestion(suggestion)

        XCTAssertTrue(viewModel.lastActionSuggestions.isEmpty)
        let tasksAfter = try! await apiClient.listTasks(workspaceId: "mock-ws-rcs", status: nil)
        XCTAssertEqual(tasksBefore.count, tasksAfter.count, "dismiss must never persist anything")
    }

    func testSelectingAConversationClearsStaleExecutionSuggestion() async {
        let apiClient = MockAPIClient()
        let viewModel = ChatViewModel(apiClient: apiClient, workspaceId: "mock-ws-rcs")
        await viewModel.loadConversations()
        await viewModel.startNewConversation(title: "Second thread")
        let suggestion = ExecutionSuggestion(actionType: "send_email", provider: .gmail, confidence: 0.8, extractedPayload: [:])
        await apiClient.forceNextMessageToSuggestExecution(suggestion)
        viewModel.draftMessage = "send an email"
        await viewModel.sendDraftMessage()
        XCTAssertNotNil(viewModel.lastExecutionSuggestion, "sanity check: the suggestion exists before switching")

        await viewModel.selectConversation(viewModel.conversations.last!.id)

        XCTAssertNil(viewModel.lastExecutionSuggestion)
    }

    func testLoadConversationIntelligencePopulatesSummaryFollowUpsAndRelatedMemories() async {
        let apiClient = MockAPIClient()
        let viewModel = ChatViewModel(apiClient: apiClient, workspaceId: "mock-ws-rcs")
        await viewModel.loadConversations()
        XCTAssertNil(viewModel.conversationIntelligence, "sanity check: nothing loaded yet")

        await viewModel.loadConversationIntelligence()

        let intelligence = try! XCTUnwrap(viewModel.conversationIntelligence)
        XCTAssertFalse(intelligence.summary.isEmpty)
        XCTAssertEqual(intelligence.suggestedFollowUps.count, 3)
        XCTAssertEqual(intelligence.recentContext.count, 2, "the two seeded messages")
        XCTAssertEqual(intelligence.relatedMemories.count, 1)
        XCTAssertFalse(viewModel.isLoadingIntelligence)
        XCTAssertNil(viewModel.errorMessage)
    }

    func testLoadWorkspaceSuggestionsPopulatesAdvisoryRecommendations() async {
        let apiClient = MockAPIClient()
        let viewModel = ChatViewModel(apiClient: apiClient, workspaceId: "mock-ws-rcs")
        XCTAssertTrue(viewModel.workspaceSuggestions.isEmpty, "sanity check: nothing loaded yet")

        await viewModel.loadWorkspaceSuggestions()

        XCTAssertFalse(viewModel.workspaceSuggestions.isEmpty)
        XCTAssertFalse(viewModel.isLoadingSuggestions)
        XCTAssertNil(viewModel.errorMessage)
    }

    func testLoadConversationIntelligenceDoesNothingWithoutASelectedConversation() async {
        let apiClient = MockAPIClient()
        let viewModel = ChatViewModel(apiClient: apiClient, workspaceId: "mock-ws-rcs")
        // Deliberately skip loadConversations(), so nothing is selected yet.

        await viewModel.loadConversationIntelligence()

        XCTAssertNil(viewModel.conversationIntelligence)
    }

    func testSelectingAConversationClearsStaleConversationIntelligence() async {
        let apiClient = MockAPIClient()
        let viewModel = ChatViewModel(apiClient: apiClient, workspaceId: "mock-ws-rcs")
        await viewModel.loadConversations()
        await viewModel.startNewConversation(title: "Second thread")
        await viewModel.selectConversation(viewModel.conversations.last!.id)
        await viewModel.loadConversationIntelligence()
        XCTAssertNotNil(viewModel.conversationIntelligence, "sanity check: exists before switching")

        await viewModel.selectConversation(viewModel.conversations.first!.id)

        XCTAssertNil(viewModel.conversationIntelligence)
    }

    func testSelectingAConversationClearsStaleWorkflowSuggestion() async {
        let apiClient = MockAPIClient()
        let viewModel = ChatViewModel(apiClient: apiClient, workspaceId: "mock-ws-rcs")
        await viewModel.loadConversations()
        await viewModel.startNewConversation(title: "Second thread")
        let suggestion = WorkflowSuggestion(
            workflowKey: .dailyWorkspaceBriefing, displayName: "Daily Workspace Briefing",
            description: "Gather a snapshot.", confidence: 0.8, steps: [], extractedInput: [:]
        )
        await apiClient.forceNextMessageToSuggestWorkflow(suggestion)
        viewModel.draftMessage = "daily briefing"
        await viewModel.sendDraftMessage()
        XCTAssertNotNil(viewModel.lastWorkflowSuggestion, "sanity check: the suggestion exists before switching")

        await viewModel.selectConversation(viewModel.conversations.last!.id)

        XCTAssertNil(viewModel.lastWorkflowSuggestion)
    }

    func testSendingAMessageMovesItsConversationToTheTopOfTheList() async {
        let apiClient = MockAPIClient()
        let viewModel = ChatViewModel(apiClient: apiClient, workspaceId: "mock-ws-rcs")
        await viewModel.loadConversations()
        await viewModel.startNewConversation(title: "Second thread")
        let originalConversationId = viewModel.conversations.last!.id

        await viewModel.selectConversation(originalConversationId)
        viewModel.draftMessage = "back to the first thread"
        await viewModel.sendDraftMessage()

        XCTAssertEqual(viewModel.conversations.first?.id, originalConversationId)
    }

    func testSendDraftMessageSurfacesRetrievedContext() async {
        let apiClient = MockAPIClient()
        let viewModel = ChatViewModel(apiClient: apiClient, workspaceId: "mock-ws-rcs")
        await viewModel.loadConversations()

        viewModel.draftMessage = "Can we schedule a call with the client?"
        await viewModel.sendDraftMessage()

        XCTAssertNotNil(viewModel.lastRetrievedContext)
        XCTAssertFalse(viewModel.lastRetrievedContext?.memories.isEmpty ?? true)
    }

    // MARK: - Workspace scoping (Assistant Core Experience sprint)

    func testConversationsAreScopedToTheirOwnWorkspace() async {
        let apiClient = MockAPIClient()
        let rcsViewModel = ChatViewModel(apiClient: apiClient, workspaceId: "mock-ws-rcs")
        await rcsViewModel.loadConversations()
        XCTAssertFalse(rcsViewModel.conversations.isEmpty, "sanity check: mock-ws-rcs has a seeded conversation")

        let otherViewModel = ChatViewModel(apiClient: apiClient, workspaceId: "mock-ws-personal")
        await otherViewModel.loadConversations()

        XCTAssertTrue(otherViewModel.conversations.isEmpty, "a conversation seeded for one workspace must never appear in another's list")
        XCTAssertNil(otherViewModel.selectedConversationId)
        XCTAssertTrue(otherViewModel.messages.isEmpty)
    }

    func testStartNewConversationInOneWorkspaceDoesNotAppearInAnothers() async {
        let apiClient = MockAPIClient()
        let rcsViewModel = ChatViewModel(apiClient: apiClient, workspaceId: "mock-ws-rcs")
        await rcsViewModel.startNewConversation(title: "RCS-only thread")

        let otherViewModel = ChatViewModel(apiClient: apiClient, workspaceId: "mock-ws-development")
        await otherViewModel.loadConversations()

        XCTAssertFalse(otherViewModel.conversations.contains { $0.title == "RCS-only thread" })
    }

    // MARK: - Error handling (Assistant Core Experience sprint)

    func testLoadConversationsSurfacesAPIErrorsAsUserFacingMessages() async {
        let apiClient = MockAPIClient()
        await apiClient.setShouldFail(true)
        let viewModel = ChatViewModel(apiClient: apiClient, workspaceId: "mock-ws-rcs")

        await viewModel.loadConversations()

        XCTAssertNotNil(viewModel.errorMessage)
        XCTAssertTrue(viewModel.conversations.isEmpty)
        XCTAssertFalse(viewModel.isLoadingConversations)
    }

    func testSendDraftMessageSurfacesAPIErrorsAndPreservesTheDraft() async {
        let apiClient = MockAPIClient()
        let viewModel = ChatViewModel(apiClient: apiClient, workspaceId: "mock-ws-rcs")
        await viewModel.loadConversations()
        await apiClient.setShouldFail(true)

        viewModel.draftMessage = "this should fail"
        await viewModel.sendDraftMessage()

        XCTAssertNotNil(viewModel.errorMessage)
        XCTAssertEqual(viewModel.draftMessage, "this should fail", "a failed send must not silently discard what the user typed")
        XCTAssertFalse(viewModel.isSending)
    }

    func testSelectingAConversationSurfacesAPIErrorsAsUserFacingMessages() async {
        let apiClient = MockAPIClient()
        let viewModel = ChatViewModel(apiClient: apiClient, workspaceId: "mock-ws-rcs")
        await viewModel.loadConversations()
        let conversationId = viewModel.conversations.first!.id
        await apiClient.setShouldFail(true)

        await viewModel.selectConversation(conversationId)

        XCTAssertNotNil(viewModel.errorMessage)
    }

    func testSelectingAConversationClearsStaleRetrievedContext() async {
        let apiClient = MockAPIClient()
        let viewModel = ChatViewModel(apiClient: apiClient, workspaceId: "mock-ws-rcs")
        await viewModel.loadConversations()
        await viewModel.startNewConversation(title: "Second thread")
        viewModel.draftMessage = "Can we schedule a call with the client?"
        await viewModel.sendDraftMessage()
        XCTAssertNotNil(viewModel.lastRetrievedContext, "sanity check: context exists before switching")

        await viewModel.selectConversation(viewModel.conversations.last!.id)

        XCTAssertNil(viewModel.lastRetrievedContext)
    }
}
