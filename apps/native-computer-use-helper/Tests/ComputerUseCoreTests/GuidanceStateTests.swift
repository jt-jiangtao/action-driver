import XCTest
@testable import ComputerUseCore

final class GuidanceStateTests: XCTestCase {
    func testRequestingAMissingCapabilityWaitsForSystemSettings() {
        var state = GuidanceSnapshot(accessibility: false, screenRecording: true)
        state.recordRequest(.accessibility, granted: false)
        XCTAssertEqual(state.pending, .accessibility)
        XCTAssertTrue(state.waitingForSystem)
        XCTAssertTrue(state.guided)
        XCTAssertFalse(state.authorized)
        XCTAssertFalse(state.shouldClose)
    }

    func testAnAlreadyGrantedCapabilityNeverWaitsAndClosesOnceComplete() {
        var state = GuidanceSnapshot(accessibility: false, screenRecording: true)
        state.recordRequest(.accessibility, granted: true)
        XCTAssertNil(state.pending)
        XCTAssertTrue(state.authorized)
        XCTAssertTrue(state.shouldClose)
    }

    func testALandedGrantClearsThePendingCard() {
        var state = GuidanceSnapshot()
        state.recordRequest(.screenRecording, granted: false)
        state.apply(accessibility: false, screenRecording: true)
        XCTAssertNil(state.pending)
        XCTAssertFalse(state.waitingForSystem)
        XCTAssertFalse(state.shouldClose)

        state.apply(accessibility: true, screenRecording: true)
        XCTAssertTrue(state.shouldClose)
    }
}
