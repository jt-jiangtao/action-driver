import Foundation

public enum GuidancePermission: String, CaseIterable, Sendable {
    case accessibility, screenRecording
}

/// Pure guidance-window state so the window behaviour can be unit tested without AppKit.
public struct GuidanceSnapshot: Equatable, Sendable {
    public var accessibility: Bool
    public var screenRecording: Bool
    /// The capability the user handed to macOS and that is still waiting to be granted.
    public var pending: GuidancePermission?
    /// True once the user asked for at least one grant, which enables auto-close.
    public var guided: Bool

    public init(accessibility: Bool = false, screenRecording: Bool = false,
                pending: GuidancePermission? = nil, guided: Bool = false) {
        self.accessibility = accessibility
        self.screenRecording = screenRecording
        self.pending = pending
        self.guided = guided
    }

    public var authorized: Bool { accessibility && screenRecording }
    public var waitingForSystem: Bool { pending != nil }
    public var shouldClose: Bool { guided && authorized }

    public func isGranted(_ permission: GuidancePermission) -> Bool {
        permission == .accessibility ? accessibility : screenRecording
    }

    public mutating func apply(accessibility: Bool, screenRecording: Bool) {
        self.accessibility = accessibility
        self.screenRecording = screenRecording
        if let pending, isGranted(pending) { self.pending = nil }
    }

    /// Records the outcome of asking macOS for one capability.
    public mutating func recordRequest(_ permission: GuidancePermission, granted: Bool) {
        guided = true
        guard granted else {
            pending = permission
            return
        }
        switch permission {
        case .accessibility: accessibility = true
        case .screenRecording: screenRecording = true
        }
        pending = nil
    }

}
