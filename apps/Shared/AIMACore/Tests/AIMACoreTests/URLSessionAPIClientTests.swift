import XCTest
@testable import AIMACore
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Intercepts every request a `URLSession` makes so `URLSessionAPIClient`
/// can be tested without a real backend — the request it built is recorded,
/// and a canned response is returned. Mirrors how `backend/src/routes/*.test.ts`
/// exercises a real HTTP server rather than mocking `fetch`, adapted for a
/// client where standing up a real server per test isn't practical.
final class MockURLProtocol: URLProtocol {
    struct Stub {
        let statusCode: Int
        let body: Data
    }

    /// Keyed by "METHOD path" (query string ignored) so a test only has to name what it cares about.
    static var stubs: [String: Stub] = [:]
    static var recordedRequests: [URLRequest] = []

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        MockURLProtocol.recordedRequests.append(request)

        guard let url = request.url, let method = request.httpMethod else {
            client?.urlProtocol(self, didFailWithError: APIError.invalidURL)
            return
        }
        let key = "\(method) \(url.path)"

        guard let stub = MockURLProtocol.stubs[key] else {
            client?.urlProtocol(self, didFailWithError: APIError.network("no stub registered for \(key)"))
            return
        }

        let response = HTTPURLResponse(url: url, statusCode: stub.statusCode, httpVersion: "HTTP/1.1", headerFields: nil)!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: stub.body)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}

    static func reset() {
        stubs = [:]
        recordedRequests = []
    }
}

final class URLSessionAPIClientTests: XCTestCase {
    private var client: URLSessionAPIClient!

    override func setUp() {
        super.setUp()
        MockURLProtocol.reset()
        let sessionConfiguration = URLSessionConfiguration.ephemeral
        sessionConfiguration.protocolClasses = [MockURLProtocol.self]
        let session = URLSession(configuration: sessionConfiguration)
        client = URLSessionAPIClient(configuration: APIConfiguration(baseURL: URL(string: "http://example.test")!), session: session)
    }

    override func tearDown() {
        MockURLProtocol.reset()
        super.tearDown()
    }

    func testGetHealthDecodesUnwrappedResponse() async throws {
        let body = """
        {"status":"ok","timestamp":"2026-01-01T00:00:00.000Z","checks":{"database":{"status":"ok","detail":null},"aiProvider":{"status":"ok","detail":"mock"},"memory":{"status":"ok","detail":null},"knowledge":{"status":"ok","detail":null},"integrations":{"status":"ok","detail":"gmail, github, calendar"}}}
        """.data(using: .utf8)!
        MockURLProtocol.stubs["GET /health"] = .init(statusCode: 200, body: body)

        let health = try await client.getHealth()
        XCTAssertTrue(health.isHealthy)
    }

    func testGetUserUnwrapsTheUserEnvelope() async throws {
        let body = """
        {"user":{"id":"u1","email":"you@example.com","displayName":null,"preferences":{},"communicationStyle":null,"defaultWorkspaceId":null,"createdAt":"2026-01-01T00:00:00.000Z","updatedAt":"2026-01-01T00:00:00.000Z"}}
        """.data(using: .utf8)!
        MockURLProtocol.stubs["GET /api/users/u1"] = .init(statusCode: 200, body: body)

        let user = try await client.getUser(id: "u1")
        XCTAssertEqual(user.id, "u1")
    }

