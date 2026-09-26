import XCTest
@testable import ComputerUseCore

final class ElementClickDispatcherTests: XCTestCase {
    func testFailedAXPressNeverRetriesWithCoordinates() {
        var presses = 0, fallbacks = 0
        XCTAssertThrowsError(try ElementClickDispatcher.perform(preferAX: true, hasAXPress: true,
            press: { presses += 1; return false }, fallback: { fallbacks += 1 }))
        XCTAssertEqual(presses, 1)
        XCTAssertEqual(fallbacks, 0)
    }
    func testMissingAXPressUsesOnlyTheForegroundCheckedFallback() throws {
        var presses = 0, fallbacks = 0
        try ElementClickDispatcher.perform(preferAX: true, hasAXPress: false,
            press: { presses += 1; return true }, fallback: { fallbacks += 1 })
        XCTAssertEqual(presses, 0)
        XCTAssertEqual(fallbacks, 1)
    }
}
