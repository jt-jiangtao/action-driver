import XCTest
@testable import ComputerUseCore

private final class RecordingPermissionGate: SystemPermissionGate {
    var requests: [Bool] = []
    func accessibility(prompt: Bool) -> Bool { requests.append(prompt); return prompt }
    func screenRecording(prompt: Bool) -> Bool { requests.append(prompt); return prompt }
    func eventPosting(prompt: Bool) -> Bool { requests.append(prompt); return prompt }
}

final class ComputerUseCoreTests: XCTestCase {
    func testRejectsUnknownOperationBeforeNativeExecution() throws {
        let line = #"{"version":1,"requestId":"bad-1","deadlineUnixMs":9999999999999,"operation":"run-script","script":"echo unsafe"}"#
        XCTAssertThrowsError(try ComputerUseRequest.decode(line: line))
    }

    func testRejectsClickWithoutObservation() throws {
        let line = #"{"version":1,"requestId":"click-1","deadlineUnixMs":9999999999999,"operation":"act","action":{"type":"click","x":100,"y":200}}"#
        XCTAssertThrowsError(try ComputerUseRequest.decode(line: line))
    }

    func testPermissionProbeReportsEachRequiredCapability() async throws {
        let line = #"{"version":1,"requestId":"permissions-1","deadlineUnixMs":9999999999999,"operation":"permissions"}"#
        let request = try ComputerUseRequest.decode(line: line)
        let result = try await NativeComputerUseService().execute(request)
        XCTAssertNotNil(result["accessibility"] as? Bool)
        XCTAssertNotNil(result["screenRecording"] as? Bool)
        XCTAssertNotNil(result["eventPosting"] as? Bool)
    }

    func testPermissionProbeCarriesThePromptFlag() throws {
        let quiet = #"{"version":1,"requestId":"permissions-quiet","deadlineUnixMs":9999999999999,"operation":"permissions"}"#
        let prompting = #"{"version":1,"requestId":"permissions-prompt","deadlineUnixMs":9999999999999,"operation":"permissions","prompt":true}"#
        XCTAssertEqual(try ComputerUseRequest.decode(line: quiet).prompt, nil)
        XCTAssertEqual(try ComputerUseRequest.decode(line: prompting).prompt, true)
        let invalid = #"{"version":1,"requestId":"permissions-bad","deadlineUnixMs":9999999999999,"operation":"permissions","prompt":"yes"}"#
        XCTAssertThrowsError(try ComputerUseRequest.decode(line: invalid))
    }

