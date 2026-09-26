import XCTest
@testable import ComputerUseCore

/// 1.5: capturing and coordinate mapping must use the window the user is working in, not whichever
/// window the system lists first (TextEdit also reports its menu bar as a layer-0 window).
final class WindowSelectionTests: XCTestCase {
    private let menuBar = WindowCandidate(id: 1, frame: CGRect(x: 0, y: 0, width: 1512, height: 33))
    private let document = WindowCandidate(id: 2, frame: CGRect(x: 152, y: 73, width: 656, height: 422))

    func testFocusedWindowWinsEvenThoughItIsNotTheLargest() {
        XCTAssertEqual(WindowSelection.pick(candidates: [menuBar, document], focused: document.frame),
                       document.id)
    }

    func testLargestWindowIsUsedWhenThereIsNoFocusedFrame() {
        XCTAssertEqual(WindowSelection.pick(candidates: [menuBar, document], focused: nil), document.id)
        XCTAssertEqual(WindowSelection.pick(candidates: [menuBar, document],
                                            focused: CGRect(x: 900, y: 900, width: 10, height: 10)),
                       document.id)
    }

    func testASingleCandidateIsPickedRegardlessOfSize() {
        XCTAssertEqual(WindowSelection.pick(candidates: [menuBar], focused: nil), menuBar.id)
        XCTAssertNil(WindowSelection.pick(candidates: [], focused: document.frame))
    }
}
