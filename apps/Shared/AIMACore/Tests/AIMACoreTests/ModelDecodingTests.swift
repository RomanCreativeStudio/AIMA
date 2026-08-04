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

    func testDecodesActionSuggestionWithMatchedTaskId() throws {
        let json = """
        {"content":"Blocked on the design review","category":"blocked","confidence":0.8,"reason":"test","matchedTaskId":"t1"}
        """.data(using: .utf8)!

        let suggestion = try decoder.decode(ActionSuggestion.self, from: json)
        XCTAssertEqual(suggestion.category, .blocked)
        XCTAssertEqual(suggestion.matchedTaskId, "t1")
    }

    func testDecodesActionSuggestionDefaultsMatchedTaskIdToNilWhenAbsent() throws {
        // Pre-Executive-Assistant-Loop payload — no matchedTaskId key at all — still decodes.
        let json = """
        {"content":"I need to email the client","category":"todo","confidence":0.7,"reason":"test"}
        """.data(using: .utf8)!

        let suggestion = try decoder.decode(ActionSuggestion.self, from: json)
        XCTAssertEqual(suggestion.category, .todo)
        XCTAssertNil(suggestion.matchedTaskId)
    }

    func testActionSuggestionCategoryRawValuesMatchBackendEnum() {
        // backend/src/conversation/actionSuggestions.ts#ActionSuggestionCategory (Executive Assistant Loop sprint additions).
        XCTAssertEqual(ActionSuggestionCategory.completedTask.rawValue, "completed_task")
        XCTAssertEqual(ActionSuggestionCategory.blocked.rawValue, "blocked")
        XCTAssertEqual(ActionSuggestionCategory.postponed.rawValue, "postponed")
        XCTAssertEqual(ActionSuggestionCategory.delegated.rawValue, "delegated")
    }

    func testDecodesSendMessageResultWithContextTasksAndDecisions() throws {
        let json = """
        {
          "userMessage": {"id":"m1","conversationId":"c1","workspaceId":"w1","role":"user","content":"hi","createdAt":"2026-01-01T00:00:00.000Z"},
          "assistantMessage": {"id":"m2","conversationId":"c1","workspaceId":"w1","role":"assistant","content":"hello","createdAt":"2026-01-01T00:00:00.000Z"},
          "retrievedMemories": [{"id":"m1"}],
          "retrievedDocumentChunks": [],
          "intent": {"intent":"chat","confidence":0.5,"parameters":{},"approval":"no_approval_needed","suggestedNextAction":"No action needed."},
          "approvalDecision": {"state":"no_approval_needed","pendingApprovalId":null},
          "contextTasks": [{"id":"t1"}, {"id":"t2"}],
          "contextDecisions": [{"id":"d1"}]
        }
        """.data(using: .utf8)!

        let result = try decoder.decode(SendMessageResult.self, from: json)
        XCTAssertEqual(result.contextTasks.count, 2)
        XCTAssertEqual(result.contextDecisions.count, 1)
    }

    func testSendMessageResultDefaultsContextTasksAndDecisionsToEmptyWhenMissing() throws {
        // Pre-Context-Assembly-Engine payload — no contextTasks/contextDecisions keys at all — still decodes.
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
        XCTAssertEqual(result.contextTasks, [])
        XCTAssertEqual(result.contextDecisions, [])
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
        XCTAssertNil(integration.capabilities.first(where: { $0.actionType == "draft_repositories" }), "draft_repositories was never a real capability")
        XCTAssertNil(integration.tokenExpiresAt, "an absent tokenExpiresAt key must decode to nil, same as an explicit null")
    }

    func testDecodesWorkspaceIntegrationWithTokenExpiresAt() throws {
        // Phase 2.7 — tokenExpiresAt is non-secret OAuth token-expiry metadata, distinct from the encrypted credentials themselves.
        let json = """
        {
          "workspaceId":"w1","provider":"gmail","enabled":true,"status":"connected",
          "connectedAt":"2026-01-01T00:00:00.000Z","lastValidatedAt":"2026-01-01T00:00:00.000Z",
          "tokenExpiresAt":"2026-01-01T01:00:00.000Z",
          "createdAt":"2026-01-01T00:00:00.000Z","updatedAt":"2026-01-01T00:00:00.000Z",
          "displayName":"Gmail","description":"Send, save drafts, read the inbox/unread messages, and search a connected Gmail account.",
          "capabilities":[
            {"actionType":"read_email","tier":"execute_with_approval"},
            {"actionType":"send_email","tier":"execute_with_approval"},
            {"actionType":"draft_gmail_email","tier":"execute_with_approval"}
          ],
          "requiredCredentialFields":["accessToken","refreshToken"]
        }
        """.data(using: .utf8)!

        let integration = try decoder.decode(WorkspaceIntegration.self, from: json)
        XCTAssertEqual(integration.tokenExpiresAt, "2026-01-01T01:00:00.000Z")
        XCTAssertEqual(integration.capabilities.count, 3)
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
            "knowledge":{"status":"ok","detail":null},
            "integrations":{"status":"ok","detail":"gmail, github, calendar"},
            "voiceProviders":{"status":"ok","detail":"mock / mock"}
          }
        }
        """.data(using: .utf8)!

        let health = try decoder.decode(SystemHealth.self, from: json)
        XCTAssertTrue(health.isHealthy)
        XCTAssertEqual(health.checks.aiProvider.detail, "mock")
        XCTAssertEqual(health.checks.integrations.detail, "gmail, github, calendar")
        XCTAssertEqual(health.checks.voiceProviders.detail, "mock / mock")
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
        // Pre-Phase-3.4 payload — no scoring/lifecycle fields — still decodes, defaulting to nil.
        XCTAssertNil(memory.importanceScore)
        XCTAssertNil(memory.memoryType)
    }

    func testDecodesMemoryRecordWithPhase34ScoringAndLifecycleFields() throws {
        let json = """
        {
          "id":"m1","workspaceId":"w1","scope":"user","content":"Prefers concise emails.",
          "source":null,"conversationId":null,"projectKey":null,"metadata":{},
          "createdAt":"2026-01-01T00:00:00.000Z","importanceScore":0.6,"confidenceScore":0.8,
          "memoryType":"short_term","lastAccessedAt":"2026-01-02T00:00:00.000Z",
          "expiresAt":"2026-02-01T00:00:00.000Z","archivedAt":null
        }
        """.data(using: .utf8)!

        let memory = try decoder.decode(MemoryRecord.self, from: json)
        XCTAssertEqual(memory.importanceScore, 0.6)
        XCTAssertEqual(memory.confidenceScore, 0.8)
        XCTAssertEqual(memory.memoryType, .shortTerm)
        XCTAssertEqual(memory.lastAccessedAt, "2026-01-02T00:00:00.000Z")
        XCTAssertEqual(memory.expiresAt, "2026-02-01T00:00:00.000Z")
        XCTAssertFalse(memory.isArchived)
    }

    func testDecodesMemorySuggestion() throws {
        let json = """
        {"content":"My name is Roman.","category":"fact","importance":0.95,"confidence":0.95,"reason":"matched \\"my name is\\""}
        """.data(using: .utf8)!

        let suggestion = try decoder.decode(MemorySuggestion.self, from: json)
        XCTAssertEqual(suggestion.category, .fact)
        XCTAssertEqual(suggestion.importance, 0.95)
    }

    func testSendMessageResultDefaultsMemorySuggestionsToEmptyWhenMissing() throws {
        let json = """
        {
          "userMessage": {"id":"m1","conversationId":"c1","workspaceId":"w1","role":"user","content":"hi","createdAt":"2026-01-01T00:00:00.000Z"},
          "assistantMessage": {"id":"m2","conversationId":"c1","workspaceId":"w1","role":"assistant","content":"hello","createdAt":"2026-01-01T00:00:00.000Z"},
          "retrievedMemories": [], "retrievedDocumentChunks": [],
          "intent": {"intent":"chat","confidence":0.5,"parameters":{},"approval":"no_approval_needed","suggestedNextAction":"x"},
          "approvalDecision": {"state":"no_approval_needed","pendingApprovalId":null}
        }
        """.data(using: .utf8)!

        let result = try decoder.decode(SendMessageResult.self, from: json)
        XCTAssertEqual(result.memorySuggestions, [])
        XCTAssertNil(result.retrievedContext, "a pre-Phase-3.6 payload has no retrievedContext key at all")
    }

    func testDecodesSearchResult() throws {
        let json = """
        {
          "id":"emb-1","workspaceId":"w1","sourceType":"task","sourceId":"task-1","chunkIndex":0,
          "content":"Schedule a client call","embeddingVersion":1,
          "indexedAt":"2026-01-01T00:00:00.000Z","createdAt":"2026-01-01T00:00:00.000Z","score":0.74
        }
        """.data(using: .utf8)!

        let result = try decoder.decode(SearchResult.self, from: json)
        XCTAssertEqual(result.sourceType, .task)
        XCTAssertEqual(result.chunkIndex, 0)
        XCTAssertEqual(result.score, 0.74)
    }

    func testDecodesRetrievedContext() throws {
        let json = """
        {
          "memories": [{"id":"m1","workspaceId":"w1","scope":"workspace","content":"Prefers async updates.","source":null,"conversationId":null,"projectKey":null,"metadata":{},"createdAt":"2026-01-01T00:00:00.000Z","score":0.9}],
          "relatedConversations": [{"id":"emb-1","workspaceId":"w1","sourceType":"conversation","sourceId":"c1","chunkIndex":0,"content":"user: hi","embeddingVersion":1,"indexedAt":"2026-01-01T00:00:00.000Z","createdAt":"2026-01-01T00:00:00.000Z","score":0.6}],
          "relatedTasks": []
        }
        """.data(using: .utf8)!

        let context = try decoder.decode(RetrievedContext.self, from: json)
        XCTAssertEqual(context.memories.count, 1)
        XCTAssertEqual(context.relatedConversations.count, 1)
        XCTAssertEqual(context.relatedConversations[0].sourceType, .conversation)
        XCTAssertEqual(context.relatedTasks, [])
    }

    func testSendMessageResultDecodesRetrievedContextWhenPresent() throws {
        let json = """
        {
          "userMessage": {"id":"m1","conversationId":"c1","workspaceId":"w1","role":"user","content":"hi","createdAt":"2026-01-01T00:00:00.000Z"},
          "assistantMessage": {"id":"m2","conversationId":"c1","workspaceId":"w1","role":"assistant","content":"hello","createdAt":"2026-01-01T00:00:00.000Z"},
          "retrievedMemories": [], "retrievedDocumentChunks": [],
          "intent": {"intent":"chat","confidence":0.5,"parameters":{},"approval":"no_approval_needed","suggestedNextAction":"x"},
          "approvalDecision": {"state":"no_approval_needed","pendingApprovalId":null},
          "retrievedContext": {"memories":[],"relatedConversations":[],"relatedTasks":[]}
        }
        """.data(using: .utf8)!

        let result = try decoder.decode(SendMessageResult.self, from: json)
        XCTAssertNotNil(result.retrievedContext)
        XCTAssertEqual(result.retrievedContext?.relatedTasks, [])
    }

    func testDecodesReindexWorkspaceResult() throws {
        let json = """
        {
          "conversations": [{"sourceType":"conversation","sourceId":"c1","chunksIndexed":1,"chunksSkipped":0,"chunksDeleted":0}],
          "tasks": []
        }
        """.data(using: .utf8)!

        let result = try decoder.decode(ReindexWorkspaceResult.self, from: json)
        XCTAssertEqual(result.conversations.count, 1)
        XCTAssertEqual(result.conversations[0].chunksIndexed, 1)
        XCTAssertEqual(result.tasks, [])
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
        // Pre-Phase-3.5 payload — no recentMemories/calendarHighlights/suggestedNextActions — still decodes.
        XCTAssertEqual(briefing.recentMemories, [])
        XCTAssertEqual(briefing.calendarHighlights, [])
        XCTAssertEqual(briefing.suggestedNextActions, [])
        // Pre-Executive-Assistant-Loop payload — no completedYesterday/blockedItems/postponedItems — still decodes.
        XCTAssertEqual(briefing.completedYesterday, [])
        XCTAssertEqual(briefing.blockedItems, [])
        XCTAssertEqual(briefing.postponedItems, [])
    }

    func testDecodesDailyBriefingWithExecutiveAssistantLoopFields() throws {
        let json = """
        {
          "workspaceId":"w1","workspaceName":"Roman Creative Studio",
          "pendingApprovalCount":0,"pendingApprovals":[],
          "activeWorkflowCount":0,"activeWorkflows":[],
          "priorityTasks":[],"recentActivity":[],
          "completedYesterday":[
            {"id":"t1","workspaceId":"w1","title":"Ship it","description":null,"status":"done","priority":"high",
             "dueDate":null,"createdAt":"2026-01-01T00:00:00.000Z","updatedAt":"2026-01-01T00:00:00.000Z"}
          ],
          "blockedItems":[
            {"id":"t2","workspaceId":"w1","title":"Design review","description":null,"status":"todo","priority":"medium",
             "dueDate":null,"metadata":{"category":"blocked"},"createdAt":"2026-01-01T00:00:00.000Z","updatedAt":"2026-01-01T00:00:00.000Z"}
          ],
          "postponedItems":[
            {"id":"t3","workspaceId":"w1","title":"Launch","description":null,"status":"todo","priority":"medium",
             "dueDate":null,"metadata":{"category":"postponed"},"createdAt":"2026-01-01T00:00:00.000Z","updatedAt":"2026-01-01T00:00:00.000Z"}
          ],
          "generatedAt":"2026-01-01T00:00:00.000Z"
        }
        """.data(using: .utf8)!

        let briefing = try decoder.decode(DailyBriefing.self, from: json)
        XCTAssertEqual(briefing.completedYesterday.count, 1)
        XCTAssertEqual(briefing.completedYesterday[0].status, .done)
        XCTAssertEqual(briefing.blockedItems.count, 1)
        XCTAssertEqual(briefing.postponedItems.count, 1)
    }

    func testDecodesDailyBriefingWithPhase35ProactiveFields() throws {
        let json = """
        {
          "workspaceId":"w1","workspaceName":"Roman Creative Studio",
          "pendingApprovalCount":0,"pendingApprovals":[],
          "activeWorkflowCount":0,"activeWorkflows":[],
          "priorityTasks":[],"recentActivity":[],
          "recentMemories":[
            {"id":"m1","workspaceId":"w1","scope":"workspace","content":"x","source":null,
             "conversationId":null,"projectKey":null,"metadata":{},"createdAt":"2026-01-01T00:00:00.000Z"}
          ],
          "calendarHighlights":[
            {"id":"a1","workspaceId":"w1","actionType":"create_calendar_event","tier":"execute_with_approval",
             "summary":"Created a calendar event","payload":null,"outcome":"success","createdAt":"2026-01-01T00:00:00.000Z"}
          ],
          "suggestedNextActions":[
            {"id":"workflow:x","workspaceId":"w1","type":"workflow","title":"Run x again",
             "explanation":"x ran 3 times.","confidence":0.75,"source":"frequent_workflow_pattern",
             "timestamp":"2026-01-01T00:00:00.000Z","payload":{"workflowKey":"x"}}
          ],
          "generatedAt":"2026-01-01T00:00:00.000Z"
        }
        """.data(using: .utf8)!

        let briefing = try decoder.decode(DailyBriefing.self, from: json)
        XCTAssertEqual(briefing.recentMemories.count, 1)
        XCTAssertEqual(briefing.calendarHighlights.count, 1)
        XCTAssertEqual(briefing.suggestedNextActions.count, 1)
        XCTAssertEqual(briefing.suggestedNextActions[0].type, .workflow)
    }

    func testDecodesSuggestion() throws {
        let json = """
        {"id":"workflow:x","workspaceId":"w1","type":"workflow","title":"Run x again",
         "explanation":"x ran 3 times.","confidence":0.75,"source":"frequent_workflow_pattern",
         "timestamp":"2026-01-01T00:00:00.000Z","payload":{"workflowKey":"x"}}
        """.data(using: .utf8)!

        let suggestion = try decoder.decode(Suggestion.self, from: json)
        XCTAssertEqual(suggestion.type, .workflow)
        XCTAssertEqual(suggestion.confidence, 0.75)
        XCTAssertEqual(suggestion.source, "frequent_workflow_pattern")
    }

    func testDecodesPattern() throws {
        let json = """
        {"workspaceId":"w1","type":"repeated_task","description":"2 tasks share a keyword.",
         "confidence":0.5,"occurrences":2,"detectedAt":"2026-01-01T00:00:00.000Z",
         "metadata":{"keyword":"acme"}}
        """.data(using: .utf8)!

        let pattern = try decoder.decode(Pattern.self, from: json)
        XCTAssertEqual(pattern.type, .repeatedTask)
        XCTAssertEqual(pattern.occurrences, 2)
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

    func testExecutionStatusRawValuesMatchBackendEnum() {
        // backend/database/migrations/0014_executions.sql's execution_status enum.
        XCTAssertEqual(ExecutionStatus.pending.rawValue, "pending")
        XCTAssertEqual(ExecutionStatus.awaitingApproval.rawValue, "awaiting_approval")
        XCTAssertEqual(ExecutionStatus.succeeded.rawValue, "succeeded")
        XCTAssertEqual(ExecutionStatus.failed.rawValue, "failed")
    }

    func testDecodesExecutionRecord() throws {
        let json = """
        {
          "id":"exec-1","workspaceId":"w1","provider":"gmail","actionType":"send_email","status":"awaiting_approval",
          "requestPayload":{"to":"client@example.com"},"responseSummary":null,"errorDetails":null,
          "pendingApprovalId":"a1","startedAt":null,"completedAt":null,
          "createdAt":"2026-01-01T00:00:00.000Z","updatedAt":"2026-01-01T00:00:00.000Z"
        }
        """.data(using: .utf8)!

        let execution = try decoder.decode(ExecutionRecord.self, from: json)
        XCTAssertEqual(execution.provider, .gmail)
        XCTAssertEqual(execution.status, .awaitingApproval)
        XCTAssertEqual(execution.requestPayload["to"], .string("client@example.com"))
        XCTAssertEqual(execution.pendingApprovalId, "a1")
        XCTAssertNil(execution.responseSummary)
    }

    func testDecodesExecutionPreview() throws {
        let json = """
        {
          "actionType":"create_github_issue","provider":"github","tier":"execute_with_approval",
          "requiresApproval":true,"integrationConnected":true,
          "payload":{"repository":"romancreativestudio/aima","title":"Bug"}
        }
        """.data(using: .utf8)!

        let preview = try decoder.decode(ExecutionPreview.self, from: json)
        XCTAssertEqual(preview.provider, .github)
        XCTAssertTrue(preview.requiresApproval)
        XCTAssertTrue(preview.integrationConnected)
        XCTAssertEqual(preview.payload["title"], .string("Bug"))
    }

    func testDecodesSendMessageResultWithExecutionSuggestion() throws {
        let json = """
        {
          "userMessage": {"id":"m1","conversationId":"c1","workspaceId":"w1","role":"user","content":"send an email to Acme","createdAt":"2026-01-01T00:00:00.000Z"},
          "assistantMessage": {"id":"m2","conversationId":"c1","workspaceId":"w1","role":"assistant","content":"Sure.","createdAt":"2026-01-01T00:00:00.000Z"},
          "retrievedMemories": [], "retrievedDocumentChunks": [],
          "intent": {"intent":"chat","confidence":0.5,"parameters":{},"approval":"no_approval_needed","suggestedNextAction":"x"},
          "approvalDecision": {"state":"no_approval_needed","pendingApprovalId":null},
          "executionSuggestion": {
            "actionType":"send_email","provider":"gmail","confidence":0.7,
            "extractedPayload":{"to":"client@example.com"}
          }
        }
        """.data(using: .utf8)!

        let result = try decoder.decode(SendMessageResult.self, from: json)
        XCTAssertEqual(result.executionSuggestion?.actionType, "send_email")
        XCTAssertEqual(result.executionSuggestion?.provider, .gmail)
        XCTAssertEqual(result.executionSuggestion?.confidence, 0.7)
    }

    func testDecodesVoiceSession() throws {
        let json = """
        {
          "id": "vs-1", "workspaceId": "w1", "conversationId": "c1", "status": "active",
          "startedAt": "2026-01-01T00:00:00.000Z", "endedAt": null,
          "createdAt": "2026-01-01T00:00:00.000Z", "updatedAt": "2026-01-01T00:00:00.000Z"
        }
        """.data(using: .utf8)!

        let session = try decoder.decode(VoiceSession.self, from: json)
        XCTAssertTrue(session.isActive)
        XCTAssertEqual(session.conversationId, "c1")
        XCTAssertNil(session.endedAt)
    }

    func testDecodesVoiceResponseAndDecodesBase64Audio() throws {
        let json = """
        {
          "turn": {
            "id": "turn-1", "voiceSessionId": "vs-1", "workspaceId": "w1",
            "transcript": {"text": "hello", "confidence": 0.95},
            "responseText": "hi there", "createdAt": "2026-01-01T00:00:00.000Z"
          },
          "audioBase64": "aGkgdGhlcmU=",
          "audioMimeType": "text/plain",
          "intent": {"intent":"chat","confidence":0.5,"parameters":{},"approval":"no_approval_needed","suggestedNextAction":"x"},
          "approvalDecision": {"state":"no_approval_needed","pendingApprovalId":null},
          "workflowSuggestion": null,
          "executionSuggestion": null
        }
        """.data(using: .utf8)!

        let response = try decoder.decode(VoiceResponse.self, from: json)
        XCTAssertEqual(response.turn.transcript.text, "hello")
        XCTAssertEqual(response.turn.transcript.confidence, 0.95)
        XCTAssertEqual(response.audioData, "hi there".data(using: .utf8))
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
