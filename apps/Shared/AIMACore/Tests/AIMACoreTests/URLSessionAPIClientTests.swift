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
        {"status":"ok","timestamp":"2026-01-01T00:00:00.000Z","checks":{"database":{"status":"ok","detail":null},"aiProvider":{"status":"ok","detail":"mock"},"memory":{"status":"ok","detail":null},"knowledge":{"status":"ok","detail":null}}}
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
