import XCTest
@testable import ComputerUseCore

final class ApplicationPolicyTests: XCTestCase {
    private func request(_ app: String) throws -> ComputerUseRequest {
        let object: [String: Any] = ["version": 1, "requestId": "policy", "deadlineUnixMs": 9999999999999,
                                    "operation": "app-policy", "app": app]
        return try ComputerUseRequest.decode(line: String(decoding: JSONSerialization.data(withJSONObject: object), as: UTF8.self))
    }

    func testTerminalPolicyIsForbiddenWithoutLaunchingTheApplication() async throws {
        let result = try await NativeComputerUseService().execute(request("com.apple.Terminal"))
        XCTAssertEqual(result["decision"] as? String, "forbidden")
        XCTAssertEqual(result["allowPersistentApproval"] as? Bool, false)
        let target = try XCTUnwrap(result["target"] as? [String: Any])
        XCTAssertEqual(target["bundleId"] as? String, "com.apple.Terminal")
        XCTAssertNotNil(target["appPath"] as? String)
    }

    func testNotesCanBePersistentlyAuthorizedAndSafariCannot() async throws {
        let service = NativeComputerUseService()
        let notes = try await service.execute(request("com.apple.Notes"))
        XCTAssertEqual(notes["decision"] as? String, "allowed")
        XCTAssertEqual(notes["allowPersistentApproval"] as? Bool, true)
        let safari = try await service.execute(request("com.apple.Safari"))
        XCTAssertEqual(safari["decision"] as? String, "allowed")
        XCTAssertEqual(safari["allowPersistentApproval"] as? Bool, false)
        let target = try XCTUnwrap(safari["target"] as? [String: Any])
        XCTAssertEqual(target["risk"] as? String, "high")
        XCTAssertFalse((target["warningSubtitle"] as? String ?? "").isEmpty)
    }

    func testRejectsApplicationPathsOutsideTheStandardDirectories() async throws {
        do {
            _ = try await NativeComputerUseService().execute(request("/tmp/Untrusted.app"))
            XCTFail("An arbitrary app path must not reach native execution")
        } catch let error as ComputerUseError {
            guard case .invalidRequest = error else { return XCTFail("Unexpected error: \(error)") }
        }
    }
}

extension ApplicationPolicyTests {
    func testOrganizationPolicyDeniesNotesAndCannotOverrideForbidden() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let policy = directory.appendingPathComponent("policy.json")
        try Data(#"{"deniedBundleIds":["com.apple.Notes","com.apple.Terminal"]}"#.utf8).write(to: policy)
        let service = NativeComputerUseService(organizationPolicyURL: policy)
        let notes = try await service.execute(request("com.apple.Notes"))
        XCTAssertEqual(notes["decision"] as? String, "denied")
        XCTAssertEqual(notes["allowPersistentApproval"] as? Bool, false)
        let terminal = try await service.execute(request("com.apple.Terminal"))
        XCTAssertEqual(terminal["decision"] as? String, "forbidden")
    }

    func testMalformedOrganizationPolicyFailsClosed() async throws {
        let file = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: file) }
        try Data("{}".utf8).write(to: file)
        do {
            _ = try await NativeComputerUseService(organizationPolicyURL: file).execute(request("com.apple.Notes"))
            XCTFail("Invalid policy must not silently allow an application")
        } catch { }
    }
}

extension ApplicationPolicyTests {
    /// ActionDriver ships as a renamed Electron.app, so it is recognized by path, never by bundle id:
    /// the model must not drive the app that shows its own approval cards.
    func testTheOwningApplicationIsForbiddenWhateverItsBundleIdentifier() throws {
        let owner = URL(fileURLWithPath: "/System/Applications/Calculator.app")
        let policy = ApplicationPolicy(
            organizationPolicyURL: URL(fileURLWithPath: "/nonexistent/policy.json"),
            ownerApplications: [owner])
        let result = try policy.evaluate("com.apple.calculator")
        XCTAssertEqual(result["decision"] as? String, "forbidden")
        XCTAssertEqual(result["allowPersistentApproval"] as? Bool, false)
        let notes = try policy.evaluate("com.apple.Notes")
        XCTAssertEqual(notes["decision"] as? String, "allowed")
    }

    func testFindsTheApplicationThatContainsAPackagedHelper() {
        let helper = URL(fileURLWithPath:
            "/Applications/ActionDriver.app/Contents/Helpers/ActionDriver Computer Use.app")
        XCTAssertEqual(ApplicationPolicy.containingApplication(of: helper)?.path,
                       "/Applications/ActionDriver.app")
        XCTAssertNil(ApplicationPolicy.containingApplication(of: URL(fileURLWithPath:
            "/Users/dev/action-driver/plugins/computer-use/native/dist/arm64/ActionDriver Computer Use.app")))
    }
}

extension ApplicationPolicyTests {
    private var plainPolicy: ApplicationPolicy {
        ApplicationPolicy(organizationPolicyURL: URL(fileURLWithPath: "/nonexistent/policy.json"))
    }

    func testRejectsPathsThatClimbOutOfTheStandardDirectories() {
        for path in ["/Applications/../tmp/Untrusted.app", "/System/Applications/../../private/tmp/X.app",
                     "~/../../tmp/Y.app"] {
            XCTAssertThrowsError(try plainPolicy.resolve(path), path) { error in
                guard case ComputerUseError.invalidRequest = error else { return XCTFail("\(path): \(error)") }
            }
        }
    }

    func testResolvesDisplayNamesCaseInsensitivelyAndRejectsUnknownNames() throws {
        XCTAssertEqual(try plainPolicy.resolve("notes").lastPathComponent, "Notes.app")
        XCTAssertEqual(try plainPolicy.resolve("com.apple.Notes").lastPathComponent, "Notes.app")
        XCTAssertThrowsError(try plainPolicy.resolve("Definitely Not An Installed App 7c1e"))
    }

    /// Finder is a registered application, so its display name resolves even though it lives in
    /// CoreServices. The path branch stays limited to the three standard directories (D10).
    func testResolvesCoreServicesDisplayNamesWithoutWideningThePathAllowlist() throws {
        XCTAssertEqual(try plainPolicy.resolve("finder").lastPathComponent, "Finder.app")
        XCTAssertThrowsError(try plainPolicy.resolve("/System/Library/CoreServices/Finder.app"))
    }
}
