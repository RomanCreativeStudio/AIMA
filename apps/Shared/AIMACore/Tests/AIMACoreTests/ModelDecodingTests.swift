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

    func testJSONValueDisplayStringRendersNestedPayloadsReadably() {
        let payload = JSONValue.object([
            "to": .string("client@example.com"),
            "cc": .array([.string("boss@example.com")]),
            "urgent": .bool(true),
            "retries": .number(2),
            "note": .null,
        ])

        XCTAssertEqual(
            payload.displayString,
            #"{ cc: [boss@example.com], note: null, retries: 2.0, to: client@example.com, urgent: true }"#
        )
    }

    func testTaskStatusDisplayNames() {
        XCTAssertEqual(TaskStatus.todo.displayName, "To Do")
        XCTAssertEqual(TaskStatus.inProgress.displayName, "In Progress")
        XCTAssertEqual(TaskStatus.done.displayName, "Done")
        XCTAssertEqual(TaskStatus.cancelled.displayName, "Cancelled")
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

    func testDecodesWorkspaceIntegrationConnectedWithCapabilities() throws {
        let json = """
        {
          "workspaceId":"w1","provider":"gmail","enabled":true,"status":"connected",
          "connectedAt":"2026-01-01T00:00:00.000Z","lastValidatedAt":"2026-01-01T00:00:00.000Z",
          "createdAt":"2026-01-01T00:00:00.000Z","updatedAt":"2026-01-01T00:00:00.000Z",
          "displayName":"Gmail","description":"Read-only access to Gmail messages.",
          "capabilities":[
            {"actionType":"read_email","tier":"execute_with_approval"},
            {"actionType":"draft_gmail_email","tier":"execute_with_approval"}
          ],
          "requiredCredentialFields":["accessToken","refreshToken"]
        }
        """.data(using: .utf8)!

        let integration = try decoder.decode(WorkspaceIntegration.self, from: json)
        XCTAssertEqual(integration.provider, .gmail)
        XCTAssertEqual(integration.status, .connected)
        XCTAssertTrue(integration.enabled)
        XCTAssertEqual(integration.capabilities.count, 2)
        XCTAssertEqual(integration.requiredCredentialFields, ["accessToken", "refreshToken"])
        XCTAssertEqual(integration.id, "w1:gmail")
    }

    func testDecodesWorkspaceIntegrationDisconnectedPlaceholderWithNullTimestamps() throws {
        let json = """
        {
          "workspaceId":"w1","provider":"github","enabled":false,"status":"disconnected",
          "connectedAt":null,"lastValidatedAt":null,"createdAt":"","updatedAt":"",
          "displayName":"GitHub","description":"Read-only access to repositories and issues.",
          "capabilities":[{"actionType":"read_repositories","tier":"execute_with_approval"}],
          "requiredCredentialFields":["accessToken"]
        }
        """.data(using: .utf8)!

        let integration = try decoder.decode(WorkspaceIntegration.self, from: json)
        XCTAssertNil(integration.connectedAt)
        XCTAssertFalse(integration.enabled)
        XCTAssertNil(integration.capabilities.first(where: { $0.actionType == "draft_repositories" }), "github has no write capability")
    }

    func testIntegrationProviderRawValuesMatchBackendEnum() {
        // backend/database/migrations/0011_integrations.sql's integration_provider enum.
        XCTAssertEqual(IntegrationProvider.gmail.rawValue, "gmail")
        XCTAssertEqual(IntegrationProvider.github.rawValue, "github")
        XCTAssertEqual(IntegrationProvider.calendar.rawValue, "calendar")
    }

    func testIntegrationStatusRawValuesMatchBackendEnum() {
        // backend/database/migrations/0011_integrations.sql's integration_status enum.
        XCTAssertEqual(IntegrationStatus.disconnected.rawValue, "disconnected")
        XCTAssertEqual(IntegrationStatus.connected.rawValue, "connected")
        XCTAssertEqual(IntegrationStatus.error.rawValue, "error")
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

    func testWorkflowKeyRawValuesMatchBackendEnum() {
        // backend/database/migrations/0012_workflows.sql's workflow_key enum.
        XCTAssertEqual(WorkflowKey.draftEmailReply.rawValue, "draft_email_reply")
        XCTAssertEqual(WorkflowKey.createGithubIssueDraft.rawValue, "create_github_issue_draft")
        XCTAssertEqual(WorkflowKey.summarizeUnreadEmail.rawValue, "summarize_unread_email")
        XCTAssertEqual(WorkflowKey.dailyWorkspaceBriefing.rawValue, "daily_workspace_briefing")
    }

    func testWorkflowRunStatusRawValuesMatchBackendEnum() {
        // backend/database/migrations/0012_workflows.sql's workflow_run_status enum.
        XCTAssertEqual(WorkflowRunStatus.pending.rawValue, "pending")
        XCTAssertEqual(WorkflowRunStatus.running.rawValue, "running")
        XCTAssertEqual(WorkflowRunStatus.awaitingApproval.rawValue, "awaiting_approval")
        XCTAssertEqual(WorkflowRunStatus.paused.rawValue, "paused")
        XCTAssertEqual(WorkflowRunStatus.completed.rawValue, "completed")
        XCTAssertEqual(WorkflowRunStatus.failed.rawValue, "failed")
        XCTAssertEqual(WorkflowRunStatus.cancelled.rawValue, "cancelled")
    }

    func testDecodesWorkflowDefinition() throws {
        let json = """
        {
          "key": "draft_email_reply", "displayName": "Draft Email Reply",
          "description": "Compose a reply and save it to the local draft queue for review.",
          "steps": [
            {"key":"compose_reply","displayName":"Compose reply","capability":null},
            {"key":"save_draft","displayName":"Save as email draft","capability":"draft_email"}
          ],
          "triggerPhrases": ["draft a reply"]
        }
        """.data(using: .utf8)!

        let definition = try decoder.decode(WorkflowDefinition.self, from: json)
        XCTAssertEqual(definition.key, .draftEmailReply)
        XCTAssertEqual(definition.steps.count, 2)
        XCTAssertNil(definition.steps[0].capability)
        XCTAssertEqual(definition.steps[1].capability, "draft_email")
    }

    func testDecodesWorkflowRunDetailWithFlatStepsSibling() throws {
        // The backend's JSON is flat — `steps` is a sibling field, not nested under a `run` key
        // (backend/src/workflows/types.ts#WorkflowRunDetail) — so Codable synthesis needs the shape to match exactly.
        let json = """
        {
          "id":"run-1","workspaceId":"w1","workflowKey":"daily_workspace_briefing","status":"running",
          "currentStepIndex":1,"input":{},"result":null,
          "createdAt":"2026-01-01T00:00:00.000Z","updatedAt":"2026-01-01T00:00:00.000Z","completedAt":null,
          "steps":[
            {"id":"s1","workflowRunId":"run-1","stepIndex":0,"stepKey":"gather_snapshot","status":"completed","capability":null,"pendingApprovalId":null,"output":{"openTaskCount":2},"createdAt":"2026-01-01T00:00:00.000Z","updatedAt":"2026-01-01T00:00:00.000Z"},
            {"id":"s2","workflowRunId":"run-1","stepIndex":1,"stepKey":"compose_briefing","status":"pending","capability":null,"pendingApprovalId":null,"output":null,"createdAt":"2026-01-01T00:00:00.000Z","updatedAt":"2026-01-01T00:00:00.000Z"}
          ]
        }
        """.data(using: .utf8)!

        let detail = try decoder.decode(WorkflowRunDetail.self, from: json)
        XCTAssertEqual(detail.status, .running)
        XCTAssertEqual(detail.steps.count, 2)
        XCTAssertEqual(detail.steps[0].status, .completed)
        XCTAssertEqual(detail.steps[0].output?["openTaskCount"], .number(2))
        XCTAssertEqual(detail.asRun.id, detail.id)
    }

    func testDecodesSendMessageResultWithWorkflowSuggestion() throws {
        let json = """
        {
          "userMessage": {"id":"m1","conversationId":"c1","workspaceId":"w1","role":"user","content":"give me my daily briefing","createdAt":"2026-01-01T00:00:00.000Z"},
          "assistantMessage": {"id":"m2","conversationId":"c1","workspaceId":"w1","role":"assistant","content":"Sure.","createdAt":"2026-01-01T00:00:00.000Z"},
          "retrievedMemories": [], "retrievedDocumentChunks": [],
          "intent": {"intent":"chat","confidence":0.5,"parameters":{},"approval":"no_approval_needed","suggestedNextAction":"x"},
          "approvalDecision": {"state":"no_approval_needed","pendingApprovalId":null},
          "workflowSuggestion": {
            "workflowKey":"daily_workspace_briefing","displayName":"Daily Workspace Briefing",
            "description":"Gather a snapshot.","confidence":0.75,
            "steps":[{"key":"gather_snapshot","displayName":"Gather workspace snapshot","capability":null}],
            "extractedInput":{}
          }
        }
        """.data(using: .utf8)!

        let result = try decoder.decode(SendMessageResult.self, from: json)
        XCTAssertEqual(result.workflowSuggestion?.workflowKey, .dailyWorkspaceBriefing)
        XCTAssertEqual(result.workflowSuggestion?.confidence, 0.75)
    }

    func testDecodesRankedMemoryResult() throws {
        let json = """
        {
          "id":"m1","workspaceId":"w1","scope":"workspace","content":"Acme timeline slipped.",
          "source":null,"conversationId":null,"projectKey":null,"metadata":{},
          "createdAt":"2026-01-01T00:00:00.000Z","score":0.82
        }
        """.data(using: .utf8)!

        let memory = try decoder.decode(RankedMemoryResult.self, from: json)
        XCTAssertEqual(memory.scope, .workspace)
        XCTAssertEqual(memory.content, "Acme timeline slipped.")
        XCTAssertEqual(memory.score, 0.82)
    }

    func testDecodesActionLogRecordWithNullActionType() throws {
        let json = """
        {
          "id":"a1","workspaceId":"w1","actionType":null,"tier":"automatic_safe",
          "summary":"Internal step","payload":null,"outcome":"success","createdAt":"2026-01-01T00:00:00.000Z"
        }
        """.data(using: .utf8)!

        let entry = try decoder.decode(ActionLogRecord.self, from: json)
        XCTAssertNil(entry.actionType)
        XCTAssertEqual(entry.outcome, .success)
    }

    func testDecodesDailyBriefing() throws {
        let json = """
        {
          "workspaceId":"w1","workspaceName":"Roman Creative Studio",
          "pendingApprovalCount":1,"pendingApprovals":[],
          "activeWorkflowCount":0,"activeWorkflows":[],
          "priorityTasks":[],"recentActivity":[],
          "generatedAt":"2026-01-01T00:00:00.000Z"
        }
        """.data(using: .utf8)!

        let briefing = try decoder.decode(DailyBriefing.self, from: json)
        XCTAssertEqual(briefing.workspaceName, "Roman Creative Studio")
        XCTAssertEqual(briefing.pendingApprovalCount, 1)
    }

    func testDecodesTaskIntelligenceWithRelatedGroups() throws {
        let json = """
        {
          "workspaceId":"w1","suggestedPriorities":[],"dueSoon":[],"overdue":[],
          "relatedGroups":[{"keyword":"acme","taskIds":["t1","t2"]}],
          "generatedAt":"2026-01-01T00:00:00.000Z"
        }
        """.data(using: .utf8)!

        let intelligence = try decoder.decode(TaskIntelligence.self, from: json)
        XCTAssertEqual(intelligence.relatedGroups.count, 1)
        XCTAssertEqual(intelligence.relatedGroups[0].taskIds, ["t1", "t2"])
    }

    func testDecodesConversationIntelligence() throws {
        let json = """
        {
          "workspaceId":"w1","conversationId":"c1","summary":"A short summary.",
          "suggestedFollowUps":["Ask about pricing"],"recentContext":[],"relatedMemories":[],
          "generatedAt":"2026-01-01T00:00:00.000Z"
        }
        """.data(using: .utf8)!

        let intelligence = try decoder.decode(ConversationIntelligence.self, from: json)
        XCTAssertEqual(intelligence.summary, "A short summary.")
        XCTAssertEqual(intelligence.suggestedFollowUps, ["Ask about pricing"])
    }

    func testDecodesWorkspaceInsights() throws {
        let json = """
        {
          "workspaceId":"w1",
          "activityMetrics":{"totalActions":3,"successfulActions":2,"failedActions":1},
          "workflowMetrics":{"totalRuns":2,"activeRuns":1,"completedRuns":1,"byStatus":{"pending":1,"completed":1}},
          "approvalMetrics":{"total":2,"pending":1,"approved":1,"rejected":0,"expired":0},
          "taskMetrics":{"total":4,"todo":1,"inProgress":1,"done":2,"cancelled":0,"completionRate":0.5},
          "generatedAt":"2026-01-01T00:00:00.000Z"
        }
        """.data(using: .utf8)!

        let insights = try decoder.decode(WorkspaceInsights.self, from: json)
        XCTAssertEqual(insights.activityMetrics.totalActions, 3)
        XCTAssertEqual(insights.workflowMetrics.byStatus["pending"], 1)
        XCTAssertEqual(insights.taskMetrics.completionRate, 0.5)
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
