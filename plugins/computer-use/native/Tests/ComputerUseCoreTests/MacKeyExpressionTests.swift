import Carbon.HIToolbox
import CoreGraphics
import XCTest
@testable import ComputerUseCore

final class MacKeyExpressionTests: XCTestCase {
    func testParsesModifierAliasesAndFullKeySequence() throws {
        let keys = try MacKeyExpression.parse("ctrl+shift+KP_Enter super+c F12")
        XCTAssertEqual(keys.map(\.code), [CGKeyCode(kVK_ANSI_KeypadEnter), CGKeyCode(kVK_ANSI_C), CGKeyCode(kVK_F12)])
        XCTAssertTrue(keys[0].flags.contains([.maskControl, .maskShift]))
        XCTAssertTrue(keys[1].flags.contains(.maskCommand))
    }
    func testDistinguishesForwardDeleteAndBackspaceAndSupportsNumpad() throws {
        let keys = try MacKeyExpression.parse("BackSpace Delete KP_0 KP_Add Page_Down")
        XCTAssertEqual(keys.map(\.code), [CGKeyCode(kVK_Delete), CGKeyCode(kVK_ForwardDelete),
            CGKeyCode(kVK_ANSI_Keypad0), CGKeyCode(kVK_ANSI_KeypadPlus), CGKeyCode(kVK_PageDown)])
    }
    func testUppercaseAndShiftedSymbolsKeepTheirRequiredShift() throws {
        let keys = try MacKeyExpression.parse("A exclam plus question")
        XCTAssertEqual(keys.map(\.code), [CGKeyCode(kVK_ANSI_A), CGKeyCode(kVK_ANSI_1),
            CGKeyCode(kVK_ANSI_Equal), CGKeyCode(kVK_ANSI_Slash)])
        XCTAssertTrue(keys.allSatisfy { $0.flags.contains(.maskShift) })
    }
    func testRejectsWholeExpressionBeforeAnyUnsupportedKeyCanExecute() {
        for expression in ["", "a definitely_unknown", "ctrl++a", "--clearmodifiers a"] {
            XCTAssertThrowsError(try MacKeyExpression.parse(expression))
        }
    }
}
