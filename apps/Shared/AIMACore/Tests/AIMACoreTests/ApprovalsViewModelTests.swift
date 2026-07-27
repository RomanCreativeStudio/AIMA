import XCTest
@testable import AIMACore

@MainActor
final class ApprovalsViewModelTests: XCTestCase {
    func testLoadDefaultsToPendingApprovals() async {
        let apiClient = MockAPIClient()
        let viewModel = ApprovalsViewModel(apiClient: apiClient, workspaceId: "mock-ws-rcs")

        await viewModel.load()

        XCTAssertEqual(viewModel.approvals.count, 1)
        XCTAssertEqual(viewModel.approvals.first?.status, .pending)
        XCTAssertNil(viewModel.errorMessage)
    }

    func testSetStatusFilterReloadsWithTheNewFilter() async {
        let apiClient = MockAPIClient()
        let viewModel = ApprovalsViewModel(apiClient: apiClient, workspaceId: "mock-ws-rcs")
        await viewModel.load()

        await viewModel.setStatusFilter(.approved)

        XCTAssertTrue(viewModel.approvals.isEmpty, "the seeded mock approval is pending, not approved")
    }

    func testSelectApprovalFetchesTheFullDetailRecord() async {
        let apiClient = MockAPIClient()
        let viewModel = ApprovalsViewModel(apiClient: apiClient, workspaceId: "mock-ws-rcs")
        await viewModel.load()
        let approval = try! XCTUnwrap(viewModel.approvals.first)

        await viewModel.selectApproval(approval)

        XCTAssertEqual(viewModel.selectedApproval?.id, approval.id)
    }

    func testApproveRemovesItFromTheListAndClearsSelection() async {
        let apiClient = MockAPIClient()
        let viewModel = ApprovalsViewModel(apiClient: apiClient, workspaceId: "mock-ws-rcs")
        await viewModel.load()
        let approval = try! XCTUnwrap(viewModel.approvals.first)
        await viewModel.selectApproval(approval)

        await viewModel.approve(approval)

        XCTAssertTrue(viewModel.approvals.isEmpty)
        XCTAssertNil(viewModel.selectedApproval)
    }

    func testRejectRemovesItFromTheListAndClearsSelection() async {
        let apiClient = MockAPIClient()
        let viewModel = ApprovalsViewModel(apiClient: apiClient, workspaceId: "mock-ws-rcs")
        await viewModel.load()
        let approval = try! XCTUnwrap(viewModel.approvals.first)
        await viewModel.selectApproval(approval)

        await viewModel.reject(approval)

        XCTAssertTrue(viewModel.approvals.isEmpty)
        XCTAssertNil(viewModel.selectedApproval)
    }

    func testLoadSurfacesAPIErrorsAsUserFacingMessages() async {
        let apiClient = MockAPIClient()
        await apiClient.setShouldFail(true)
        let viewModel = ApprovalsViewModel(apiClient: apiClient, workspaceId: "mock-ws-rcs")

        await viewModel.load()

        XCTAssertNotNil(viewModel.errorMessage)
        XCTAssertTrue(viewModel.approvals.isEmpty)
    }
}