    func testPromptedPermissionProbeRequestsEveryCapability() async throws {
        let gate = RecordingPermissionGate()
        let service = NativeComputerUseService(permissions: gate)
        let quiet = try ComputerUseRequest.decode(
            line: #"{"version":1,"requestId":"quiet","deadlineUnixMs":9999999999999,"operation":"permissions"}"#)
        _ = try await service.execute(quiet)
        XCTAssertEqual(gate.requests, [false, false, false])

        gate.requests = []
        let prompting = try ComputerUseRequest.decode(
            line: #"{"version":1,"requestId":"prompt","deadlineUnixMs":9999999999999,"operation":"permissions","prompt":true}"#)
        let result = try await service.execute(prompting)
        XCTAssertEqual(gate.requests, [true, true, true])
        XCTAssertEqual(result["permissionTarget"] as? String, "Action-Driver Computer Use")
    }

    func testTargetedPromptOnlyRequestsTheNamedCapability() async throws {
        let gate = RecordingPermissionGate()
        let service = NativeComputerUseService(permissions: gate)
        let request = try ComputerUseRequest.decode(
            line: #"{"version":1,"requestId":"target","deadlineUnixMs":9999999999999,"operation":"permissions","prompt":true,"target":"screenRecording"}"#)
        _ = try await service.execute(request)
        XCTAssertEqual(gate.requests, [false, true, false])

        let unknown = #"{"version":1,"requestId":"target-bad","deadlineUnixMs":9999999999999,"operation":"permissions","prompt":true,"target":"microphone"}"#
        XCTAssertThrowsError(try ComputerUseRequest.decode(line: unknown))
    }

    func testWireReturnsStructuredPermissionResponse() async throws {
        let wire = ComputerUseWire(service: NativeComputerUseService())
        let line = #"{"version":1,"requestId":"permissions-2","deadlineUnixMs":9999999999999,"operation":"permissions"}"#
        let response = await wire.handle(line: line)
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(response.utf8)) as? [String: Any])
        XCTAssertEqual(object["version"] as? Int, 1)
        XCTAssertEqual(object["requestId"] as? String, "permissions-2")
        XCTAssertEqual(object["ok"] as? Bool, true)
        XCTAssertNotNil((object["result"] as? [String: Any])?["accessibility"] as? Bool)
    }
    func testDecodesApplicationPolicyWithoutAnObservation() throws {
        let line = #"{"version":1,"requestId":"policy","deadlineUnixMs":9999999999999,"operation":"app-policy","app":"com.apple.Notes"}"#
        let request = try ComputerUseRequest.decode(line: line)
        XCTAssertEqual(request.operation.rawValue, "app-policy")
        XCTAssertEqual(request.app, "com.apple.Notes")
    }

    func testDecodesSessionScopedIndexedAction() throws {
        let line = #"{"version":1,"requestId":"indexed","deadlineUnixMs":9999999999999,"operation":"act","sessionId":"s1","app":"com.apple.Notes","action":{"type":"click-element","elementIndex":3}}"#
        let request = try ComputerUseRequest.decode(line: line)
        XCTAssertEqual(request.app, "com.apple.Notes")
        XCTAssertNotNil(request.action)
        XCTAssertNil(request.action?.elementRef)
    }

    func testDecodesSessionScopedObservationWithScreenshotFlag() throws {
        let line = #"{"version":1,"requestId":"app-state","deadlineUnixMs":9999999999999,"operation":"app-state","sessionId":"s1","app":"com.apple.Notes","maxElements":200,"maxDepth":8,"screenshot":true}"#
        XCTAssertNoThrow(try ComputerUseRequest.decode(line: line))
    }

    func testRejectsMalformedIndexedTargets() throws {
        for invalid: Any in [-1, 1.5, true, 1_000_001] {
            let object: [String: Any] = ["version": 1, "requestId": "indexed", "deadlineUnixMs": 9999999999999,
                                        "operation": "act", "sessionId": "s1", "app": "com.apple.Notes",
                                        "action": ["type": "click-element", "elementIndex": invalid]]
            let line = String(decoding: try JSONSerialization.data(withJSONObject: object), as: UTF8.self)
            XCTAssertThrowsError(try ComputerUseRequest.decode(line: line), line)
        }
    }

    func testRejectsNumericScreenshotFlag() throws {
        let line = #"{"version":1,"requestId":"app-state","deadlineUnixMs":9999999999999,"operation":"app-state","sessionId":"s1","app":"com.apple.Notes","maxElements":200,"maxDepth":8,"screenshot":1}"#
        XCTAssertThrowsError(try ComputerUseRequest.decode(line: line))
    }

    func testKeepsIndexedMouseOptionsAndScrollTarget() throws {
        let actions: [[String: Any]] = [
            ["type": "click-element", "elementIndex": 7, "mouseButton": "right", "clickCount": 2],
            ["type": "scroll", "elementIndex": 9, "deltaX": 0, "deltaY": 100],
            ["type": "scroll", "x": 12, "y": 34, "deltaX": 0, "deltaY": 100]
        ]
        let expectedIndices: [Int?] = [7, 9, nil]
        for (index, action) in actions.enumerated() {
            let object: [String: Any] = ["version": 1, "requestId": "indexed", "deadlineUnixMs": 9999999999999,
                                        "operation": "act", "sessionId": "s1", "app": "com.apple.Notes", "action": action]
            let line = String(decoding: try JSONSerialization.data(withJSONObject: object), as: UTF8.self)
            let parsed = try XCTUnwrap(ComputerUseRequest.decode(line: line).action)
            XCTAssertEqual(parsed.elementIndex, expectedIndices[index])
            if index == 0 { XCTAssertEqual(parsed.mouseButton, "right"); XCTAssertEqual(parsed.clickCount, 2) }
            if index == 2 { XCTAssertEqual(parsed.x, 12); XCTAssertEqual(parsed.y, 34) }
        }
    }

}
