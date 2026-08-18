import XCTest
@testable import AIMACore

/// Alpha Launch sprint: verifies `APIConfiguration.resolved`/`save`'s precedence — the fix that lets a physical
/// iPhone (no launch-time environment variables outside an Xcode-tethered debug run) keep a durable, user-set
/// backend address across relaunches instead of reverting to `developmentDefault`'s useless-on-device `127.0.0.1`.
final class APIConfigurationTests: XCTestCase {
    /// A throwaway suite per test, never `.standard` — isolates these tests from each other and from anything
    /// else in the process that might read/write real user defaults.
    private func makeDefaults(_ name: String = #function) -> UserDefaults {
        let suiteName = "APIConfigurationTests.\(name).\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suiteName)!
        addTeardownBlock { defaults.removePersistentDomain(forName: suiteName) }
        return defaults
    }

    func testResolvedFallsBackToDevelopmentDefaultWhenNothingIsSet() {
        let defaults = makeDefaults()

        let configuration = APIConfiguration.resolved(environment: [:], userDefaults: defaults)

        XCTAssertEqual(configuration, .developmentDefault)
    }

    func testResolvedUsesTheSavedValueWhenNoEnvironmentVariableIsSet() {
        let defaults = makeDefaults()
        APIConfiguration.save(baseURL: URL(string: "http://192.168.1.42:4000")!, to: defaults)

        let configuration = APIConfiguration.resolved(environment: [:], userDefaults: defaults)

        XCTAssertEqual(configuration.baseURL, URL(string: "http://192.168.1.42:4000")!)
    }

    func testResolvedPrefersTheEnvironmentVariableOverASavedValue() {
        let defaults = makeDefaults()
        APIConfiguration.save(baseURL: URL(string: "http://192.168.1.42:4000")!, to: defaults)

        let configuration = APIConfiguration.resolved(
            environment: ["AIMA_API_BASE_URL": "http://10.0.0.5:4000"],
            userDefaults: defaults
        )

        XCTAssertEqual(configuration.baseURL, URL(string: "http://10.0.0.5:4000")!)
    }

    func testSavedValuePersistsAcrossIndependentResolvedCalls() {
        let defaults = makeDefaults()

        APIConfiguration.save(baseURL: URL(string: "http://aima.local:4000")!, to: defaults)
        let first = APIConfiguration.resolved(environment: [:], userDefaults: defaults)
        let second = APIConfiguration.resolved(environment: [:], userDefaults: defaults)

        XCTAssertEqual(first.baseURL, URL(string: "http://aima.local:4000")!)
        XCTAssertEqual(second.baseURL, first.baseURL, "a saved value must survive independent resolution calls, i.e. an app relaunch")
    }

    func testResolvedIgnoresAMalformedSavedValue() {
        let defaults = makeDefaults()
        // `URL(string:)` reliably returns nil for an empty string — a real, if unlikely, way a saved default
        // could end up malformed (e.g. a bug elsewhere writing an empty string instead of removing the key).
        defaults.set("", forKey: "AIMA_API_BASE_URL")

        let configuration = APIConfiguration.resolved(environment: [:], userDefaults: defaults)

        XCTAssertEqual(configuration, .developmentDefault)
    }
}
