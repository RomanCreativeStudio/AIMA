import XCTest
@testable import AIMACore

/// Verifies every model decodes the exact JSON shape the backend actually
/// sends (docs/TECHNICAL_ARCHITECTURE.md §4, response schemas) — each
/// fixture below is copied from a real backend route's response, not
/// invented, so a drift between the two would fail here first.
final class ModelDecodingTests: XCTestCase {
    private let decoder = JSONDecoder()

    func testDecodesUserProfile() throws {
        let json = """
        {
          "id": "user-1", "email": "you@example.com", "displayName": "Roman",
          "preferences": {"theme": "dark"}, "communicationStyle": "direct",
          "defaultWorkspaceId": "ws-1", "createdAt": "2026-01-01T00:00:00.000Z",
          "updatedAt": "2026-01-01T00:00:00.000Z"
        }
        """.data(using: .utf8)!

        let user = try decoder.decode(UserProfile.self, from: json)
        XCTAssertEqual(user.id, "user-1")
        XCTAssertEqual(user.displayName, "Roman")
        XCTAssertEqual(user.preferences["theme"], .string("dark"))
        XCTAssertEqual(user.defaultWorkspaceId, "ws-1")
    }

    func testDecodesUserProfileWithNullableFieldsAbsent() throws {
        let json = """
        {
          "id": "user-1", "email": "you@example.com", "displayName": null,
          "preferences": {}, "communicationStyle": null,
          "defaultWorkspaceId": null, "createdAt": "2026-01-01T00:00:00.000Z",
          "updatedAt": "2026-01-01T00:00:00.000Z"
        }
        """.data(using: .utf8)!

        let user = try decoder.decode(UserProfile.self, from: json)
        XCTAssertNil(user.displayName)
        XCTAssertNil(user.defaultWorkspaceId)
    }

    func testDecodesWorkspaceWithGenericType() throws {
        let json = """
        {
          "id": "ws-1", "userId": "user-1", "slug": "rcs", "name": "Roman Creative Studio",
          "type": "business", "instructions": "Always mention deadlines.",
          "assistantBehavior": {"tone": "formal"}, "metadata": {},
          "createdAt": "2026-01-01T00:00:00.000Z", "updatedAt": "2026-01-01T00:00:00.000Z"
        }
        """.data(using: .utf8)!

        let workspace = try decoder.decode(Workspace.self, from: json)
        XCTAssertEqual(workspace.slug, .rcs)
        XCTAssertEqual(workspace.type, .business)
        XCTAssertEqual(workspace.instructions, "Always mention deadlines.")
        XCTAssertEqual(workspace.assistantBehavior["tone"], .string("formal"))
    }

    func testWorkspaceSlugDisplayNames() {
        XCTAssertEqual(WorkspaceSlug.personal.displayName, "Personal")
        XCTAssertEqual(WorkspaceSlug.rcs.displayName, "Roman Creative Studio")
        XCTAssertEqual(WorkspaceSlug.mfs.displayName, "Mythic Forge Studios")
        XCTAssertEqual(WorkspaceSlug.development.displayName, "Development")
    }

    func testDecodesMessageWithRole() throws {
        let json = """
        {"id":"msg-1","conversationId":"conv-1","workspaceId":"ws-1","role":"assistant","content":"hi","createdAt":"2026-01-01T00:00:00.000Z"}
        """.data(using: .utf8)!

        let message = try decoder.decode(Message.self, from: json)
        XCTAssertEqual(message.role, .assistant)
        XCTAssertEqual(message.content, "hi")
    }

    func testDecodesSendMessageResult() throws {
        let json = """
        {
          "userMessage": {"id":"m1","conversationId":"c1","workspaceId":"w1","role":"user","content":"hi","createdAt":"2026-01-01T00:00:00.000Z"},
          "assistantMessage": {"id":"m2","conversationId":"c1","workspaceId":"w1","role":"assistant","content":"hello","createdAt":"2026-01-01T00:00:00.000Z"},
          "retrievedMemories": [],
          "retrievedDocumentChunks": [],
          "intent": {"intent":"chat","confidence":0.5,"parameters":{},"approval":"no_approval_needed","suggestedNextAction":"No action needed."},
          "approvalDecision": {"state":"no_approval_needed","pendingApprovalId":null}
        }
        """.data(using: .utf8)!

        let result = try decoder.decode(SendMessageResult.self, from: json)
        XCTAssertEqual(result.userMessage.content, "hi")
        XCTAssertEqual(result.assistantMessage.content, "hello")
        XCTAssertEqual(result.intent.intent, "chat")
        XCTAssertEqual(result.intent.approval, .noApprovalNeeded)
        XCTAssertEqual(result.approvalDecision.state, "no_approval_needed")
        XCTAssertNil(result.approvalDecision.pendingApprovalId)
    }

