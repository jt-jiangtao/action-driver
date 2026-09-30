import AppKit
import CoreGraphics
import Foundation

/// User input observed by the listen-only event tap (D7).
public enum SessionUserEvent: Equatable {
    case escape
    case externalInput
}

/// Pure state for the Computer Use overlay, the session Esc stop and user interruptions (D7).
///
/// Esc ends the whole session: after that every call for the session fails with
/// `USER_STOPPED_SESSION` until the session is deliberately started again. An explicit
/// `session-start` clears an earlier stop because it opens a new supervised session; an implicit
/// start before a first action does not, so a repeated call cannot revive a stopped session.
/// Foreign input only counts as an interruption while an action is in flight.
public struct SessionSupervisionState: Equatable {
    private var active: [String] = []
    private var stopped: Set<String> = []
    private var overlaySession: String?
    private var actionInFlight = false
    private var interrupted = false

    public init() {}

    /// Session that currently owns the overlay, if any.
    public var visibleSession: String? { overlaySession }
    /// Session that most recently used the computer.
    public var current: String? { overlaySession ?? active.last }
    /// True while an action is executing, so foreign input can be attributed to it.
    public var isActionInFlight: Bool { actionInFlight }

    public func isStopped(_ session: String) -> Bool { stopped.contains(session) }

    /// Deliberate start: opens (or refreshes) a supervised session and clears an earlier Esc stop.
    /// Returns true when the overlay has to be shown for this session.
    @discardableResult
    public mutating func start(_ session: String) -> Bool {
        stopped.remove(session)
        return focus(on: session)
    }

    /// Implicit start before the first action of a session. Returns false when the session was
    /// already ended by the user; the caller must then refuse the action.
    @discardableResult
    public mutating func ensure(_ session: String) -> Bool {
        guard !stopped.contains(session) else { return false }
        _ = focus(on: session)
        return true
    }

    /// Ends supervision for a session; an Esc stop no longer applies because the session is over.
    /// Returns true when the overlay was showing this session and has to be hidden.
    @discardableResult
    public mutating func end(_ session: String) -> Bool {
        active.removeAll { $0 == session }
        stopped.remove(session)
        interrupted = false
        guard overlaySession == session else { return false }
        overlaySession = nil
        return true
    }

    /// The user pressed Esc: end the session that currently owns the computer.
    /// Returns the ended session so the caller can hide the overlay.
    @discardableResult
    public mutating func userStopped() -> String? {
        guard let session = current else { return nil }
        stopped.insert(session)
        active.removeAll { $0 == session }
        overlaySession = active.last
        return session
    }

    public mutating func beginAction() {
        actionInFlight = true
        interrupted = false
    }

    public mutating func endAction() {
        actionInFlight = false
        interrupted = false
    }

    /// Records one observed user event. Foreign input only interrupts a running action.
    @discardableResult
    public mutating func note(_ event: SessionUserEvent) -> String? {
        switch event {
        case .escape:
            return userStopped()
        case .externalInput:
            if actionInFlight { interrupted = true }
            return nil
        }
    }

    /// Error for a session that stopped mid-action or was interrupted by the user, if any.
    public func interruption(_ session: String) -> ComputerUseError? {
        if stopped.contains(session) { return .userStoppedSession }
        if actionInFlight, interrupted { return .userIntervened }
        return nil
    }

    private mutating func focus(on session: String) -> Bool {
        active.removeAll { $0 == session }
        active.append(session)
        let changed = overlaySession != session
        overlaySession = session
        return changed
    }
}

/// Thread-safe holder shared by the socket worker (actions) and the main-thread event tap.
public final class SessionSupervision: @unchecked Sendable {
    private let lock = NSLock()
    private var state = SessionSupervisionState()

    public init() {}

    public func read<T>(_ body: (SessionSupervisionState) -> T) -> T {
        lock.lock()
        defer { lock.unlock() }
        return body(state)
    }

    public func update<T>(_ body: (inout SessionSupervisionState) -> T) -> T {
        lock.lock()
        defer { lock.unlock() }
        return body(&state)
    }

    /// The user ended the session, whichever session currently owns the computer.
    @discardableResult
    public func userStopped() -> String? { update { $0.userStopped() } }

    @discardableResult
    public func note(_ event: SessionUserEvent) -> String? { update { $0.note(event) } }

    public func isStopped(_ session: String) -> Bool { read { $0.isStopped(session) } }

    public func interruption(_ session: String) -> ComputerUseError? {
        read { $0.interruption(session) }
    }
}

/// Surface the service uses to drive the overlay and the user-input listener (D7).
@MainActor
public protocol SessionOverlayPresenting: AnyObject {
    /// Installs the listen-only event tap. False when macOS does not let the helper listen:
    /// 0.2 showed that an enabled tap stays silent without Accessibility, so the preflight decides.
    func startListening() -> Bool
    func stopListening()
    func setOverlayVisible(_ visible: Bool)
}

/// Non-activating overlay plus a listen-only event tap feeding `SessionSupervision`.
@MainActor
public final class SessionOverlayController: SessionOverlayPresenting {
    public static let overlayText = "Action-Driver 正在使用你的电脑 · Esc 取消"
    private static let escapeKeyCode: Int64 = 53

    private let supervision: SessionSupervision
    private var tap: CFMachPort?
    private var source: CFRunLoopSource?
    private var panel: NSPanel?

    public init(supervision: SessionSupervision) {
        self.supervision = supervision
    }

