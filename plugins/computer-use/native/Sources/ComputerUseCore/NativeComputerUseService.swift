import AppKit
import ApplicationServices
import CoreGraphics
import Foundation
import ScreenCaptureKit

public enum NativeComputerUseError: Error {
    case accessibilityDenied
    case screenRecordingDenied
    case eventPostingDenied
    case noFrontmostApplication
    case selfIsFrontmost
    case actionFailed(String)
}

public final class NativeComputerUseService {
    private let permissions: SystemPermissionGate
    private let organizationPolicyURL: URL
    private let ownerApplications: [URL]
    private let supervision: SessionSupervision
    private let overlay: (any SessionOverlayPresenting)?
    /// Session of the action that is executing right now, so user input can be attributed to it.
    private var supervisedSession: String?
    private struct ElementSnapshot {
        let element: AXUIElement
        let role: String?
        let title: String?
        let identifier: String?
        let frame: CGRect?
    }
    private let sessionElements = SessionElementStore<ElementSnapshot>(equal: {
        CFEqual($0.element, $1.element)
    })
    private struct SessionApp: Hashable { let session: String; let app: String }
    private var sessionText: [SessionApp: String] = [:]
    private var sessionWindows: [SessionApp: WindowCoordinates] = [:]
    private var sessionActionAt: [SessionApp: Date] = [:]
    /// Last full accessibility text per app, so repeated `app-state` calls can answer with a diff.
    /// Timestamp of the most recent action, used to wait for the interface to settle.
    private var lastActionAt: Date?

    /// `ownerApplications` names Action-Driver itself; the app that contains a packaged helper is
    /// always added, so the model can never drive the app that shows its approvals.
    public init(permissions: SystemPermissionGate = NativeSystemPermissionGate(),
                organizationPolicyURL: URL? = nil, ownerApplications: [URL] = [],
                supervision: SessionSupervision = SessionSupervision(),
                overlay: (any SessionOverlayPresenting)? = nil) {
        self.permissions = permissions
        self.supervision = supervision
        self.overlay = overlay
        self.ownerApplications = ownerApplications
            + [ApplicationPolicy.containingApplication(of: Bundle.main.bundleURL)].compactMap { $0 }
        self.organizationPolicyURL = organizationPolicyURL ?? URL(fileURLWithPath: NSHomeDirectory())
            .appendingPathComponent("Library/Application Support/Action-Driver/computer-use-policy.json")
    }

    /// Drives the overlay from the socket worker thread; AppKit work hops to the main run loop.
    private func onMain<T>(_ body: @MainActor () -> T) -> T {
        if Thread.isMainThread { return MainActor.assumeIsolated(body) }
        return DispatchQueue.main.sync { MainActor.assumeIsolated(body) }
    }

    /// Keeps the overlay in step with the supervised session, showing it before the first action.
    private func syncOverlay() {
        let visible = supervision.read { $0.visibleSession != nil }
        onMain {
            guard let overlay else { return }
            if visible { _ = overlay.startListening() }
            overlay.setOverlayVisible(visible)
        }
    }

    private func startSession(_ session: String) -> [String: Any] {
        _ = supervision.update { $0.start(session) }
        let listening = onMain { overlay?.startListening() ?? false }
        syncOverlay()
        return ["sessionId": session, "overlay": true, "userInputListening": listening]
    }

    private func endSession(_ session: String) -> [String: Any] {
        _ = supervision.update { $0.end(session) }
        let remaining = supervision.read { $0.visibleSession != nil }
        if !remaining { onMain { overlay?.stopListening() } }
        syncOverlay()
        return ["sessionId": session, "closed": true]
    }

    /// Refuses a session the user ended with Esc (D7); `USER_STOPPED_SESSION` interrupts the task.
    private func requireUsableSession(_ session: String) throws {
        if supervision.isStopped(session) { throw ComputerUseError.userStoppedSession }
        let usable = supervision.update { $0.ensure(session) }
        guard usable else { throw ComputerUseError.userStoppedSession }
    }

    /// Esc pressed or foreign input observed while an action runs (D7).
    private func checkUserInterruption() throws {
        guard let session = supervisedSession else { return }
        if let error = supervision.interruption(session) { throw error }
    }

    /// Drops the overlay and the listen-only tap when the helper is asked to shut down.
    public func shutdownSupervision() {
        if let visible = supervision.read({ $0.visibleSession }) {
            _ = supervision.update { $0.end(visible) }
        }
        onMain {
            overlay?.setOverlayVisible(false)
            overlay?.stopListening()
        }
    }

    /// Read-only-or-prompting probe shared by the stdio protocol and the native guidance window.
    public func permissionsSnapshot(prompting target: GuidancePermission? = nil) -> GuidanceSnapshot {
        GuidanceSnapshot(
            accessibility: permissions.accessibility(prompt: target == .accessibility),
            screenRecording: permissions.screenRecording(prompt: target == .screenRecording))
    }

