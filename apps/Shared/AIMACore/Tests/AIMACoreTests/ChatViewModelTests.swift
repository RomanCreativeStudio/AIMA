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
}