    public func startListening() -> Bool {
        if let tap {
            return CGEvent.tapIsEnabled(tap: tap) && CGPreflightListenEventAccess()
        }
        guard CGPreflightListenEventAccess() else { return false }
        let interest: [CGEventType] = [.keyDown, .leftMouseDown, .rightMouseDown, .otherMouseDown,
                                       .leftMouseDragged, .rightMouseDragged, .otherMouseDragged,
                                       .mouseMoved, .scrollWheel]
        let mask = interest.reduce(CGEventMask(0)) { $0 | (CGEventMask(1) << $1.rawValue) }
        guard let tap = CGEvent.tapCreate(tap: .cgSessionEventTap,
                                          place: .headInsertEventTap,
                                          options: .listenOnly,
                                          eventsOfInterest: mask,
                                          callback: sessionEventTapCallback,
                                          userInfo: Unmanaged.passUnretained(self).toOpaque()),
              let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0) else {
            return false
        }
        CFRunLoopAddSource(CFRunLoopGetMain(), source, .commonModes)
        CGEvent.tapEnable(tap: tap, enable: true)
        self.tap = tap
        self.source = source
        return CGPreflightListenEventAccess()
    }

    public func stopListening() {
        if let tap { CGEvent.tapEnable(tap: tap, enable: false) }
        if let source { CFRunLoopRemoveSource(CFRunLoopGetMain(), source, .commonModes) }
        tap = nil
        source = nil
    }

    public func setOverlayVisible(_ visible: Bool) {
        if visible { showOverlay() } else { hideOverlay() }
    }

    /// Event tap callback body; runs on the main run loop.
    fileprivate func handle(type: CGEventType, event: CGEvent) {
        if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
            if let tap { CGEvent.tapEnable(tap: tap, enable: true) }
            return
        }
        // Events the helper itself posts are not user input (D7).
        let origin = pid_t(event.getIntegerValueField(.eventSourceUnixProcessID))
        guard origin != getpid() else { return }
        let escape = type == .keyDown
            && event.getIntegerValueField(.keyboardEventKeycode) == Self.escapeKeyCode
        if escape {
            supervision.userStopped()
            setOverlayVisible(supervision.read { $0.visibleSession != nil })
        } else {
            supervision.note(.externalInput)
        }
    }

    private func showOverlay() {
        if panel == nil { panel = makePanel() }
        guard let panel else { return }
        position(panel)
        panel.orderFrontRegardless()
    }

    private func hideOverlay() {
        panel?.orderOut(nil)
    }

    private func position(_ panel: NSPanel) {
        guard let screen = NSScreen.main ?? NSScreen.screens.first else { return }
        let size = panel.frame.size
        let frame = screen.visibleFrame
        panel.setFrameOrigin(NSPoint(x: frame.midX - size.width / 2,
                                     y: frame.maxY - size.height - 24))
    }

    private func makePanel() -> NSPanel {
        let panel = NSPanel(contentRect: NSRect(x: 0, y: 0, width: 320, height: 44),
                            styleMask: [.borderless, .nonactivatingPanel],
                            backing: .buffered,
                            defer: false)
        panel.isFloatingPanel = true
        panel.becomesKeyOnlyIfNeeded = true
        panel.level = .statusBar
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = true
        panel.ignoresMouseEvents = true
        panel.hidesOnDeactivate = false
        panel.contentView = makeOverlayContent()
        return panel
    }

    private func makeOverlayContent() -> NSView {
        let label = NSTextField(labelWithString: Self.overlayText)
        label.font = .systemFont(ofSize: 13, weight: .medium)
        label.textColor = .labelColor
        label.translatesAutoresizingMaskIntoConstraints = false

        let capsule = NSVisualEffectView()
        capsule.material = .hudWindow
        capsule.blendingMode = .behindWindow
        capsule.state = .active
        capsule.wantsLayer = true
        capsule.layer?.cornerRadius = 22
        capsule.layer?.masksToBounds = true
        capsule.translatesAutoresizingMaskIntoConstraints = false
        capsule.addSubview(label)

        let shield = AccessibilityShieldView(frame: .zero)
        shield.translatesAutoresizingMaskIntoConstraints = false
        shield.addSubview(capsule)
        NSLayoutConstraint.activate([
            capsule.leadingAnchor.constraint(equalTo: shield.leadingAnchor),
            capsule.trailingAnchor.constraint(equalTo: shield.trailingAnchor),
            capsule.topAnchor.constraint(equalTo: shield.topAnchor),
            capsule.bottomAnchor.constraint(equalTo: shield.bottomAnchor),
            label.leadingAnchor.constraint(equalTo: capsule.leadingAnchor, constant: 22),
            label.trailingAnchor.constraint(equalTo: capsule.trailingAnchor, constant: -22),
            label.centerYAnchor.constraint(equalTo: capsule.centerYAnchor)
        ])
        return shield
    }
}

/// C callback for the listen-only tap; it must hand the event back unchanged.
private func sessionEventTapCallback(proxy: CGEventTapProxy, type: CGEventType,
                                     event: CGEvent, refcon: UnsafeMutableRawPointer?)
    -> Unmanaged<CGEvent>? {
    if let refcon {
        let controller = Unmanaged<SessionOverlayController>.fromOpaque(refcon).takeUnretainedValue()
        // The tap source lives on the main run loop, so this stays main-actor isolated.
        MainActor.assumeIsolated { controller.handle(type: type, event: event) }
    }
    return Unmanaged.passUnretained(event)
}
