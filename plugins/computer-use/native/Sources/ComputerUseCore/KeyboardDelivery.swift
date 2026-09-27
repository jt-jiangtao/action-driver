import Foundation

/// Result of keyboard input posted with `postToPid`. A background app gives no receipt, and some
/// ignore such events entirely, so input it got is reported as delivered, not executed (D6 keyboard
/// ruling); the runtime then asks the model to verify it.
enum KeyboardDelivery {
    static func result(app: String, pid: Int32, frontmostPID: Int32?) -> [String: Any] {
        if frontmostPID == pid { return ["executed": true, "app": app, "pid": Int(pid)] }
        return ["executed": false, "delivered": true, "app": app, "pid": Int(pid)]
    }
}
