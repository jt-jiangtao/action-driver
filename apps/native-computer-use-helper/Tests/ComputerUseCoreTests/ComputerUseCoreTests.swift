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

    func testInvalidatesCoordinatesAfterFrontmostAppChanges() throws {
        let gate = ObservationGate()
        let reference = gate.record(pid: 42, windowId: 7)
        XCTAssertNoThrow(try gate.validate(observationId: reference, pid: 42, windowId: 7))
        XCTAssertThrowsError(try gate.validate(observationId: reference, pid: 43, windowId: 8))
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
        XCTAssertEqual(result["permissionTarget"] as? String, "ActionDriver Computer Use")
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
}
