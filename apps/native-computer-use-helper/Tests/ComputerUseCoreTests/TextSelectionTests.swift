import XCTest
@testable import ComputerUseCore

final class TextSelectionTests: XCTestCase {
    func testSelectionUsesUTF16OffsetsForEmojiAndCombiningCharacters() {
        XCTAssertEqual(TextSelection.range(in: "😀e\u{301}目标结束", text: "目标"),
                       NSRange(location: 4, length: 2))
        XCTAssertEqual(TextSelection.range(in: "前👨‍👩‍👧‍👦后", text: "👨‍👩‍👧‍👦"),
                       NSRange(location: 1, length: 11))
    }

    func testCursorOffsetsAndRepeatedTextDisambiguation() {
        let value = "😀甲目标乙😀丙目标丁"
        XCTAssertEqual(TextSelection.range(in: value, text: "目标", prefix: "丙", suffix: "丁"),
                       NSRange(location: 9, length: 2))
        XCTAssertEqual(TextSelection.range(in: "😀目标", text: "目标", selectionType: "cursor-before"),
                       NSRange(location: 2, length: 0))
        XCTAssertEqual(TextSelection.range(in: "😀目标", text: "目标", selectionType: "cursor-after"),
                       NSRange(location: 4, length: 0))
        XCTAssertNil(TextSelection.range(in: value, text: "目标", prefix: "不存在"))
        XCTAssertNil(TextSelection.range(in: value, text: ""))
    }
}