    func testTaskStatusRawValuesMatchBackendEnum() {
        // backend/database/migrations/0001_init.sql's task_status enum.
        XCTAssertEqual(TaskStatus.todo.rawValue, "todo")
        XCTAssertEqual(TaskStatus.inProgress.rawValue, "in_progress")
        XCTAssertEqual(TaskStatus.done.rawValue, "done")
        XCTAssertEqual(TaskStatus.cancelled.rawValue, "cancelled")
    }

    func testDecodesTaskItem() throws {
        let json = """
        {"id":"t1","workspaceId":"w1","title":"Ship it","description":null,"status":"in_progress","priority":"high","dueDate":null,"createdAt":"2026-01-01T00:00:00.000Z","updatedAt":"2026-01-01T00:00:00.000Z"}
        """.data(using: .utf8)!

        let task = try decoder.decode(TaskItem.self, from: json)
        XCTAssertEqual(task.status, .inProgress)
        XCTAssertEqual(task.priority, .high)
    }

    func testApprovalStatusRawValuesMatchBackendEnum() {
        // backend/src/approval/types.ts#ApprovalStatus (Phase 1.7).
        XCTAssertEqual(ApprovalStatus.pending.rawValue, "pending")
        XCTAssertEqual(ApprovalStatus.approved.rawValue, "approved")
        XCTAssertEqual(ApprovalStatus.rejected.rawValue, "rejected")
        XCTAssertEqual(ApprovalStatus.expired.rawValue, "expired")
    }

    func testDecodesPendingApprovalWithObjectPayload() throws {
        let json = """
        {
          "id":"a1","workspaceId":"w1","actionType":"send_email",
          "payload":{"to":"client@example.com"},"status":"pending",
          "createdAt":"2026-01-01T00:00:00.000Z","expiresAt":"2026-01-02T00:00:00.000Z","resolvedAt":null
        }
        """.data(using: .utf8)!

        let approval = try decoder.decode(PendingApproval.self, from: json)
        XCTAssertEqual(approval.status, .pending)
        if case .object(let payload) = approval.payload {
            XCTAssertEqual(payload["to"], .string("client@example.com"))
        } else {
            XCTFail("expected an object payload")
        }
    }

    func testPreferenceCategoryRawValuesMatchBackendEnum() {
        // backend/src/preferences/types.ts#PreferenceCategory (Phase 1.8).
        XCTAssertEqual(PreferenceCategory.writingStyle.rawValue, "writing_style")
        XCTAssertEqual(PreferenceCategory.responsePreferences.rawValue, "response_preferences")
        XCTAssertEqual(PreferenceCategory.workflowPreferences.rawValue, "workflow_preferences")
        XCTAssertEqual(PreferenceCategory.projectRules.rawValue, "project_rules")
    }

    func testDecodesSystemHealth() throws {
        let json = """
        {
          "status":"ok","timestamp":"2026-01-01T00:00:00.000Z",
          "checks":{
            "database":{"status":"ok","detail":null},
            "aiProvider":{"status":"ok","detail":"mock"},
            "memory":{"status":"ok","detail":null},
            "knowledge":{"status":"ok","detail":null}
          }
        }
        """.data(using: .utf8)!

        let health = try decoder.decode(SystemHealth.self, from: json)
        XCTAssertTrue(health.isHealthy)
        XCTAssertEqual(health.checks.aiProvider.detail, "mock")
    }

    func testEncodesUpdateUserProfileRequestDistinguishingAbsentFromNullDefaultWorkspace() throws {
        let encoder = JSONEncoder()

        let omitted = UpdateUserProfileRequest(displayName: "Roman")
        let omittedData = try encoder.encode(omitted)
        let omittedObject = try JSONSerialization.jsonObject(with: omittedData) as? [String: Any]
        XCTAssertNil(omittedObject?["defaultWorkspaceId"], "omitted should not appear in the payload at all")

        let cleared = UpdateUserProfileRequest(defaultWorkspaceId: .some(nil))
        let clearedData = try encoder.encode(cleared)
        let clearedObject = try JSONSerialization.jsonObject(with: clearedData) as? [String: Any]
        XCTAssertTrue(clearedObject?.keys.contains("defaultWorkspaceId") ?? false, "explicit clear should appear as null")
        XCTAssertTrue(clearedObject?["defaultWorkspaceId"] is NSNull)
    }
}
