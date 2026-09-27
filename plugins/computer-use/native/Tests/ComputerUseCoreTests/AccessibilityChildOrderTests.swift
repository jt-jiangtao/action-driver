import XCTest
@testable import ComputerUseCore

final class AccessibilityChildOrderTests: XCTestCase {
    /// The element budget must reach the app's windows: an app's menu bar alone can hold hundreds of
    /// menu items, so it goes last and the focused window first.
    func testWindowsComeFirstFocusedFirstAndTheMenuBarLast() {
        let children = ["menubar", "window-a", "sheet", "window-b", "extras"]
        let roles = ["menubar": "AXMenuBar", "window-a": "AXWindow", "sheet": "AXSheet",
                     "window-b": "AXWindow", "extras": "AXMenuBar"]
        let ordered = AccessibilityChildOrder.prioritized(children,
            role: { roles[$0] }, isFocused: { $0 == "window-b" })
        XCTAssertEqual(ordered, ["window-b", "window-a", "sheet", "menubar", "extras"])
    }

    func testKeepsTheOriginalOrderWhenNothingIsPrioritized() {
        let children = ["one", "two", "three"]
        XCTAssertEqual(AccessibilityChildOrder.prioritized(children,
            role: { _ in "AXButton" }, isFocused: { _ in false }), children)
    }
}
