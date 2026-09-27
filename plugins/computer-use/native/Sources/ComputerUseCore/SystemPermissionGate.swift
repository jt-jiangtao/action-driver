import ApplicationServices
import CoreGraphics
import Foundation

/// Reads — and on request registers — the macOS permissions Computer Use needs.
///
/// Preflight-only APIs report status without ever adding the app to
/// "System Settings → Privacy & Security", so the guidance page cannot send the
/// user to a list entry that does not exist. The `prompt` variants ask the system
/// to show its own authorization guidance, which is what creates that entry.
public protocol SystemPermissionGate {
    func accessibility(prompt: Bool) -> Bool
    func screenRecording(prompt: Bool) -> Bool
    func eventPosting(prompt: Bool) -> Bool
}

public struct NativeSystemPermissionGate: SystemPermissionGate {
    public init() {}

    public func accessibility(prompt: Bool) -> Bool {
        guard prompt else { return AXIsProcessTrusted() }
        let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
        return AXIsProcessTrustedWithOptions(options)
    }

    public func screenRecording(prompt: Bool) -> Bool {
        prompt ? CGRequestScreenCaptureAccess() : CGPreflightScreenCaptureAccess()
    }

    public func eventPosting(prompt: Bool) -> Bool {
        prompt ? CGRequestPostEventAccess() : CGPreflightPostEventAccess()
    }
}
