import XCTest
@testable import ComputerUseCore

final class AccessibilityStateTextTests: XCTestCase {
    func testDiffKeepsStableIndexesEvenWhenTwoButtonsHaveIdenticalLabels() {
        XCTAssertEqual(AccessibilityStateText.diff(previous: "[1] AXButton Save", current: "[2] AXButton Save"),
            "- [1] AXButton Save\n+ [2] AXButton Save")
    }
    func testRenderedStateIncludesTextValueAndEscapesNewlines() {
        let text = AccessibilityStateText.render(["elementIndex": 7, "role": "AXTextField",
            "title": "Search", "value": "hello\nworld"])
        XCTAssertTrue(text.contains("[7]"))
        XCTAssertTrue(text.contains("hello\\nworld"))
        XCTAssertEqual(text.split(separator: "\n").count, 1)
    }
    func testNoChangesAndRemovedLinesHaveDeterministicOrder() {
        XCTAssertEqual(AccessibilityStateText.diff(previous: "a\nb\na", current: "b"), "- a\n- a")
        XCTAssertEqual(AccessibilityStateText.diff(previous: "a", current: "a"), "no changes since the previous state")
    }
}
