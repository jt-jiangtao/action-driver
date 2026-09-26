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

    private func frontmost() throws -> (pid: pid_t, windowId: Int, name: String, frame: CGRect?) {
        guard let app = NSWorkspace.shared.frontmostApplication else {
            throw NativeComputerUseError.noFrontmostApplication
        }
        let pid = app.processIdentifier
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
        let tree = describe(root, depth: 0, maxDepth: maxDepth, remaining: &remaining)
        return [
            "observationId": observationId,
            "application": ["name": app.name, "pid": Int(app.pid)],
            "windowId": app.windowId,
            "tree": tree,
            "truncated": remaining == 0
        ]
    }

    private func describe(_ element: AXUIElement, depth: Int, maxDepth: Int,
                          remaining: inout Int) -> [String: Any] {
        remaining -= 1
        let reference = UUID().uuidString
        elements[reference] = ElementSnapshot(
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
                described.append(describe(child, depth: depth + 1,
                                          maxDepth: maxDepth, remaining: &remaining))
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
        default:
            throw ComputerUseError.invalidRequest("Unsupported action")
        }
        try checkDeadline(request)
        return ["executed": true, "application": app.name, "pid": Int(app.pid)]
    }

    private func requireEventPosting() throws {
        guard CGPreflightPostEventAccess() else { throw NativeComputerUseError.eventPostingDenied }
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
