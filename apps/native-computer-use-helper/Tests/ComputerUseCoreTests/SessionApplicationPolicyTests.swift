import Foundation
import XCTest
@testable import ComputerUseCore

final class SessionApplicationPolicyTests: XCTestCase {
    func testSessionReadAndActionRejectForbiddenAppBeforePermissionOrLaunch() async throws {
        let wire = ComputerUseWire(service: NativeComputerUseService())
        for operation in ["app-state", "act"] {
            var object: [String: Any] = ["version": 1, "requestId": operation,
                "deadlineUnixMs": Int64(Date().timeIntervalSince1970 * 1000) + 30_000,
                "operation": operation, "sessionId": "session", "app": "com.apple.Terminal"]
            if operation == "app-state" { object["maxElements"] = 300; object["maxDepth"] = 12 }
            if operation == "act" { object["action"] = ["type": "click-element", "elementIndex": 0] }
            let line = String(decoding: try JSONSerialization.data(withJSONObject: object), as: UTF8.self)
            let reply = await wire.handle(line: line)
            let response = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(reply.utf8)) as? [String: Any])
            let error = try XCTUnwrap(response["error"] as? [String: Any])
            XCTAssertEqual(error["code"] as? String, "APP_FORBIDDEN")
        }
    }
}
