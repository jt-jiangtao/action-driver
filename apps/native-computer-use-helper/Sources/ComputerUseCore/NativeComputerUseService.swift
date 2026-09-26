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
    private let gate = ObservationGate()
    private let permissions: SystemPermissionGate
    private struct ElementSnapshot {
        let element: AXUIElement
        let role: String?
        let title: String?
        let identifier: String?
        let frame: CGRect?
    }
    private var elements: [String: ElementSnapshot] = [:]

    public init(permissions: SystemPermissionGate = NativeSystemPermissionGate()) {
        self.permissions = permissions
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
        case .appState:
            guard let identifier = request.app else {
                throw ComputerUseError.invalidRequest("App identifier missing")
            }
            return try await appState(identifier: identifier, request: request)
        case .permissions:
            let prompt = request.prompt ?? false
            let prompted = { (name: String) -> Bool in
                prompt && (request.target == nil || request.target == name)
            }
            return [
                "accessibility": permissions.accessibility(prompt: prompted("accessibility")),
                "screenRecording": permissions.screenRecording(prompt: prompted("screenRecording")),
                "eventPosting": permissions.eventPosting(prompt: prompted("eventPosting")),
                "permissionTarget": "ActionDriver Computer Use"
            ]
        case .observe:
            return try observe(maxElements: request.maxElements ?? 200, maxDepth: request.maxDepth ?? 8)
        case .capture:
            return try await capture(maxWidth: request.maxWidth ?? 2048, maxHeight: request.maxHeight ?? 2048)
        case .act:
            guard let observationId = request.observationId, let action = request.action else {
                throw ComputerUseError.invalidRequest("Action requires an observation")
            }
            return try await act(action, observationId: observationId, request: request)
        case .cancel, .shutdown, .guidance:
            return ["accepted": true]
        }
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
    private func appState(identifier: String, request: ComputerUseRequest) async throws -> [String: Any] {
        let url = resolveApplication(identifier)
        guard let applicationURL = url else {
            throw NativeComputerUseError.actionFailed("Unknown application: \(identifier)")
        }
        var running = NSRunningApplication
            .runningApplications(withBundleIdentifier: Bundle(url: applicationURL)?.bundleIdentifier ?? "")
            .first
        if running == nil {
            let configuration = NSWorkspace.OpenConfiguration()
            configuration.activates = true
            running = try await NSWorkspace.shared.openApplication(
                at: applicationURL, configuration: configuration)
        }
        running?.activate()
        // Give LaunchServices a moment to make the app frontmost before reading its interface.
        let deadline = Date().addingTimeInterval(4)
        while Date() < deadline {
            if let frontmost = NSWorkspace.shared.frontmostApplication,
               frontmost.processIdentifier == running?.processIdentifier { break }
            try await Task.sleep(nanoseconds: 150_000_000)
        }
        var result = try observe(maxElements: request.maxElements ?? 200,
                                 maxDepth: request.maxDepth ?? 8)
        result["app"] = running?.bundleIdentifier ?? identifier
        result["text"] = renderText(from: result["tree"])
        result.removeValue(forKey: "windowId")
        if let maxWidth = request.maxWidth, let maxHeight = request.maxHeight {
            let captureResult = try await capture(maxWidth: maxWidth, maxHeight: maxHeight)
            result["screenshot"] = ["mimeType": captureResult["mimeType"] ?? "image/jpeg",
                                    "width": captureResult["width"] ?? 0,
                                    "height": captureResult["height"] ?? 0,
                                    "base64": captureResult["base64"] ?? "",
                                    "displayFrame": captureResult["displayFrame"] ?? [:]]
        }
        return result
    }

    private func resolveApplication(_ identifier: String) -> URL? {
        if identifier.contains("/") {
            let url = URL(fileURLWithPath: identifier)
            if FileManager.default.fileExists(atPath: url.path) { return url }
        }
        if let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: identifier) {
            return url
        }
        for directory in ["/Applications", "/System/Applications", NSHomeDirectory() + "/Applications"] {
            let candidate = URL(fileURLWithPath: directory)
                .appendingPathComponent(identifier).appendingPathExtension("app")
            if FileManager.default.fileExists(atPath: candidate.path) { return candidate }
            let urls = (try? FileManager.default.contentsOfDirectory(
                at: URL(fileURLWithPath: directory), includingPropertiesForKeys: nil)) ?? []
            if let match = urls.first(where: {
                $0.pathExtension == "app" &&
                $0.deletingPathExtension().lastPathComponent.caseInsensitiveCompare(identifier) == .orderedSame
            }) { return match }
        }
        return nil
    }

    /// Flattens the accessibility tree into the compact text form the reference skill expects.
    private func renderText(from tree: Any?) -> String {
        var lines: [String] = []
        func walk(_ node: Any?, depth: Int) {
            guard let node = node as? [String: Any] else { return }
            let role = node["role"] as? String ?? "element"
            let title = node["title"] as? String ?? node["description"] as? String ?? ""
            let ref = node["ref"] as? String ?? ""
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

    private func observe(maxElements: Int, maxDepth: Int) throws -> [String: Any] {
        guard AXIsProcessTrusted() else { throw NativeComputerUseError.accessibilityDenied }
        let app = try frontmost()
        let root = AXUIElementCreateApplication(app.pid)
        elements.removeAll(keepingCapacity: true)
        let observationId = gate.record(pid: app.pid, windowId: app.windowId)
        var remaining = maxElements
        // The walk fills a local table: the recursion interleaves many Accessibility IPC calls, so
        // it must not hold or re-enter dynamic exclusive access to the service's stored state.
        var snapshots: [String: ElementSnapshot] = [:]
        let tree = describe(root, depth: 0, maxDepth: maxDepth, remaining: &remaining,
                            snapshots: &snapshots)
        elements = snapshots
        return [
            "observationId": observationId,
            "application": ["name": app.name, "pid": Int(app.pid)],
            "windowId": app.windowId,
            "tree": tree,
            "truncated": remaining == 0
        ]
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
            var described: [[String: Any]] = []
            for child in children {
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

    private func capture(maxWidth: Int, maxHeight: Int) async throws -> [String: Any] {
        guard CGPreflightScreenCaptureAccess() else {
            throw NativeComputerUseError.screenRecordingDenied
        }
        let app = try frontmost()
        let content = try await SCShareableContent.current
        let display = content.displays.max { first, second in
            let firstArea = app.frame.map { first.frame.intersection($0) } ?? .null
            let secondArea = app.frame.map { second.frame.intersection($0) } ?? .null
            return firstArea.width * firstArea.height < secondArea.width * secondArea.height
        }
        guard let display else {
            throw NativeComputerUseError.actionFailed("No display available")
        }
        let filter = SCContentFilter(display: display, excludingWindows: [])
        let config = SCStreamConfiguration()
        let scale = min(1.0, Double(maxWidth) / Double(display.width),
                        Double(maxHeight) / Double(display.height))
        config.width = max(1, Int(Double(display.width) * scale))
        config.height = max(1, Int(Double(display.height) * scale))
        config.showsCursor = true
        let image = try await SCScreenshotManager.captureImage(contentFilter: filter,
                                                               configuration: config)
        guard let data = NSBitmapImageRep(cgImage: image).representation(
            using: .jpeg, properties: [.compressionFactor: 0.75]
        ) else { throw NativeComputerUseError.actionFailed("Screenshot encoding failed") }
        elements.removeAll(keepingCapacity: true)
        let observationId = gate.record(pid: app.pid, windowId: app.windowId)
        return ["observationId": observationId, "pid": Int(app.pid),
                "windowId": app.windowId, "displayId": display.displayID,
                "displayFrame": ["x": display.frame.origin.x, "y": display.frame.origin.y,
                                 "width": display.frame.width, "height": display.frame.height],
                "mimeType": "image/jpeg", "width": config.width,
                "height": config.height, "base64": data.base64EncodedString()]
    }

    private func act(_ action: ComputerUseAction, observationId: String,
                     request: ComputerUseRequest) async throws -> [String: Any] {
        guard AXIsProcessTrusted() else { throw NativeComputerUseError.accessibilityDenied }
        let app = try frontmost()
        try gate.validate(observationId: observationId, pid: app.pid, windowId: app.windowId)
        try checkDeadline(request)
        switch action.type {
        case "click-element":
            guard let reference = action.elementRef, let snapshot = elements[reference] else {
                throw ComputerUseError.staleReference
            }
            let element = snapshot.element
            guard (attributeValue(element, kAXRoleAttribute as CFString) as? String) == snapshot.role,
                  (attributeValue(element, kAXTitleAttribute as CFString) as? String) == snapshot.title,
                  (attributeValue(element, kAXIdentifierAttribute as CFString) as? String) == snapshot.identifier,
                  elementFrame(element) == snapshot.frame else {
                throw ComputerUseError.staleReference
            }
            if AXUIElementPerformAction(element, kAXPressAction as CFString) != .success {
                guard let frame = elementFrame(element) else { throw ComputerUseError.staleReference }
                try click(CGPoint(x: frame.midX, y: frame.midY))
            }
        case "click":
            try click(CGPoint(x: action.x ?? 0, y: action.y ?? 0))
        case "type":
            try typeText(action.text ?? "")
        case "key":
            try pressKey(action.key ?? "", modifiers: action.modifiers)
        case "scroll":
            try scroll(deltaX: action.deltaX ?? 0, deltaY: action.deltaY ?? 0)
        case "wait":
            try await Task.sleep(nanoseconds: UInt64(action.milliseconds ?? 0) * 1_000_000)
        case "set-value":
            let element = try staleCheckedElement(action.elementRef)
            guard AXUIElementSetAttributeValue(element, kAXValueAttribute as CFString,
                                               (action.value ?? "") as CFTypeRef) == .success else {
                throw NativeComputerUseError.actionFailed("Unable to set the element value")
            }
        case "paste":
            try paste(text: action.text ?? "", format: action.format ?? "text")
        case "select-text":
            try selectText(in: staleCheckedElement(action.elementRef), action: action)
        case "drag":
            try drag(from: CGPoint(x: action.fromX ?? 0, y: action.fromY ?? 0),
                     to: CGPoint(x: action.toX ?? 0, y: action.toY ?? 0))
        case "secondary-action":
            let element = try staleCheckedElement(action.elementRef)
            guard AXUIElementPerformAction(element, (action.actionName ?? "") as CFString) == .success else {
                throw NativeComputerUseError.actionFailed(
                    "The element does not expose the requested secondary action")
            }
        default:
            throw ComputerUseError.invalidRequest("Unsupported action")
        }
        try checkDeadline(request)
        return ["executed": true, "application": app.name, "pid": Int(app.pid)]
    }

    private func requireEventPosting() throws {
        guard CGPreflightPostEventAccess() else { throw NativeComputerUseError.eventPostingDenied }
    }

    /// Re-validates a stored element reference against its live attributes before acting on it.
    private func staleCheckedElement(_ reference: String?) throws -> AXUIElement {
        guard let reference, let snapshot = elements[reference] else {
            throw ComputerUseError.staleReference
        }
        let element = snapshot.element
        guard (attributeValue(element, kAXRoleAttribute as CFString) as? String) == snapshot.role,
              (attributeValue(element, kAXTitleAttribute as CFString) as? String) == snapshot.title,
              (attributeValue(element, kAXIdentifierAttribute as CFString) as? String) == snapshot.identifier,
              elementFrame(element) == snapshot.frame else {
            throw ComputerUseError.staleReference
        }
        return element
    }

    /// Pastes through the system pasteboard and restores whatever the user had copied before.
    private func paste(text: String, format: String) throws {
        try requireEventPosting()
        let pasteboard = NSPasteboard.general
        let saved = pasteboard.pasteboardItems?.compactMap { item
            -> [NSPasteboard.PasteboardType: Data]? in
            var copy: [NSPasteboard.PasteboardType: Data] = [:]
            for type in item.types { if let data = item.data(forType: type) { copy[type] = data } }
            return copy.isEmpty ? nil : copy
        }
        pasteboard.clearContents()
        switch format {
        case "html": pasteboard.setString(text, forType: .html)
        default: pasteboard.setString(text, forType: .string)
        }
        try pressKey("v", modifiers: ["command"])
        guard let saved, !saved.isEmpty else { return }
        pasteboard.clearContents()
        pasteboard.writeObjects(saved.map { entry in
            let item = NSPasteboardItem()
            for (type, data) in entry { item.setData(data, forType: type) }
            return item
        })
    }

    private func drag(from start: CGPoint, to end: CGPoint) throws {
        try requireEventPosting()
        guard let down = CGEvent(mouseEventSource: nil, mouseType: .leftMouseDown,
                                 mouseCursorPosition: start, mouseButton: .left),
              let move = CGEvent(mouseEventSource: nil, mouseType: .leftMouseDragged,
                                 mouseCursorPosition: end, mouseButton: .left),
              let up = CGEvent(mouseEventSource: nil, mouseType: .leftMouseUp,
                               mouseCursorPosition: end, mouseButton: .left) else {
            throw NativeComputerUseError.actionFailed("Unable to create drag events")
        }
        down.post(tap: .cghidEventTap)
        move.post(tap: .cghidEventTap)
        up.post(tap: .cghidEventTap)
    }

    private func selectText(in element: AXUIElement, action: ComputerUseAction) throws {
        guard let current = attributeValue(element, kAXValueAttribute as CFString) as? String,
              let target = action.text, !target.isEmpty else {
            throw NativeComputerUseError.actionFailed("The element has no selectable text value")
        }
        var matches: [Range<String.Index>] = []
        var searchStart = current.startIndex
        while let found = current.range(of: target, range: searchStart..<current.endIndex) {
            matches.append(found)
            searchStart = found.upperBound
        }
        let disambiguated = matches.first { range in
            let prefixMatches = action.prefix.map { !$0.isEmpty &&
                current[..<range.lowerBound].hasSuffix($0) } ?? true
            let suffixMatches = action.suffix.map { !$0.isEmpty &&
                current[range.upperBound...].hasPrefix($0) } ?? true
            return prefixMatches && suffixMatches
        }
        guard let range = disambiguated else {
            throw NativeComputerUseError.actionFailed("Text not found in the element value")
        }
        var lower = current.distance(from: current.startIndex, to: range.lowerBound)
        var upper = current.distance(from: current.startIndex, to: range.upperBound)
        switch action.selectionType ?? "text" {
        case "cursor-before": upper = lower
        case "cursor-after": lower = upper
        default: break
        }
        var cfRange = CFRange(location: lower, length: max(0, upper - lower))
        guard let value = AXValueCreate(.cfRange, &cfRange),
              AXUIElementSetAttributeValue(element, kAXSelectedTextRangeAttribute as CFString,
                                           value) == .success else {
            throw NativeComputerUseError.actionFailed("Unable to set the selection range")
        }
    }

    private func click(_ point: CGPoint) throws {
        try requireEventPosting()
        guard let down = CGEvent(mouseEventSource: nil, mouseType: .leftMouseDown,
                                 mouseCursorPosition: point, mouseButton: .left),
              let up = CGEvent(mouseEventSource: nil, mouseType: .leftMouseUp,
                               mouseCursorPosition: point, mouseButton: .left) else {
            throw NativeComputerUseError.actionFailed("Unable to create click event")
        }
        down.post(tap: .cghidEventTap)
        up.post(tap: .cghidEventTap)
    }

    private func typeText(_ text: String) throws {
        try requireEventPosting()
        for character in text {
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
            down.post(tap: .cghidEventTap)
            up.post(tap: .cghidEventTap)
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

    private func scroll(deltaX: Double, deltaY: Double) throws {
        try requireEventPosting()
        guard let event = CGEvent(scrollWheelEvent2Source: nil, units: .pixel,
                                  wheelCount: 2, wheel1: Int32(deltaY), wheel2: Int32(deltaX),
                                  wheel3: 0) else {
            throw NativeComputerUseError.actionFailed("Unable to create scroll event")
        }
        event.post(tap: .cghidEventTap)
    }
}
