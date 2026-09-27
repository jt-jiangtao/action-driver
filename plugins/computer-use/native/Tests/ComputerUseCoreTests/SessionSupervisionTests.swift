import XCTest
@testable import ComputerUseCore

/// D7: the overlay follows the supervised session, Esc ends it, and foreign input only counts
/// while an action is executing.
final class SessionSupervisionTests: XCTestCase {
    func testStartShowsOverlayOnlyWhenTheOwnerChanges() {
        var state = SessionSupervisionState()
        XCTAssertNil(state.visibleSession)
        XCTAssertTrue(state.start("session-a"), "the first start shows the overlay")
        XCTAssertEqual(state.visibleSession, "session-a")
        XCTAssertFalse(state.start("session-a"), "an already supervised session needs no re-show")
        XCTAssertEqual(state.visibleSession, "session-a")
    }

    func testEndHidesOnlyTheOverlayOfThatSession() {
        var state = SessionSupervisionState()
        state.start("session-a")
        state.start("session-b")
        XCTAssertEqual(state.visibleSession, "session-b")
        XCTAssertFalse(state.end("session-a"))
        XCTAssertEqual(state.visibleSession, "session-b")
        XCTAssertTrue(state.end("session-b"))
        XCTAssertNil(state.visibleSession)
    }

    func testEscapeStopsTheCurrentSessionAndKeepsOthers() {
        var state = SessionSupervisionState()
        state.start("session-a")
        state.start("session-b")
        XCTAssertEqual(state.note(.escape), "session-b")
        XCTAssertTrue(state.isStopped("session-b"))
        XCTAssertFalse(state.isStopped("session-a"))
        XCTAssertEqual(state.visibleSession, "session-a")
        XCTAssertEqual(state.interruption("session-b"), .userStoppedSession)
        XCTAssertNil(state.interruption("session-a"))
    }

    func testStoppedSessionIsNotRevivedByAnImplicitStart() {
        var state = SessionSupervisionState()
        state.start("session-a")
        state.note(.escape)
        XCTAssertFalse(state.ensure("session-a"), "an action must not revive a stopped session")
        XCTAssertNil(state.visibleSession)
        XCTAssertEqual(state.interruption("session-a"), .userStoppedSession)
    }

    func testDeliberateStartClearsAnEarlierEscapeStop() {
        var state = SessionSupervisionState()
        state.start("session-a")
        state.note(.escape)
        state.start("session-a")
        XCTAssertFalse(state.isStopped("session-a"))
        XCTAssertTrue(state.ensure("session-a"))
        XCTAssertEqual(state.visibleSession, "session-a")
    }

    func testEndingASessionDropsItsEscapeStop() {
        var state = SessionSupervisionState()
        state.start("session-a")
        state.note(.escape)
        XCTAssertTrue(state.isStopped("session-a"))
        state.end("session-a")
        XCTAssertFalse(state.isStopped("session-a"))
    }

    func testForeignInputOnlyInterruptsWhileAnActionRuns() {
        var state = SessionSupervisionState()
        state.start("session-a")
        state.note(.externalInput)
        XCTAssertNil(state.interruption("session-a"), "idle user input is not an interruption")
        state.beginAction()
        state.note(.externalInput)
        XCTAssertEqual(state.interruption("session-a"), .userIntervened)
        state.endAction()
        XCTAssertNil(state.interruption("session-a"))
    }

    func testEscapeDuringAnActionStopsTheSession() {
        var state = SessionSupervisionState()
        state.start("session-a")
        state.beginAction()
        state.note(.escape)
        XCTAssertEqual(state.interruption("session-a"), .userStoppedSession)
        XCTAssertNil(state.visibleSession)
    }

    func testConcurrentHoldersShareOneState() {
        let supervision = SessionSupervision()
        supervision.update { $0.start("session-a") }
        XCTAssertEqual(supervision.read { $0.visibleSession }, "session-a")
        XCTAssertEqual(supervision.userStopped(), "session-a")
        XCTAssertTrue(supervision.isStopped("session-a"))
    }
}