    public func execute(_ request: ComputerUseRequest) async throws -> [String: Any] {
        try checkDeadline(request)
        switch request.operation {
        case .listApps:
            return ["apps": listApps()]
        case .sessionStart:
            guard let session = request.sessionId else {
                throw ComputerUseError.invalidRequest("Session identifier missing")
            }
            return startSession(session)
        case .sessionEnd:
            guard let session = request.sessionId else {
                throw ComputerUseError.invalidRequest("Session identifier missing")
            }
            return endSession(session)
        case .appPolicy:
            guard let app = request.app else { throw ComputerUseError.invalidRequest("App identifier missing") }
            return try applicationPolicy(app)
        case .appState:
            guard let session = request.sessionId, let identifier = request.app else {
                throw ComputerUseError.invalidRequest("Application state requires app and sessionId")
            }
            return try await sessionAppState(identifier: identifier, session: session, request: request)
        case .permissions:
            let prompt = request.prompt ?? false
            let prompted = { (name: String) -> Bool in
                prompt && (request.target == nil || request.target == name)
            }
            return [
                "accessibility": permissions.accessibility(prompt: prompted("accessibility")),
                "screenRecording": permissions.screenRecording(prompt: prompted("screenRecording")),
                "eventPosting": permissions.eventPosting(prompt: prompted("eventPosting")),
                "permissionTarget": "Action-Driver Computer Use"
            ]
        case .act:
            guard let session = request.sessionId, let identifier = request.app,
                  let action = request.action else {
                throw ComputerUseError.invalidRequest("Application action requires app and sessionId")
            }
            return try sessionAct(identifier: identifier, session: session, action: action, request: request)
        case .cancel, .shutdown, .guidance:
            return ["accepted": true]
        }
    }

    private func applicationPolicy(_ identifier: String) throws -> [String: Any] {
        return try ApplicationPolicy(organizationPolicyURL: organizationPolicyURL,
                                     ownerApplications: ownerApplications).evaluate(identifier)
    }

    /// Privacy, password and account panes of System Settings are forbidden (D9). Checked on every
    /// read and every action, since the pane can change in between.
    private func assertSettingsPaneAllowed(bundle: String, pid: pid_t) throws {
        guard bundle == SensitiveSettingsPane.bundleIdentifier else { return }
        let application = AXUIElementCreateApplication(pid)
        let title = attributeValue(application, kAXFocusedWindowAttribute as CFString)
            .flatMap { value -> AXUIElement? in
                CFGetTypeID(value as CFTypeRef) == AXUIElementGetTypeID() ? (value as! AXUIElement) : nil
            }
            .flatMap { attributeValue($0, kAXTitleAttribute as CFString) as? String }
        if SensitiveSettingsPane.isForbidden(windowTitle: title) { throw ComputerUseError.appForbidden }
    }

    private func checkDeadline(_ request: ComputerUseRequest) throws {
        if Task.isCancelled { throw ComputerUseError.cancelled }
        if Int64(Date().timeIntervalSince1970 * 1000) >= request.deadlineUnixMs {
            throw ComputerUseError.timedOut
        }
    }

    /// Every app LaunchServices knows about, plus the ones already running. Mirrors the reference
    /// `list_apps` surface: id, display name, running state and path.
    private func listApps() -> [[String: Any]] {
        var entries: [String: [String: Any]] = [:]
        for app in NSWorkspace.shared.runningApplications where app.activationPolicy == .regular {
            guard let id = app.bundleIdentifier else { continue }
            entries[id] = ["id": id, "displayName": app.localizedName ?? id, "isRunning": true]
        }
        let directories = ["/Applications", "/System/Applications",
                           NSHomeDirectory() + "/Applications"]
        for directory in directories {
            let urls = (try? FileManager.default.contentsOfDirectory(
                at: URL(fileURLWithPath: directory), includingPropertiesForKeys: nil)) ?? []
            for url in urls where url.pathExtension == "app" {
                guard let bundle = Bundle(url: url), let id = bundle.bundleIdentifier else { continue }
                var entry = entries[id] ?? ["id": id, "isRunning": false]
                let display = bundle.infoDictionary?["CFBundleDisplayName"] as? String
                    ?? bundle.infoDictionary?["CFBundleName"] as? String
                    ?? url.deletingPathExtension().lastPathComponent
                entry["displayName"] = display
                entry["path"] = url.path
                entries[id] = entry
            }
        }
        return entries.values.sorted {
            ($0["displayName"] as? String ?? "") < ($1["displayName"] as? String ?? "")
        }
    }

