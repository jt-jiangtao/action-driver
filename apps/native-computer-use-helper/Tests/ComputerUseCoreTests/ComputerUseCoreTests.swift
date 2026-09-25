import XCTest
@testable import ComputerUseCore

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
