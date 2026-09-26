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

    func testALandedGrantClearsThePendingCardAndAsksTheWindowToFlyBack() {
        var state = GuidanceSnapshot()
        state.recordRequest(.screenRecording, granted: false)
        let waiting = state
        state.apply(accessibility: false, screenRecording: true)
        XCTAssertNil(state.pending)
        XCTAssertTrue(state.shouldReturnFromEdge(previous: waiting))
        XCTAssertFalse(state.shouldClose)

        state.apply(accessibility: true, screenRecording: true)
        XCTAssertTrue(state.shouldClose)
    }

    func testWaitingStateDoesNotAskToReturnBeforeAGrantLands() {
        var state = GuidanceSnapshot()
        state.recordRequest(.accessibility, granted: false)
        XCTAssertFalse(state.shouldReturnFromEdge(previous: state))
    }
}