    /// Resolves an app by bundle id, path or display name, starts it through LaunchServices when
    /// needed, brings it to the front and returns its accessibility tree as text (+ optional frame).
    /// New per-app reads never activate the target or invalidate another session's table.
    private func sessionAppState(identifier: String, session: String,
                                 request: ComputerUseRequest) async throws -> [String: Any] {
        if supervision.isStopped(session) { throw ComputerUseError.userStoppedSession }
        let policy = try applicationPolicy(identifier)
        if policy["decision"] as? String == "forbidden" { throw ComputerUseError.appForbidden }
        if policy["decision"] as? String == "denied" { throw ComputerUseError.appDenied }
        guard let target = policy["target"] as? [String: Any],
              let bundle = target["bundleId"] as? String,
              let path = target["appPath"] as? String else {
            throw ComputerUseError.invalidRequest("Application target missing")
        }
        guard AXIsProcessTrusted() else { throw NativeComputerUseError.accessibilityDenied }
        var application = NSRunningApplication.runningApplications(withBundleIdentifier: bundle).first
        if application == nil {
            let configuration = NSWorkspace.OpenConfiguration()
            configuration.activates = false
            application = try await NSWorkspace.shared.openApplication(
                at: URL(fileURLWithPath: path), configuration: configuration)
        }
        guard let application else { throw NativeComputerUseError.actionFailed("Application did not launch") }
        try checkDeadline(request)
        let pid = application.processIdentifier
        try assertSettingsPaneAllowed(bundle: bundle, pid: pid)
        let key = SessionApp(session: session, app: bundle)
        if let touched = sessionActionAt[key] {
            let delay = 1 - Date().timeIntervalSince(touched)
            if delay > 0 { try await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000)) }
        }
        let root = AXUIElementCreateApplication(pid)
        let (tree, snapshots) = try await InterfaceStability.read(sample: {
            try self.checkDeadline(request)
            var remaining = request.maxElements ?? 300
            var snapshots: [String: ElementSnapshot] = [:]
            let tree = self.describe(root, depth: 0, maxDepth: request.maxDepth ?? 12,
                                     remaining: &remaining, snapshots: &snapshots)
            // UUID refs are transport details; remove them only from the settling fingerprint.
            func fingerprintTree(_ node: [String: Any]) -> [String: Any] {
                var value = node
                value.removeValue(forKey: "ref")
                if let children = node["children"] as? [[String: Any]] {
                    value["children"] = children.map(fingerprintTree)
                }
                return value
            }
            let fingerprint = try JSONSerialization.data(withJSONObject: fingerprintTree(tree), options: [.sortedKeys])
            return (String(decoding: fingerprint, as: UTF8.self), (tree, snapshots))
        })
        var ordered: [String] = []
        func collect(_ node: [String: Any]) {
            if let ref = node["ref"] as? String { ordered.append(ref) }
            for child in node["children"] as? [[String: Any]] ?? [] { collect(child) }
        }
        collect(tree)
        var readCompleted = false
        defer { if !readCompleted { sessionElements.invalidate(session: session, app: bundle) } }
        let indexes = try sessionElements.record(session: session, app: bundle, pid: pid,
                                                elements: ordered.compactMap { snapshots[$0] })
        let indexByRef = Dictionary(uniqueKeysWithValues: zip(ordered, indexes))
        func indexed(_ node: [String: Any]) -> [String: Any] {
            var result = node
            if let ref = node["ref"] as? String { result["elementIndex"] = indexByRef[ref] }
            result.removeValue(forKey: "ref")
            if let children = node["children"] as? [[String: Any]] {
                result["children"] = children.map(indexed)
            }
            return result
        }
        let full = AccessibilityStateText.render(indexed(tree))
        let previous = sessionText[key]
        var result: [String: Any] = ["app": bundle,
            "text": request.disableDiff == true || previous == nil
                ? full : AccessibilityStateText.diff(previous: previous ?? "", current: full)]
        if let instructions = ApplicationInstructions.forApp(bundle) {
            result["appSpecificInstructions"] = instructions
        }
        if request.screenshot == true {
            result["screenshot"] = try await captureWindow(pid: pid, key: key)
        }
        try checkDeadline(request)
        sessionText[key] = full
        readCompleted = true
        return result
    }

    /// Runs one application action under session supervision (D7): the overlay is shown before the
    /// first action, Esc ends the session and foreign input during the action reports an
    /// interruption instead of a false success.
    private func sessionAct(identifier: String, session: String, action: ComputerUseAction,
                            request: ComputerUseRequest) throws -> [String: Any] {
        try requireUsableSession(session)
        supervisedSession = session
        supervision.update { $0.beginAction() }
        defer {
            supervisedSession = nil
            supervision.update { $0.endAction() }
        }
        let result = try performSessionAct(identifier: identifier, session: session,
                                           action: action, request: request)
        try checkUserInterruption()
        return result
    }

    private func performSessionAct(identifier: String, session: String, action: ComputerUseAction,
                                   request: ComputerUseRequest) throws -> [String: Any] {
        let policy = try applicationPolicy(identifier)
        if policy["decision"] as? String == "forbidden" { throw ComputerUseError.appForbidden }
        if policy["decision"] as? String == "denied" { throw ComputerUseError.appDenied }
        guard let target = policy["target"] as? [String: Any],
              let bundle = target["bundleId"] as? String,
              let application = NSRunningApplication.runningApplications(withBundleIdentifier: bundle).first else {
            throw ComputerUseError.staleReference
        }
        guard AXIsProcessTrusted() else { throw NativeComputerUseError.accessibilityDenied }
        let pid = application.processIdentifier
        try assertSettingsPaneAllowed(bundle: bundle, pid: pid)
        guard let index = action.elementIndex else {
            if ["click", "drag", "scroll"].contains(action.type),
               NSWorkspace.shared.frontmostApplication?.processIdentifier != pid {
                throw ComputerUseError.backgroundInputUnsupported
            }
            try checkDeadline(request)
            // Indexes stay usable after an action (D5 ruling): every indexed action re-verifies its
            // own element, so batched actions work as the Codex documentation describes.
            var pasteResult: [String: Any]?
            switch action.type {
            case "key": try pressKeyExpression(action.key ?? "", pid: pid)
            case "type": try typeText(action.text ?? "", pid: pid)
            case "paste":
                pasteResult = try pasteToApplication(text: action.text ?? "",
                                                     format: action.format ?? "text", pid: pid)
            case "click", "drag", "scroll":
                guard let coordinates = sessionWindows[SessionApp(session: session, app: bundle)] else {
                    throw ComputerUseError.staleReference
                }
                let current = try frontmost()
                guard let frame = current.frame else { throw ComputerUseError.staleReference }
                func point(_ x: Double, _ y: Double) throws -> CGPoint {
                    try coordinates.point(x: x, y: y, foregroundPID: current.pid,
                        windowID: current.windowId, frame: frame)
                }
                switch action.type {
                case "click":
                    try click(point(action.x ?? -1, action.y ?? -1),
                        button: action.mouseButton ?? "left", count: action.clickCount ?? 1, pid: pid)
                case "drag":
                    try drag(from: point(action.fromX ?? -1, action.fromY ?? -1),
                        to: point(action.toX ?? -1, action.toY ?? -1), pid: pid)
                default:
                    try scroll(deltaX: action.deltaX ?? 0, deltaY: action.deltaY ?? 0,
                        point: point(action.x ?? -1, action.y ?? -1), pid: pid)
                }
            default: throw NativeComputerUseError.actionFailed("Application event adapter is not available yet")
            }
            lastActionAt = Date()
            sessionActionAt[SessionApp(session: session, app: bundle)] = lastActionAt
            if let pasteResult { return pasteResult }
            if action.type == "key" || action.type == "type" {
                return KeyboardDelivery.result(app: bundle, pid: pid,
                    frontmostPID: NSWorkspace.shared.frontmostApplication?.processIdentifier)
            }
            return ["executed": true, "app": bundle, "pid": Int(pid)]
        }
        let snapshot = try sessionElements.resolve(session: session, app: bundle, pid: pid, index: index)
        let element = snapshot.element
        let root = AXUIElementCreateApplication(pid)
        // A retained AX handle can outlive removal. Prove it is still reachable before dispatch.
        var remaining = request.maxElements ?? 300
        var live: [String: ElementSnapshot] = [:]
        _ = describe(root, depth: 0, maxDepth: request.maxDepth ?? 12,
                     remaining: &remaining, snapshots: &live)
        guard live.values.contains(where: { CFEqual($0.element, element) }),
              (attributeValue(element, kAXRoleAttribute as CFString) as? String) == snapshot.role,
              (attributeValue(element, kAXTitleAttribute as CFString) as? String) == snapshot.title,
              (attributeValue(element, kAXIdentifierAttribute as CFString) as? String) == snapshot.identifier,
              elementFrame(element) == snapshot.frame else { throw ComputerUseError.staleReference }
        try checkDeadline(request)
        // Indexes stay usable after an action (D5 ruling): the checks above run again before every
        // indexed action, so a removed or changed element still fails with STALE_REFERENCE.
        switch action.type {
        case "click-element":
            let simplePress = (action.mouseButton == nil || action.mouseButton == "left")
                && (action.clickCount == nil || action.clickCount == 1)
            var names: CFArray?
            let hasPress = AXUIElementCopyActionNames(element, &names) == .success
                && ((names as? [String]) ?? []).contains(kAXPressAction)
            try ElementClickDispatcher.perform(preferAX: simplePress, hasAXPress: hasPress,
                press: { AXUIElementPerformAction(element, kAXPressAction as CFString) == .success },
                fallback: {
                    try click(try foregroundElementPoint(snapshot, pid: pid),
                        button: action.mouseButton ?? "left", count: action.clickCount ?? 1, pid: pid)
                })
        case "scroll":
            try scroll(deltaX: action.deltaX ?? 0, deltaY: action.deltaY ?? 0,
                point: try foregroundElementPoint(snapshot, pid: pid), pid: pid)
        case "set-value":
            guard AXUIElementSetAttributeValue(element, kAXValueAttribute as CFString,
                                               (action.value ?? "") as CFTypeRef) == .success else {
                throw NativeComputerUseError.actionFailed("Unable to set the element value")
            }
        case "select-text":
            try selectText(in: element, action: action)
        case "secondary-action":
            guard AXUIElementPerformAction(element, (action.actionName ?? "") as CFString) == .success else {
                throw NativeComputerUseError.actionFailed("The element does not expose the requested secondary action")
            }
        default:
            throw ComputerUseError.backgroundInputUnsupported
        }
        lastActionAt = Date()
        sessionActionAt[SessionApp(session: session, app: bundle)] = lastActionAt
        return ["executed": true, "app": bundle, "pid": Int(pid)]
    }

    private func foregroundElementPoint(_ snapshot: ElementSnapshot, pid: pid_t) throws -> CGPoint {
        try requireForeground(pid)
        let current = try frontmost()
        guard let frame = snapshot.frame, let window = current.frame,
              frame.width > 0, frame.height > 0 else { throw ComputerUseError.staleReference }
        let point = CGPoint(x: frame.midX, y: frame.midY)
        guard window.contains(point) else { throw ComputerUseError.staleReference }
        return point
    }

    private func captureWindow(pid: pid_t, key: SessionApp) async throws -> [String: Any] {
        guard CGPreflightScreenCaptureAccess() else { throw NativeComputerUseError.screenRecordingDenied }
        let content = try await SCShareableContent.current
        let candidates = content.windows.filter {
            $0.owningApplication?.processID == pid && $0.windowLayer == 0
                && $0.frame.width > 0 && $0.frame.height > 0
        }
        // An application can also expose windows that are not the one being used, so capture the
        // focused window when it is available (WindowSelection) rather than the first candidate.
        let picked = WindowSelection.pick(
            candidates: candidates.map { WindowCandidate(id: Int($0.windowID), frame: $0.frame) },
            focused: focusedWindowFrame(pid: pid))
        guard let picked, let window = candidates.first(where: { Int($0.windowID) == picked }) else {
            throw NativeComputerUseError.actionFailed("Application has no capturable window")
        }
        let configuration = SCStreamConfiguration()
        configuration.width = max(1, Int(window.frame.width))
        configuration.height = max(1, Int(window.frame.height))
        configuration.showsCursor = false
        configuration.ignoreShadowsSingleWindow = true
        let image = try await SCScreenshotManager.captureImage(
            contentFilter: SCContentFilter(desktopIndependentWindow: window), configuration: configuration)
        guard let data = NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:]) else {
            throw NativeComputerUseError.actionFailed("Screenshot encoding failed")
        }
        sessionWindows[key] = WindowCoordinates(pid: pid, windowID: Int(window.windowID),
            frame: window.frame, pixels: CGSize(width: image.width, height: image.height))
        return ["mimeType": "image/png", "base64": data.base64EncodedString()]
    }

    private func diffLines(previous: String, current: String) -> String {
        // Element references are regenerated on every observation, so they must not count as a
        // change; the diff compares the interface itself.
        var remaining = previous.split(separator: "\n", omittingEmptySubsequences: false)
            .map(String.init)
            .map(normalizedForDiff)
            .reduce(into: [String: Int]()) { $0[$1, default: 0] += 1 }
        var added: [String] = []
        for line in current.split(separator: "\n", omittingEmptySubsequences: false)
            .map(String.init).map(normalizedForDiff) {
            if let count = remaining[line], count > 0 { remaining[line] = count - 1 } else { added.append(line) }
        }
        let removed = remaining.flatMap { line, count in Array(repeating: line, count: count) }
        guard !added.isEmpty || !removed.isEmpty else {
            return "no changes since the previous state"
        }
        return (removed.map { "- \($0)" } + added.map { "+ \($0)" }).joined(separator: "\n")
    }

    private func normalizedForDiff(_ line: String) -> String {
        guard let start = line.range(of: " ref=") else { return line }
        let tail = line[start.upperBound...]
        guard let end = tail.firstIndex(of: " ") else { return String(line[..<start.lowerBound]) }
        return line.replacingCharacters(in: start.lowerBound..<end, with: "")
    }

    private func renderText(from tree: Any?) -> String {
        var lines: [String] = []
        func walk(_ node: Any?, depth: Int) {
            guard let node = node as? [String: Any] else { return }
            let role = node["role"] as? String ?? "element"
            let title = node["title"] as? String ?? node["description"] as? String ?? ""
            let ref = (node["elementIndex"] as? Int).map { "[\($0)]" }
                ?? (node["ref"] as? String ?? "")
            let actions = (node["actions"] as? [String])?.joined(separator: ",") ?? ""
            lines.append(String(repeating: "  ", count: depth)
                + "\(role) \"\(title)\" ref=\(ref) actions=[\(actions)]")
            for child in node["children"] as? [Any] ?? [] { walk(child, depth: depth + 1) }
        }
        walk(tree, depth: 0)
        return lines.joined(separator: "\n")
    }

    private func frontmost() throws -> (pid: pid_t, windowId: Int, name: String, frame: CGRect?) {
        guard let app = NSWorkspace.shared.frontmostApplication else {
            throw NativeComputerUseError.noFrontmostApplication
        }
        let pid = app.processIdentifier
        guard pid != ProcessInfo.processInfo.processIdentifier else {
            // Walking our own window's accessibility tree is what crashed the helper before.
            throw NativeComputerUseError.selfIsFrontmost
        }
        let windowInfo = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID)
            as? [[String: Any]] ?? []
        let window = windowInfo.first {
            ($0[kCGWindowOwnerPID as String] as? Int32) == pid &&
            ($0[kCGWindowLayer as String] as? Int) == 0
        }
        let bounds = window?[kCGWindowBounds as String] as? [String: Any]
        let frame: CGRect? = bounds.flatMap { value in
            guard let x = value["X"] as? NSNumber, let y = value["Y"] as? NSNumber,
                  let width = value["Width"] as? NSNumber,
                  let height = value["Height"] as? NSNumber else { return nil }
            return CGRect(x: x.doubleValue, y: y.doubleValue,
                          width: width.doubleValue, height: height.doubleValue)
        }
        return (pid, window?[kCGWindowNumber as String] as? Int ?? 0,
                app.localizedName ?? app.bundleIdentifier ?? "Unknown", frame)
    }

    private func describe(_ element: AXUIElement, depth: Int, maxDepth: Int,
                          remaining: inout Int,
                          snapshots: inout [String: ElementSnapshot]) -> [String: Any] {
        remaining -= 1
        let reference = UUID().uuidString
        snapshots[reference] = ElementSnapshot(
            element: element,
            role: attributeValue(element, kAXRoleAttribute as CFString) as? String,
            title: attributeValue(element, kAXTitleAttribute as CFString) as? String,
            identifier: attributeValue(element, kAXIdentifierAttribute as CFString) as? String,
            frame: elementFrame(element)
        )
        var node: [String: Any] = ["ref": reference]
        for (attribute, name) in [
            (kAXRoleAttribute, "role"), (kAXSubroleAttribute, "subrole"),
            (kAXTitleAttribute, "title"), (kAXDescriptionAttribute, "description"),
            (kAXIdentifierAttribute, "identifier")
        ] {
            if let value = attributeValue(element, attribute as CFString) as? String,
               !value.isEmpty { node[name] = String(value.prefix(512)) }
        }
        if let value = attributeValue(element, kAXValueAttribute as CFString) as? String {
            node["value"] = String(value.prefix(512))
        }
        if let frame = elementFrame(element) {
            node["frame"] = ["x": frame.origin.x, "y": frame.origin.y,
                             "width": frame.width, "height": frame.height]
        }
        var actions: CFArray?
        if AXUIElementCopyActionNames(element, &actions) == .success,
           let names = actions as? [String] {
            node["actions"] = Array(names.prefix(16))
        }
        if depth < maxDepth && remaining > 0,
           let children = attributeValue(element, kAXChildrenAttribute as CFString) as? [AXUIElement] {
            // Spend the element budget on windows before the menu bar (see AccessibilityChildOrder).
            let focusedWindow = attributeValue(element, kAXFocusedWindowAttribute as CFString)
                .flatMap { value -> AXUIElement? in
                    CFGetTypeID(value as CFTypeRef) == AXUIElementGetTypeID() ? (value as! AXUIElement) : nil
                }
            let ordered = AccessibilityChildOrder.prioritized(children,
                role: { self.attributeValue($0, kAXRoleAttribute as CFString) as? String },
                isFocused: { child in focusedWindow.map { CFEqual($0, child) } ?? false })
            var described: [[String: Any]] = []
            for child in ordered {
                if remaining <= 0 { break }
                described.append(describe(child, depth: depth + 1, maxDepth: maxDepth,
                                          remaining: &remaining, snapshots: &snapshots))
            }
            if !described.isEmpty { node["children"] = described }
        }
        return node
    }

    private func attributeValue(_ element: AXUIElement, _ attribute: CFString) -> Any? {
        var value: CFTypeRef?
        return AXUIElementCopyAttributeValue(element, attribute, &value) == .success ? value : nil
    }

    private func elementFrame(_ element: AXUIElement) -> CGRect? {
        guard let positionObject = attributeValue(element, kAXPositionAttribute as CFString),
              let sizeObject = attributeValue(element, kAXSizeAttribute as CFString),
              CFGetTypeID(positionObject as CFTypeRef) == AXValueGetTypeID(),
              CFGetTypeID(sizeObject as CFTypeRef) == AXValueGetTypeID() else {
            return nil
        }
        let position = positionObject as! AXValue
        let size = sizeObject as! AXValue
        var point = CGPoint.zero
        var dimensions = CGSize.zero
        guard AXValueGetValue(position, .cgPoint, &point),
              AXValueGetValue(size, .cgSize, &dimensions) else { return nil }
        return CGRect(origin: point, size: dimensions)
    }

    private func requireEventPosting() throws {
        try Task.checkCancellation()
        guard CGPreflightPostEventAccess() else { throw NativeComputerUseError.eventPostingDenied }
    }

    /// Re-validates a stored element reference against its live attributes before acting on it.
    private func paste(text: String, format: String) throws {
        guard let pid = NSWorkspace.shared.frontmostApplication?.processIdentifier else {
            throw NativeComputerUseError.noFrontmostApplication
        }
        _ = try pasteToApplication(text: text, format: format, pid: pid)
    }

    /// Pastes into the target process and restores the saved pasteboard only after an observable
    /// change in that application (1.6): the posted keystroke and the pasteboard change count say
    /// nothing about whether the content was consumed.
    private func pasteToApplication(text: String, format: String, pid: pid_t) throws -> [String: Any] {
        try requireEventPosting()
        try Task.checkCancellation()
        let baseline = focusedValue(pid: pid)
        let saved = savedPasteboardItems()
        let pasteboard = NSPasteboard.general
        pasteboard.clearContents()
        switch format {
        case "html": pasteboard.setString(text, forType: .html)
        default: pasteboard.setString(text, forType: .string)
        }
        var confirmation = PasteConfirmation(baseline: baseline)
        var confirmed = false
        do {
            try postPasteKeystroke(pid: pid)
            let deadline = Date().addingTimeInterval(1.5)
            while Date() < deadline {
                try Task.checkCancellation()
                try checkUserInterruption()
                if confirmation.observe(focusedValue(pid: pid)) {
                    confirmed = true
                    break
                }
                usleep(60_000)
            }
        } catch {
            restorePasteboard(saved)
            throw error
        }
        restorePasteboard(saved)
        let bundle = NSRunningApplication(processIdentifier: pid)?.bundleIdentifier ?? ""
        // Unconfirmed paste mirrors the background keyboard ruling (D6): the keystroke was
        // delivered, the application gave no receipt, so the model has to verify it itself.
        return confirmed
            ? ["executed": true, "app": bundle, "pid": Int(pid), "pasteConfirmed": true]
            : ["executed": false, "delivered": true, "app": bundle, "pid": Int(pid)]
    }

    private func savedPasteboardItems() -> [[NSPasteboard.PasteboardType: Data]]? {
        NSPasteboard.general.pasteboardItems?.compactMap { item
            -> [NSPasteboard.PasteboardType: Data]? in
            var copy: [NSPasteboard.PasteboardType: Data] = [:]
            for type in item.types { if let data = item.data(forType: type) { copy[type] = data } }
            return copy.isEmpty ? nil : copy
        }
    }

    private func restorePasteboard(_ saved: [[NSPasteboard.PasteboardType: Data]]?) {
        guard let saved, !saved.isEmpty else { return }
        let pasteboard = NSPasteboard.general
        pasteboard.clearContents()
        pasteboard.writeObjects(saved.map { entry in
            let item = NSPasteboardItem()
            for (type, data) in entry { item.setData(data, forType: type) }
            return item
        })
    }

    /// Observable value of the target's focused element, used only to confirm a paste.
    private func focusedValue(pid: pid_t) -> String? {
        let application = AXUIElementCreateApplication(pid)
        let focused = attributeValue(application, kAXFocusedUIElementAttribute as CFString)
            .flatMap { value -> AXUIElement? in
                CFGetTypeID(value as CFTypeRef) == AXUIElementGetTypeID() ? (value as! AXUIElement) : nil
            }
        guard let focused else { return nil }
        return attributeValue(focused, kAXValueAttribute as CFString) as? String
    }

    /// Frame of the application's focused window, so captures can avoid its auxiliary windows.
    private func focusedWindowFrame(pid: pid_t) -> CGRect? {
        let application = AXUIElementCreateApplication(pid)
        let window = attributeValue(application, kAXFocusedWindowAttribute as CFString)
            .flatMap { value -> AXUIElement? in
                CFGetTypeID(value as CFTypeRef) == AXUIElementGetTypeID() ? (value as! AXUIElement) : nil
            }
        guard let window else { return nil }
        return elementFrame(window)
    }

    /// ⌘V into the target process, so a session paste does not rely on the app being frontmost.
    private func postPasteKeystroke(pid: pid_t) throws {
        guard let down = CGEvent(keyboardEventSource: nil, virtualKey: 9, keyDown: true),
              let up = CGEvent(keyboardEventSource: nil, virtualKey: 9, keyDown: false) else {
            throw NativeComputerUseError.actionFailed("Unable to create paste event")
        }
        down.flags = .maskCommand
        up.flags = .maskCommand
        down.postToPid(pid)
        up.postToPid(pid)
    }

    private func drag(from start: CGPoint, to end: CGPoint, pid: pid_t? = nil) throws {
        try requireEventPosting()
        guard let down = CGEvent(mouseEventSource: nil, mouseType: .leftMouseDown,
                                 mouseCursorPosition: start, mouseButton: .left),
              let move = CGEvent(mouseEventSource: nil, mouseType: .leftMouseDragged,
                                 mouseCursorPosition: end, mouseButton: .left),
              let up = CGEvent(mouseEventSource: nil, mouseType: .leftMouseUp,
                               mouseCursorPosition: end, mouseButton: .left) else {
            throw NativeComputerUseError.actionFailed("Unable to create drag events")
        }
        try requireForeground(pid)
        down.post(tap: .cghidEventTap)
        try checkUserInterruption()
        move.post(tap: .cghidEventTap)
        try checkUserInterruption()
        up.post(tap: .cghidEventTap)
    }

    private func selectText(in element: AXUIElement, action: ComputerUseAction) throws {
        guard let current = attributeValue(element, kAXValueAttribute as CFString) as? String,
              let target = action.text, !target.isEmpty else {
            throw NativeComputerUseError.actionFailed("The element has no selectable text value")
        }
        guard let range = TextSelection.range(in: current, text: target, prefix: action.prefix,
                                             suffix: action.suffix, selectionType: action.selectionType ?? "text") else {
            throw NativeComputerUseError.actionFailed("Text not found in the element value")
        }
        try Task.checkCancellation()
        var cfRange = CFRange(location: range.location, length: range.length)
        guard let value = AXValueCreate(.cfRange, &cfRange),
              AXUIElementSetAttributeValue(element, kAXSelectedTextRangeAttribute as CFString,
                                           value) == .success else {
            throw NativeComputerUseError.actionFailed("Unable to set the selection range")
        }
    }

    private func requireForeground(_ pid: pid_t?) throws {
        try Task.checkCancellation()
        try checkUserInterruption()
        if let pid, NSWorkspace.shared.frontmostApplication?.processIdentifier != pid {
            throw ComputerUseError.backgroundInputUnsupported
        }
    }

    private func click(_ point: CGPoint, button: String = "left", count: Int = 1,
                       pid: pid_t? = nil) throws {
        try requireEventPosting()
        let mouse: CGMouseButton = button == "right" ? .right : button == "middle" ? .center : .left
        let downType: CGEventType = mouse == .right ? .rightMouseDown : mouse == .center ? .otherMouseDown : .leftMouseDown
        let upType: CGEventType = mouse == .right ? .rightMouseUp : mouse == .center ? .otherMouseUp : .leftMouseUp
        guard (1...3).contains(count) else { throw ComputerUseError.invalidRequest("Invalid click count") }
        for number in 1...count {
            try checkUserInterruption()
            guard let down = CGEvent(mouseEventSource: nil, mouseType: downType,
                                     mouseCursorPosition: point, mouseButton: mouse),
                  let up = CGEvent(mouseEventSource: nil, mouseType: upType,
                                   mouseCursorPosition: point, mouseButton: mouse) else {
                throw NativeComputerUseError.actionFailed("Unable to create click event")
            }
            down.setIntegerValueField(.mouseEventClickState, value: Int64(number))
            up.setIntegerValueField(.mouseEventClickState, value: Int64(number))
            try requireForeground(pid)
            down.post(tap: .cghidEventTap)
            up.post(tap: .cghidEventTap)
        }
    }

    private func typeText(_ text: String, pid: pid_t? = nil) throws {
        try requireEventPosting()
        for character in text {
            try Task.checkCancellation()
            try checkUserInterruption()
            if let pid, character == "\n" || character == "\r\n" || character == "\r" {
                try pressKeyExpression("Return", pid: pid)
                continue
            }
            let units = Array(String(character).utf16)
            guard let down = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: true),
                  let up = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: false) else {
                throw NativeComputerUseError.actionFailed("Unable to create keyboard event")
            }
            units.withUnsafeBufferPointer { buffer in
                guard let pointer = buffer.baseAddress else { return }
                down.keyboardSetUnicodeString(stringLength: units.count, unicodeString: pointer)
                up.keyboardSetUnicodeString(stringLength: units.count, unicodeString: pointer)
            }
            if let pid {
                down.postToPid(pid)
                up.postToPid(pid)
            } else {
                down.post(tap: .cghidEventTap)
                up.post(tap: .cghidEventTap)
            }
        }
    }

    private func pressKeyExpression(_ expression: String, pid: pid_t) throws {
        let keys = try MacKeyExpression.parse(expression)
        for key in keys {
            try requireEventPosting()
            try checkUserInterruption()
            guard let down = CGEvent(keyboardEventSource: nil, virtualKey: key.code, keyDown: true),
                  let up = CGEvent(keyboardEventSource: nil, virtualKey: key.code, keyDown: false) else {
                throw NativeComputerUseError.actionFailed("Unable to create key event")
            }
            down.flags = key.flags
            up.flags = key.flags
            down.postToPid(pid)
            up.postToPid(pid)
        }
    }

    private func pressKey(_ key: String, modifiers: [String]) throws {
        try requireEventPosting()
        let codes: [String: CGKeyCode] = [
            "return": 36, "tab": 48, "space": 49, "delete": 51,
            "escape": 53, "left": 123, "right": 124, "down": 125, "up": 126,
            "a": 0, "c": 8, "v": 9, "x": 7, "z": 6, "s": 1
        ]
        guard let code = codes[key.lowercased()] else {
            throw ComputerUseError.invalidRequest("Unsupported key")
        }
        var flags: CGEventFlags = []
        if modifiers.contains("command") { flags.insert(.maskCommand) }
        if modifiers.contains("control") { flags.insert(.maskControl) }
        if modifiers.contains("option") { flags.insert(.maskAlternate) }
        if modifiers.contains("shift") { flags.insert(.maskShift) }
        guard let down = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: true),
              let up = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: false) else {
            throw NativeComputerUseError.actionFailed("Unable to create key event")
        }
        down.flags = flags
        up.flags = flags
        down.post(tap: .cghidEventTap)
        up.post(tap: .cghidEventTap)
    }

    private func scroll(deltaX: Double, deltaY: Double, point: CGPoint? = nil,
                        pid: pid_t? = nil) throws {
        try requireEventPosting()
        guard let event = CGEvent(scrollWheelEvent2Source: nil, units: .pixel,
                                  wheelCount: 2, wheel1: Int32(deltaY), wheel2: Int32(deltaX),
                                  wheel3: 0) else {
            throw NativeComputerUseError.actionFailed("Unable to create scroll event")
        }
        if let point { event.location = point }
        try requireForeground(pid)
        event.post(tap: .cghidEventTap)
    }
}
