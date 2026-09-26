import Foundation
import XCTest
@testable import ComputerUseCore

final class WindowCoordinateTests: XCTestCase {
    func testMapsScreenshotPixelsToWindowPointsIncludingNegativeDisplayOrigins() throws {
        let window = WindowCoordinates(pid: 42, windowID: 7,
            frame: CGRect(x: -1000, y: 200, width: 800, height: 600), pixels: CGSize(width: 1600, height: 1200))
        XCTAssertEqual(try window.point(x: 800, y: 600, foregroundPID: 42, windowID: 7,
            frame: window.frame), CGPoint(x: -600, y: 500))
    }
    func testRejectsBackgroundMovedWindowsAndOutOfBoundsBeforeDispatch() {
        let window = WindowCoordinates(pid: 42, windowID: 7,
            frame: CGRect(x: 10, y: 20, width: 800, height: 600), pixels: CGSize(width: 800, height: 600))
        XCTAssertThrowsError(try window.point(x: 1, y: 1, foregroundPID: 43, windowID: 7, frame: window.frame))
        XCTAssertThrowsError(try window.point(x: 1, y: 1, foregroundPID: 42, windowID: 8, frame: window.frame))
        XCTAssertThrowsError(try window.point(x: 1, y: 1, foregroundPID: 42, windowID: 7, frame: .zero))
        for x in [-1.0, 800, .nan, .infinity] {
            XCTAssertThrowsError(try window.point(x: x, y: 1, foregroundPID: 42, windowID: 7, frame: window.frame))
        }
    }
}
