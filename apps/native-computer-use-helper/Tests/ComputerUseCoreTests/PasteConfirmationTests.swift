import XCTest
@testable import ComputerUseCore

/// 1.6: a paste is confirmed only by an observable change in the target application, never by the
/// posted keystroke or the pasteboard change count.
final class PasteConfirmationTests: XCTestCase {
    func testUnchangedOrUnavailableValueNeverConfirms() {
        var confirmation = PasteConfirmation(baseline: "hello")
        XCTAssertFalse(confirmation.observe("hello"))
        XCTAssertFalse(confirmation.observe(nil))
        XCTAssertFalse(confirmation.observe("hello"))
        XCTAssertEqual(confirmation.changedSamples, 0)

        var unreadable = PasteConfirmation(baseline: nil)
        XCTAssertFalse(unreadable.observe("anything"))
        XCTAssertFalse(unreadable.observe("anything"))
    }

    func testConfirmsOnlyAfterTwoIdenticalChangedSamples() {
        var confirmation = PasteConfirmation(baseline: "hello")
        XCTAssertFalse(confirmation.observe("hello world"), "the first change may still be mid-insert")
        XCTAssertTrue(confirmation.observe("hello world"))
        XCTAssertEqual(confirmation.changedSamples, 2)
    }

    func testAStillChangingValueRestartsTheConfirmation() {
        var confirmation = PasteConfirmation(baseline: "hello")
        XCTAssertFalse(confirmation.observe("hello wor"))
        XCTAssertFalse(confirmation.observe("hello world"), "a new value restarts the streak")
        XCTAssertTrue(confirmation.observe("hello world"))
    }

    func testTypedTextThatReplacesTheValueCountsAsACompletedPaste() {
        var confirmation = PasteConfirmation(baseline: "old contents")
        XCTAssertFalse(confirmation.observe("new contents"))
        XCTAssertTrue(confirmation.observe("new contents"))
    }
}
