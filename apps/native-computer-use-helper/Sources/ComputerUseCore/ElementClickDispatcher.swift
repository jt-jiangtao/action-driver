import Foundation

/// Select the mechanism before dispatch. An AX failure is not permission to retry the click.
enum ElementClickDispatcher {
    static func perform(preferAX: Bool, hasAXPress: Bool,
                        press: () -> Bool, fallback: () throws -> Void) throws {
        if preferAX && hasAXPress {
            guard press() else { throw NativeComputerUseError.actionFailed("AXPress failed; click was not retried") }
        } else {
            try fallback()
        }
    }
}