    func testListTasksAppliesStatusQueryParameter() async throws {
        MockURLProtocol.stubs["GET /api/workspaces/w1/tasks"] = .init(statusCode: 200, body: #"{"tasks":[]}"#.data(using: .utf8)!)

        _ = try await client.listTasks(workspaceId: "w1", status: .inProgress)

        let recorded = try XCTUnwrap(MockURLProtocol.recordedRequests.last)
        let query = try XCTUnwrap(recorded.url?.query)
        XCTAssertEqual(query, "status=in_progress")
    }

    func testCreateTaskSendsEncodedJSONBody() async throws {
        let responseBody = """
        {"task":{"id":"t1","workspaceId":"w1","title":"Ship it","description":null,"status":"todo","priority":"high","dueDate":null,"createdAt":"2026-01-01T00:00:00.000Z","updatedAt":"2026-01-01T00:00:00.000Z"}}
        """.data(using: .utf8)!
        MockURLProtocol.stubs["POST /api/workspaces/w1/tasks"] = .init(statusCode: 201, body: responseBody)

        let task = try await client.createTask(workspaceId: "w1", request: CreateTaskRequest(title: "Ship it", priority: .high))
        XCTAssertEqual(task.title, "Ship it")

        let recorded = try XCTUnwrap(MockURLProtocol.recordedRequests.last)
        let sentBody = try XCTUnwrap(recorded.httpBody)
        let sentJSON = try JSONSerialization.jsonObject(with: sentBody) as? [String: Any]
        XCTAssertEqual(sentJSON?["title"] as? String, "Ship it")
        XCTAssertEqual(sentJSON?["priority"] as? String, "high")
    }

    func testGetApprovalUnwrapsTheApprovalEnvelope() async throws {
        let body = """
        {"approval":{"id":"a1","workspaceId":"w1","actionType":"send_email","payload":null,"status":"pending","createdAt":"2026-01-01T00:00:00.000Z","expiresAt":"2026-01-02T00:00:00.000Z","resolvedAt":null}}
        """.data(using: .utf8)!
        MockURLProtocol.stubs["GET /api/workspaces/w1/approvals/a1"] = .init(statusCode: 200, body: body)

        let approval = try await client.getApproval(workspaceId: "w1", approvalId: "a1")
        XCTAssertEqual(approval.actionType, "send_email")
        XCTAssertEqual(approval.status, .pending)
    }

    func testListIntegrationsUnwrapsTheIntegrationsEnvelope() async throws {
        let body = """
        {"integrations":[{"workspaceId":"w1","provider":"github","enabled":false,"status":"disconnected","connectedAt":null,"lastValidatedAt":null,"createdAt":"","updatedAt":"","displayName":"GitHub","description":"Read-only access to repositories and issues.","capabilities":[{"actionType":"read_repositories","tier":"execute_with_approval"}],"requiredCredentialFields":["accessToken"]}]}
        """.data(using: .utf8)!
        MockURLProtocol.stubs["GET /api/workspaces/w1/integrations"] = .init(statusCode: 200, body: body)

        let integrations = try await client.listIntegrations(workspaceId: "w1")
        XCTAssertEqual(integrations.count, 1)
        XCTAssertEqual(integrations[0].provider, .github)
    }

    func testConnectIntegrationSendsCredentialsAndUnwrapsTheIntegrationEnvelope() async throws {
        let body = """
        {"integration":{"workspaceId":"w1","provider":"github","enabled":true,"status":"connected","connectedAt":"2026-01-01T00:00:00.000Z","lastValidatedAt":"2026-01-01T00:00:00.000Z","createdAt":"2026-01-01T00:00:00.000Z","updatedAt":"2026-01-01T00:00:00.000Z","displayName":"GitHub","description":"Read-only access to repositories and issues.","capabilities":[{"actionType":"read_repositories","tier":"execute_with_approval"}],"requiredCredentialFields":["accessToken"]}}
        """.data(using: .utf8)!
        MockURLProtocol.stubs["POST /api/workspaces/w1/integrations/github/connect"] = .init(statusCode: 200, body: body)

        let integration = try await client.connectIntegration(workspaceId: "w1", provider: .github, credentials: ["accessToken": "gh-token"])
        XCTAssertEqual(integration.enabled, true)

        let recorded = try XCTUnwrap(MockURLProtocol.recordedRequests.last)
        let sentBody = try XCTUnwrap(recorded.httpBody)
        let sentJSON = try JSONSerialization.jsonObject(with: sentBody) as? [String: Any]
        let sentCredentials = sentJSON?["credentials"] as? [String: String]
        XCTAssertEqual(sentCredentials?["accessToken"], "gh-token")
    }

    func testDisconnectIntegrationPostsToTheDisconnectRoute() async throws {
        let body = """
        {"integration":{"workspaceId":"w1","provider":"calendar","enabled":false,"status":"disconnected","connectedAt":null,"lastValidatedAt":null,"createdAt":"2026-01-01T00:00:00.000Z","updatedAt":"2026-01-01T00:00:00.000Z","displayName":"Calendar","description":"Read-only access to calendar events.","capabilities":[{"actionType":"read_calendar","tier":"execute_with_approval"}],"requiredCredentialFields":["accessToken","refreshToken"]}}
        """.data(using: .utf8)!
        MockURLProtocol.stubs["POST /api/workspaces/w1/integrations/calendar/disconnect"] = .init(statusCode: 200, body: body)

        let integration = try await client.disconnectIntegration(workspaceId: "w1", provider: .calendar)
        XCTAssertEqual(integration.enabled, false)
    }

    func testStartIntegrationOAuthUnwrapsTheAuthorizationUrlEnvelope() async throws {
        let body = #"{"authorizationUrl":"https://accounts.google.com/o/oauth2/v2/auth?client_id=x&state=y"}"#.data(using: .utf8)!
        MockURLProtocol.stubs["POST /api/workspaces/w1/integrations/gmail/oauth/start"] = .init(statusCode: 200, body: body)

        let authorizationUrl = try await client.startIntegrationOAuth(workspaceId: "w1", provider: .gmail)

        XCTAssertEqual(authorizationUrl, "https://accounts.google.com/o/oauth2/v2/auth?client_id=x&state=y")
    }

    func testNonSuccessStatusThrowsServerErrorWithBackendMessage() async {
        MockURLProtocol.stubs["GET /api/workspaces/missing/tasks"] = .init(
            statusCode: 404,
            body: #"{"error":"Workspace not found: missing"}"#.data(using: .utf8)!
        )

        do {
            _ = try await client.listTasks(workspaceId: "missing", status: nil)
            XCTFail("expected an APIError.server to be thrown")
        } catch let error as APIError {
            guard case .server(let statusCode, let message) = error else {
                XCTFail("expected .server, got \(error)")
                return
            }
            XCTAssertEqual(statusCode, 404)
            XCTAssertEqual(message, "Workspace not found: missing")
        } catch {
            XCTFail("expected APIError, got \(error)")
        }
    }

    func testListWorkflowDefinitionsUnwrapsTheWorkflowsEnvelope() async throws {
        let body = """
        {"workflows":[{"key":"daily_workspace_briefing","displayName":"Daily Workspace Briefing","description":"Gather a snapshot.","steps":[{"key":"gather_snapshot","displayName":"Gather workspace snapshot","capability":null}],"triggerPhrases":["daily briefing"]}]}
        """.data(using: .utf8)!
        MockURLProtocol.stubs["GET /api/workflows"] = .init(statusCode: 200, body: body)

        let definitions = try await client.listWorkflowDefinitions()
        XCTAssertEqual(definitions.count, 1)
        XCTAssertEqual(definitions[0].key, .dailyWorkspaceBriefing)
    }

    func testCreateWorkflowRunSendsWorkflowKeyAndInputAndUnwrapsTheRunEnvelope() async throws {
        let body = """
        {"run":{"id":"run-1","workspaceId":"w1","workflowKey":"draft_email_reply","status":"pending","currentStepIndex":0,"input":{"topic":"pricing"},"result":null,"createdAt":"2026-01-01T00:00:00.000Z","updatedAt":"2026-01-01T00:00:00.000Z","completedAt":null,"steps":[]}}
        """.data(using: .utf8)!
        MockURLProtocol.stubs["POST /api/workspaces/w1/workflow-runs"] = .init(statusCode: 201, body: body)

        let run = try await client.createWorkflowRun(workspaceId: "w1", workflowKey: .draftEmailReply, input: ["topic": "pricing"])
        XCTAssertEqual(run.workflowKey, .draftEmailReply)

        let recorded = try XCTUnwrap(MockURLProtocol.recordedRequests.last)
        let sentBody = try XCTUnwrap(recorded.httpBody)
        let sentJSON = try JSONSerialization.jsonObject(with: sentBody) as? [String: Any]
        XCTAssertEqual(sentJSON?["workflowKey"] as? String, "draft_email_reply")
        let sentInput = sentJSON?["input"] as? [String: String]
        XCTAssertEqual(sentInput?["topic"], "pricing")
    }

    func testExecuteWorkflowRunStepPostsToTheExecuteRouteAndUnwrapsTheRunEnvelope() async throws {
        let body = """
        {"run":{"id":"run-1","workspaceId":"w1","workflowKey":"daily_workspace_briefing","status":"running","currentStepIndex":1,"input":{},"result":null,"createdAt":"2026-01-01T00:00:00.000Z","updatedAt":"2026-01-01T00:00:00.000Z","completedAt":null,"steps":[]}}
        """.data(using: .utf8)!
        MockURLProtocol.stubs["POST /api/workspaces/w1/workflow-runs/run-1/execute"] = .init(statusCode: 200, body: body)

        let run = try await client.executeWorkflowRunStep(workspaceId: "w1", runId: "run-1")
        XCTAssertEqual(run.currentStepIndex, 1)
    }

    func testPauseResumeCancelWorkflowRunHitTheirRespectiveRoutes() async throws {
        func stub(_ path: String, status: WorkflowRunStatus) {
            let body = """
            {"run":{"id":"run-1","workspaceId":"w1","workflowKey":"daily_workspace_briefing","status":"\(status.rawValue)","currentStepIndex":0,"input":{},"result":null,"createdAt":"2026-01-01T00:00:00.000Z","updatedAt":"2026-01-01T00:00:00.000Z","completedAt":null,"steps":[]}}
            """.data(using: .utf8)!
            MockURLProtocol.stubs["POST \(path)"] = .init(statusCode: 200, body: body)
        }
        stub("/api/workspaces/w1/workflow-runs/run-1/pause", status: .paused)
        stub("/api/workspaces/w1/workflow-runs/run-1/resume", status: .running)
        stub("/api/workspaces/w1/workflow-runs/run-1/cancel", status: .cancelled)

        let paused = try await client.pauseWorkflowRun(workspaceId: "w1", runId: "run-1")
        XCTAssertEqual(paused.status, .paused)

        let resumed = try await client.resumeWorkflowRun(workspaceId: "w1", runId: "run-1")
        XCTAssertEqual(resumed.status, .running)

        let cancelled = try await client.cancelWorkflowRun(workspaceId: "w1", runId: "run-1")
        XCTAssertEqual(cancelled.status, .cancelled)
    }

    func testGetDailyBriefingUnwrapsTheBriefingEnvelope() async throws {
        let body = """
        {"briefing":{"workspaceId":"w1","workspaceName":"RCS","pendingApprovalCount":0,"pendingApprovals":[],"activeWorkflowCount":0,"activeWorkflows":[],"priorityTasks":[],"recentActivity":[],"generatedAt":"2026-01-01T00:00:00.000Z"}}
        """.data(using: .utf8)!
        MockURLProtocol.stubs["GET /api/workspaces/w1/briefing"] = .init(statusCode: 200, body: body)

        let briefing = try await client.getDailyBriefing(workspaceId: "w1")
        XCTAssertEqual(briefing.workspaceName, "RCS")
    }

    func testGetTaskIntelligenceUnwrapsTheTaskIntelligenceEnvelope() async throws {
        let body = """
        {"taskIntelligence":{"workspaceId":"w1","suggestedPriorities":[],"dueSoon":[],"overdue":[],"relatedGroups":[],"generatedAt":"2026-01-01T00:00:00.000Z"}}
        """.data(using: .utf8)!
        MockURLProtocol.stubs["GET /api/workspaces/w1/task-intelligence"] = .init(statusCode: 200, body: body)

        let intelligence = try await client.getTaskIntelligence(workspaceId: "w1")
        XCTAssertEqual(intelligence.workspaceId, "w1")
    }

    func testGetConversationIntelligenceUnwrapsTheConversationIntelligenceEnvelope() async throws {
        let body = """
        {"conversationIntelligence":{"workspaceId":"w1","conversationId":"c1","summary":"Summary.","suggestedFollowUps":[],"recentContext":[],"relatedMemories":[],"generatedAt":"2026-01-01T00:00:00.000Z"}}
        """.data(using: .utf8)!
        MockURLProtocol.stubs["GET /api/workspaces/w1/conversations/c1/intelligence"] = .init(statusCode: 200, body: body)

        let intelligence = try await client.getConversationIntelligence(workspaceId: "w1", conversationId: "c1")
        XCTAssertEqual(intelligence.summary, "Summary.")
    }

    func testGetWorkspaceInsightsUnwrapsTheInsightsEnvelope() async throws {
        let body = """
        {"insights":{"workspaceId":"w1","activityMetrics":{"totalActions":0,"successfulActions":0,"failedActions":0},"workflowMetrics":{"totalRuns":0,"activeRuns":0,"completedRuns":0,"byStatus":{}},"approvalMetrics":{"total":0,"pending":0,"approved":0,"rejected":0,"expired":0},"taskMetrics":{"total":0,"todo":0,"inProgress":0,"done":0,"cancelled":0,"completionRate":0},"generatedAt":"2026-01-01T00:00:00.000Z"}}
        """.data(using: .utf8)!
        MockURLProtocol.stubs["GET /api/workspaces/w1/insights"] = .init(statusCode: 200, body: body)

        let insights = try await client.getWorkspaceInsights(workspaceId: "w1")
        XCTAssertEqual(insights.workspaceId, "w1")
    }

    func testPreviewExecutionSendsActionTypeAndPayloadAndUnwrapsThePreviewEnvelope() async throws {
        let body = """
        {"preview":{"actionType":"send_email","provider":"gmail","tier":"execute_with_approval","requiresApproval":true,"integrationConnected":true,"payload":{"to":"client@example.com"}}}
        """.data(using: .utf8)!
        MockURLProtocol.stubs["POST /api/workspaces/w1/executions/preview"] = .init(statusCode: 200, body: body)

        let preview = try await client.previewExecution(workspaceId: "w1", actionType: "send_email", payload: ["to": .string("client@example.com")])
        XCTAssertEqual(preview.provider, .gmail)
        XCTAssertTrue(preview.requiresApproval)

        let recorded = try XCTUnwrap(MockURLProtocol.recordedRequests.last)
        let sentBody = try XCTUnwrap(recorded.httpBody)
        let sentJSON = try JSONSerialization.jsonObject(with: sentBody) as? [String: Any]
        XCTAssertEqual(sentJSON?["actionType"] as? String, "send_email")
    }

    func testCreateExecutionRequestPostsToTheExecutionsRouteAndUnwrapsTheExecutionEnvelope() async throws {
        let body = """
        {"execution":{"id":"exec-1","workspaceId":"w1","provider":"gmail","actionType":"send_email","status":"awaiting_approval","requestPayload":{"to":"client@example.com"},"responseSummary":null,"errorDetails":null,"pendingApprovalId":"a1","startedAt":null,"completedAt":null,"createdAt":"2026-01-01T00:00:00.000Z","updatedAt":"2026-01-01T00:00:00.000Z"}}
        """.data(using: .utf8)!
        MockURLProtocol.stubs["POST /api/workspaces/w1/executions"] = .init(statusCode: 201, body: body)

        let execution = try await client.createExecutionRequest(workspaceId: "w1", actionType: "send_email", payload: ["to": .string("client@example.com")])
        XCTAssertEqual(execution.status, .awaitingApproval)
        XCTAssertEqual(execution.pendingApprovalId, "a1")
    }

    func testExecuteExecutionPostsToTheExecuteRouteAndUnwrapsTheExecutionEnvelope() async throws {
        let body = """
        {"execution":{"id":"exec-1","workspaceId":"w1","provider":"gmail","actionType":"send_email","status":"succeeded","requestPayload":{},"responseSummary":{"messageId":"mock-message-1"},"errorDetails":null,"pendingApprovalId":null,"startedAt":"2026-01-01T00:00:00.000Z","completedAt":"2026-01-01T00:00:01.000Z","createdAt":"2026-01-01T00:00:00.000Z","updatedAt":"2026-01-01T00:00:01.000Z"}}
        """.data(using: .utf8)!
        MockURLProtocol.stubs["POST /api/workspaces/w1/executions/exec-1/execute"] = .init(statusCode: 200, body: body)

        let execution = try await client.executeExecution(workspaceId: "w1", executionId: "exec-1")
        XCTAssertEqual(execution.status, .succeeded)
        XCTAssertEqual(execution.responseSummary?["messageId"], .string("mock-message-1"))
    }

    func testListExecutionsUnwrapsTheExecutionsEnvelope() async throws {
        let body = """
        {"executions":[{"id":"exec-1","workspaceId":"w1","provider":"github","actionType":"create_github_issue","status":"pending","requestPayload":{},"responseSummary":null,"errorDetails":null,"pendingApprovalId":null,"startedAt":null,"completedAt":null,"createdAt":"2026-01-01T00:00:00.000Z","updatedAt":"2026-01-01T00:00:00.000Z"}]}
        """.data(using: .utf8)!
        MockURLProtocol.stubs["GET /api/workspaces/w1/executions"] = .init(statusCode: 200, body: body)

        let executions = try await client.listExecutions(workspaceId: "w1")
        XCTAssertEqual(executions.count, 1)
        XCTAssertEqual(executions[0].actionType, "create_github_issue")
    }

    func testGetExecutionUnwrapsTheExecutionEnvelope() async throws {
        let body = """
        {"execution":{"id":"exec-1","workspaceId":"w1","provider":"gmail","actionType":"draft_gmail_email","status":"failed","requestPayload":{},"responseSummary":null,"errorDetails":"Integration not connected","pendingApprovalId":null,"startedAt":"2026-01-01T00:00:00.000Z","completedAt":"2026-01-01T00:00:01.000Z","createdAt":"2026-01-01T00:00:00.000Z","updatedAt":"2026-01-01T00:00:01.000Z"}}
        """.data(using: .utf8)!
        MockURLProtocol.stubs["GET /api/workspaces/w1/executions/exec-1"] = .init(statusCode: 200, body: body)

        let execution = try await client.getExecution(workspaceId: "w1", executionId: "exec-1")
        XCTAssertEqual(execution.status, .failed)
        XCTAssertEqual(execution.errorDetails, "Integration not connected")
    }

    func testStartVoiceSessionPostsToTheSessionsRouteAndUnwrapsTheSessionEnvelope() async throws {
        let body = """
        {"session":{"id":"vs-1","workspaceId":"w1","conversationId":"c1","status":"active","startedAt":"2026-01-01T00:00:00.000Z","endedAt":null,"createdAt":"2026-01-01T00:00:00.000Z","updatedAt":"2026-01-01T00:00:00.000Z"}}
        """.data(using: .utf8)!
        MockURLProtocol.stubs["POST /api/workspaces/w1/voice/sessions"] = .init(statusCode: 201, body: body)

        let session = try await client.startVoiceSession(workspaceId: "w1")
        XCTAssertEqual(session.status, .active)
        XCTAssertEqual(session.conversationId, "c1")
    }

    func testEndVoiceSessionPostsToTheEndRouteAndUnwrapsTheSessionEnvelope() async throws {
        let body = """
        {"session":{"id":"vs-1","workspaceId":"w1","conversationId":"c1","status":"ended","startedAt":"2026-01-01T00:00:00.000Z","endedAt":"2026-01-01T00:01:00.000Z","createdAt":"2026-01-01T00:00:00.000Z","updatedAt":"2026-01-01T00:01:00.000Z"}}
        """.data(using: .utf8)!
        MockURLProtocol.stubs["POST /api/workspaces/w1/voice/sessions/vs-1/end"] = .init(statusCode: 200, body: body)

        let session = try await client.endVoiceSession(workspaceId: "w1", voiceSessionId: "vs-1")
        XCTAssertEqual(session.status, .ended)
        XCTAssertNotNil(session.endedAt)
    }

    func testListVoiceSessionsUnwrapsTheSessionsEnvelope() async throws {
        let body = """
        {"sessions":[{"id":"vs-1","workspaceId":"w1","conversationId":"c1","status":"active","startedAt":"2026-01-01T00:00:00.000Z","endedAt":null,"createdAt":"2026-01-01T00:00:00.000Z","updatedAt":"2026-01-01T00:00:00.000Z"}]}
        """.data(using: .utf8)!
        MockURLProtocol.stubs["GET /api/workspaces/w1/voice/sessions"] = .init(statusCode: 200, body: body)

        let sessions = try await client.listVoiceSessions(workspaceId: "w1")
        XCTAssertEqual(sessions.count, 1)
        XCTAssertEqual(sessions[0].id, "vs-1")
    }

    func testGetVoiceSessionUnwrapsTheSessionEnvelope() async throws {
        let body = """
        {"session":{"id":"vs-1","workspaceId":"w1","conversationId":"c1","status":"active","startedAt":"2026-01-01T00:00:00.000Z","endedAt":null,"createdAt":"2026-01-01T00:00:00.000Z","updatedAt":"2026-01-01T00:00:00.000Z"}}
        """.data(using: .utf8)!
        MockURLProtocol.stubs["GET /api/workspaces/w1/voice/sessions/vs-1"] = .init(statusCode: 200, body: body)

        let session = try await client.getVoiceSession(workspaceId: "w1", voiceSessionId: "vs-1")
        XCTAssertEqual(session.id, "vs-1")
    }

    func testSubmitVoiceRequestSendsBase64AudioAndDecodesTheUnwrappedVoiceResponse() async throws {
        let body = """
        {
          "turn": {"id":"turn-1","voiceSessionId":"vs-1","workspaceId":"w1","transcript":{"text":"hello","confidence":1},"responseText":"hi there","createdAt":"2026-01-01T00:00:00.000Z"},
          "audioBase64": "aGkgdGhlcmU=",
          "audioMimeType": "text/plain",
          "intent": {"intent":"chat","confidence":0.5,"parameters":{},"approval":"no_approval_needed","suggestedNextAction":"x"},
          "approvalDecision": {"state":"no_approval_needed","pendingApprovalId":null},
          "workflowSuggestion": null,
          "executionSuggestion": null
        }
        """.data(using: .utf8)!
        MockURLProtocol.stubs["POST /api/workspaces/w1/voice/sessions/vs-1/turns"] = .init(statusCode: 201, body: body)

        let audioData = try XCTUnwrap("hello".data(using: .utf8))
        let response = try await client.submitVoiceRequest(
            workspaceId: "w1", voiceSessionId: "vs-1", audioData: audioData, audioMimeType: "audio/wav", configuration: nil
        )

        XCTAssertEqual(response.turn.transcript.text, "hello")
        XCTAssertEqual(response.turn.responseText, "hi there")
        XCTAssertEqual(response.audioData, "hi there".data(using: .utf8))

        let recorded = try XCTUnwrap(MockURLProtocol.recordedRequests.last)
        let sentBody = try XCTUnwrap(recorded.httpBody)
        let sentJSON = try JSONSerialization.jsonObject(with: sentBody) as? [String: Any]
        XCTAssertEqual(sentJSON?["audioBase64"] as? String, audioData.base64EncodedString())
        XCTAssertEqual(sentJSON?["audioMimeType"] as? String, "audio/wav")
    }

    func testListVoiceTurnsUnwrapsTheTurnsEnvelope() async throws {
        let body = """
        {"turns":[{"id":"turn-1","voiceSessionId":"vs-1","workspaceId":"w1","transcript":{"text":"hello","confidence":1},"responseText":"hi there","createdAt":"2026-01-01T00:00:00.000Z"}]}
        """.data(using: .utf8)!
        MockURLProtocol.stubs["GET /api/workspaces/w1/voice/sessions/vs-1/turns"] = .init(statusCode: 200, body: body)

        let turns = try await client.listVoiceTurns(workspaceId: "w1", voiceSessionId: "vs-1")
        XCTAssertEqual(turns.count, 1)
        XCTAssertEqual(turns[0].responseText, "hi there")
    }

    func testSendMessageDecodesUnwrappedSendMessageResult() async throws {
        let body = """
        {
          "userMessage": {"id":"m1","conversationId":"c1","workspaceId":"w1","role":"user","content":"hi","createdAt":"2026-01-01T00:00:00.000Z"},
          "assistantMessage": {"id":"m2","conversationId":"c1","workspaceId":"w1","role":"assistant","content":"hello","createdAt":"2026-01-01T00:00:00.000Z"},
          "retrievedMemories": [], "retrievedDocumentChunks": [],
          "intent": {"intent":"chat","confidence":0.5,"parameters":{},"approval":"no_approval_needed","suggestedNextAction":"x"},
          "approvalDecision": {"state":"no_approval_needed","pendingApprovalId":null}
        }
        """.data(using: .utf8)!
        MockURLProtocol.stubs["POST /api/workspaces/w1/conversations/c1/messages"] = .init(statusCode: 201, body: body)

        let result = try await client.sendMessage(workspaceId: "w1", conversationId: "c1", content: "hi")
        XCTAssertEqual(result.assistantMessage.content, "hello")
    }
}
