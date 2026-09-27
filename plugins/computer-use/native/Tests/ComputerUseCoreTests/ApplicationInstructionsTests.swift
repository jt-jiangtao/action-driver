import XCTest
@testable import ComputerUseCore

final class ApplicationInstructionsTests: XCTestCase {
    func testLoadsBundledExamplesByExactBundleIdentifier() throws {
        XCTAssertFalse(try XCTUnwrap(ApplicationInstructions.forApp("com.apple.finder")).isEmpty)
        XCTAssertFalse(try XCTUnwrap(ApplicationInstructions.forApp("com.apple.Notes")).isEmpty)
        XCTAssertNil(ApplicationInstructions.forApp("unknown.app"))
        XCTAssertNil(ApplicationInstructions.forApp("../com.apple.finder"))
    }
}
