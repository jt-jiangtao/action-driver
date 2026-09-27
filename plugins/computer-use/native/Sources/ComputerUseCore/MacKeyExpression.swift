import Carbon.HIToolbox
import CoreGraphics

/// Parses a complete key expression before posting any event. No shell or xdotool process.
enum MacKeyExpression {
    struct Key { let code: CGKeyCode; let flags: CGEventFlags }
    static func parse(_ expression: String) throws -> [Key] {
        let chords = expression.split(whereSeparator: { $0.isWhitespace })
        guard !chords.isEmpty else { throw ComputerUseError.invalidRequest("Key expression is empty") }
        return try chords.map { chord in
            let parts = chord.lowercased().split(separator: "+", omittingEmptySubsequences: false)
            guard let name = parts.last, !name.isEmpty,
                  let code = codes[shifted[String(name)] ?? String(name)] else {
                throw ComputerUseError.invalidRequest("Unsupported key in expression")
            }
            var flags: CGEventFlags = []
            let original = chord.split(separator: "+", omittingEmptySubsequences: false).last ?? ""
            if shifted[String(name)] != nil || (original.count == 1 && original.first?.isUppercase == true) {
                flags.insert(.maskShift)
            }
            for modifier in parts.dropLast() {
                switch modifier {
                case "ctrl", "control", "control_l", "control_r": flags.insert(.maskControl)
                case "shift", "shift_l", "shift_r": flags.insert(.maskShift)
                case "alt", "option", "alt_l", "alt_r": flags.insert(.maskAlternate)
                case "super", "cmd", "command", "meta", "super_l", "super_r", "meta_l", "meta_r": flags.insert(.maskCommand)
                default: throw ComputerUseError.invalidRequest("Unsupported key modifier")
                }
            }
            return Key(code: CGKeyCode(code), flags: flags)
        }
    }
    private static let shifted: [String: String] = [
        "exclam": "1", "at": "2", "numbersign": "3", "dollar": "4", "percent": "5",
        "asciicircum": "6", "ampersand": "7", "asterisk": "8", "parenleft": "9", "parenright": "0",
        "underscore": "minus", "plus": "equal", "braceleft": "bracketleft", "braceright": "bracketright",
        "bar": "backslash", "colon": "semicolon", "quotedbl": "apostrophe", "less": "comma",
        "greater": "period", "question": "slash", "asciitilde": "grave"
    ]
    private static let codes: [String: Int] = {
        var result: [String: Int] = [
            "return": kVK_Return, "enter": kVK_Return, "tab": kVK_Tab, "space": kVK_Space,
            "backspace": kVK_Delete, "delete": kVK_ForwardDelete, "escape": kVK_Escape, "esc": kVK_Escape,
            "left": kVK_LeftArrow, "right": kVK_RightArrow, "up": kVK_UpArrow, "down": kVK_DownArrow,
            "home": kVK_Home, "end": kVK_End, "page_up": kVK_PageUp, "page_down": kVK_PageDown,
            "prior": kVK_PageUp, "next": kVK_PageDown, "caps_lock": kVK_CapsLock,
            "kp_enter": kVK_ANSI_KeypadEnter, "kp_add": kVK_ANSI_KeypadPlus,
            "kp_subtract": kVK_ANSI_KeypadMinus, "kp_multiply": kVK_ANSI_KeypadMultiply,
            "kp_divide": kVK_ANSI_KeypadDivide, "kp_decimal": kVK_ANSI_KeypadDecimal,
            "kp_equal": kVK_ANSI_KeypadEquals, "kp_clear": kVK_ANSI_KeypadClear,
            "minus": kVK_ANSI_Minus, "equal": kVK_ANSI_Equal,
            "bracketleft": kVK_ANSI_LeftBracket, "bracketright": kVK_ANSI_RightBracket,
            "backslash": kVK_ANSI_Backslash, "semicolon": kVK_ANSI_Semicolon,
            "apostrophe": kVK_ANSI_Quote, "comma": kVK_ANSI_Comma,
            "period": kVK_ANSI_Period, "slash": kVK_ANSI_Slash, "grave": kVK_ANSI_Grave
        ]
        let letters = [kVK_ANSI_A,kVK_ANSI_B,kVK_ANSI_C,kVK_ANSI_D,kVK_ANSI_E,kVK_ANSI_F,
            kVK_ANSI_G,kVK_ANSI_H,kVK_ANSI_I,kVK_ANSI_J,kVK_ANSI_K,kVK_ANSI_L,kVK_ANSI_M,
            kVK_ANSI_N,kVK_ANSI_O,kVK_ANSI_P,kVK_ANSI_Q,kVK_ANSI_R,kVK_ANSI_S,kVK_ANSI_T,
            kVK_ANSI_U,kVK_ANSI_V,kVK_ANSI_W,kVK_ANSI_X,kVK_ANSI_Y,kVK_ANSI_Z]
        for (letter, code) in zip("abcdefghijklmnopqrstuvwxyz", letters) { result[String(letter)] = code }
        let digits = [kVK_ANSI_0,kVK_ANSI_1,kVK_ANSI_2,kVK_ANSI_3,kVK_ANSI_4,
            kVK_ANSI_5,kVK_ANSI_6,kVK_ANSI_7,kVK_ANSI_8,kVK_ANSI_9]
        let keypad = [kVK_ANSI_Keypad0,kVK_ANSI_Keypad1,kVK_ANSI_Keypad2,kVK_ANSI_Keypad3,
            kVK_ANSI_Keypad4,kVK_ANSI_Keypad5,kVK_ANSI_Keypad6,kVK_ANSI_Keypad7,kVK_ANSI_Keypad8,kVK_ANSI_Keypad9]
        for index in 0...9 { result[String(index)] = digits[index]; result["kp_\(index)"] = keypad[index] }
        let functions = [kVK_F1,kVK_F2,kVK_F3,kVK_F4,kVK_F5,kVK_F6,kVK_F7,kVK_F8,kVK_F9,kVK_F10,
            kVK_F11,kVK_F12,kVK_F13,kVK_F14,kVK_F15,kVK_F16,kVK_F17,kVK_F18,kVK_F19,kVK_F20]
        for (offset, code) in functions.enumerated() { result["f\(offset + 1)"] = code }
        return result
    }()
}
