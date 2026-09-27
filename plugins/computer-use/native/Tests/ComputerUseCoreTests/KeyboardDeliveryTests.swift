import XCTest
@testable import ComputerUseCore

final class KeyboardDeliveryTests: XCTestCase {
    /// Keyboard events posted to a background app have no receipt (D6 keyboard ruling).
    func testBackgroundInputIsDeliveredButNotConfirmed() {
        let result = KeyboardDelivery.result(app: "com.tencent.xinWeChat", pid: 42, frontmostPID: 7)
        XCTAssertEqual(result["executed"] as? Bool, false)
        XCTAssertEqual(result["delivered"] as? Bool, true)
        XCTAssertEqual(result["app"] as? String, "com.tencent.xinWeChat")
    }

    func testForegroundInputStaysExecuted() {
        let result = KeyboardDelivery.result(app: "com.apple.Notes", pid: 42, frontmostPID: 42)
        XCTAssertEqual(result["executed"] as? Bool, true)
        XCTAssertNil(result["delivered"])
    }
}
