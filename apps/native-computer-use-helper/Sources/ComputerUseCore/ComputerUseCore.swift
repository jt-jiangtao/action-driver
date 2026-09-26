import Foundation

public enum ComputerUseError: Error, Equatable {
    case invalidRequest(String)
    case staleReference
    case timedOut
    case cancelled
    case appForbidden, appDenied, ambiguousApp, appBusy
    case userStoppedSession, userIntervened, backgroundInputUnsupported
}

public enum ComputerUseOperation: String {
    case permissions, act, cancel, shutdown, guidance
    case listApps = "list-apps"
    case appState = "app-state"
    case appPolicy = "app-policy"
    case sessionStart = "session-start"
    case sessionEnd = "session-end"
}

public struct ComputerUseAction {
    public let type: String
    public let x: Double?
    public let y: Double?
    public let elementRef: String?
    public let text: String?
    public let key: String?
    public let modifiers: [String]
    public let deltaX: Double?
    public let deltaY: Double?
    public let milliseconds: Int?
    public let value: String?
    public let format: String?
    public let prefix: String?
    public let suffix: String?
    public let selectionType: String?
    public let fromX: Double?
    public let fromY: Double?
    public let toX: Double?
    public let toY: Double?
    public let actionName: String?
    public let elementIndex: Int?
    public let mouseButton: String?
    public let clickCount: Int?
}

public struct ComputerUseRequest {
    public let requestId: String
    public let deadlineUnixMs: Int64
    public let operation: ComputerUseOperation
    public let maxElements: Int?
    public let maxDepth: Int?
    public let action: ComputerUseAction?
    public let targetRequestId: String?
    public let prompt: Bool?
    public let target: String?
    public let app: String?
    public let disableDiff: Bool?
    public let sessionId: String?
    public let screenshot: Bool?

    public static func decode(line: String) throws -> ComputerUseRequest {
        guard let data = line.data(using: .utf8), data.count <= 128 * 1024,
              let object = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              object["version"] as? Int == 1,
              let requestId = object["requestId"] as? String, (1...128).contains(requestId.count),
              let deadline = object["deadlineUnixMs"] as? Int64, deadline > 0,
              let rawOperation = object["operation"] as? String,
              let operation = ComputerUseOperation(rawValue: rawOperation) else {
            throw ComputerUseError.invalidRequest("Invalid request envelope")
        }
        let common: Set<String> = ["version", "requestId", "deadlineUnixMs", "operation"]
        var expected = common
        var maxElements: Int?
        var maxDepth: Int?
        var action: ComputerUseAction?
        var targetRequestId: String?
        var prompt: Bool?
        var target: String?
        var app: String?
        var disableDiff: Bool?
        var sessionId: String?
        var screenshot: Bool?
        if let rawSession = object["sessionId"] {
            guard operation == .appState || operation == .act
                    || operation == .sessionStart || operation == .sessionEnd,
                  let id = rawSession as? String, (1...128).contains(id.count) else {
                throw ComputerUseError.invalidRequest("Invalid application session")
            }
            sessionId = id
            expected.insert("sessionId")
        }

        switch operation {
        case .listApps:
            break
        case .sessionStart, .sessionEnd:
            guard sessionId != nil else {
                throw ComputerUseError.invalidRequest("Session operations require a sessionId")
            }
        case .appPolicy:
            expected.insert("app")
            guard let id = object["app"] as? String, (1...512).contains(id.count) else {
                throw ComputerUseError.invalidRequest("App identifier missing")
            }
            app = id
        case .appState:
            expected.formUnion(["app", "maxElements", "maxDepth"])
            guard let requestedApp = object["app"] as? String,
                  (1...512).contains(requestedApp.count), sessionId != nil else {
                throw ComputerUseError.invalidRequest("Application state requires app and sessionId")
            }
            app = requestedApp
            maxElements = try boundedInt(object["maxElements"], 1...500)
            maxDepth = try boundedInt(object["maxDepth"], 1...12)
            if let diff = object["disableDiff"] {
                guard let flag = diff as? Bool else {
                    throw ComputerUseError.invalidRequest("disableDiff must be a boolean")
                }
                disableDiff = flag
                expected.insert("disableDiff")
            }
            if let rawScreenshot = object["screenshot"] {
                guard let flag = rawScreenshot as? Bool,
                      CFGetTypeID(rawScreenshot as CFTypeRef) == CFBooleanGetTypeID() else {
                    throw ComputerUseError.invalidRequest("Invalid window screenshot flag")
                }
                screenshot = flag
                expected.insert("screenshot")
            }
        case .permissions:
            if let rawPrompt = object["prompt"] {
                guard let flag = rawPrompt as? Bool else {
                    throw ComputerUseError.invalidRequest("Prompt flag must be a boolean")
                }
                prompt = flag
                expected.insert("prompt")
            }
            if let rawTarget = object["target"] {
                guard let value = rawTarget as? String,
                      ["accessibility", "screenRecording", "eventPosting"].contains(value) else {
                    throw ComputerUseError.invalidRequest("Unknown permission target")
                }
                target = value
                expected.insert("target")
            }
        case .shutdown, .guidance:
            break
        case .act:
            expected.insert("action")
            guard let actionObject = object["action"] as? [String: Any] else {
                throw ComputerUseError.invalidRequest("Action missing")
            }
            expected.insert("app")
            guard let rawApp = object["app"], let identifier = rawApp as? String,
                  (1...512).contains(identifier.count), sessionId != nil else {
                throw ComputerUseError.invalidRequest("Application action requires app and sessionId")
            }
            app = identifier
            action = try decodeIndexedAction(actionObject)
        case .cancel:
            expected.insert("targetRequestId")
            guard let target = object["targetRequestId"] as? String,
                  (1...128).contains(target.count) else {
                throw ComputerUseError.invalidRequest("Cancellation target missing")
            }
            targetRequestId = target
        }
        guard Set(object.keys) == expected else {
            throw ComputerUseError.invalidRequest("Unexpected request fields")
        }
        return ComputerUseRequest(
            requestId: requestId, deadlineUnixMs: deadline, operation: operation,
            maxElements: maxElements, maxDepth: maxDepth, action: action,
            targetRequestId: targetRequestId, prompt: prompt, target: target,
            app: app, disableDiff: disableDiff, sessionId: sessionId, screenshot: screenshot
        )
    }

    private static func boundedInt(_ value: Any?, _ range: ClosedRange<Int>) throws -> Int {
        guard let value, CFGetTypeID(value as CFTypeRef) != CFBooleanGetTypeID(),
              let number = value as? Int, range.contains(number) else {
            throw ComputerUseError.invalidRequest("Integer argument out of range")
        }
        return number
    }

    private static func boundedDouble(_ value: Any?, _ range: ClosedRange<Double>) throws -> Double {
        guard let value, CFGetTypeID(value as CFTypeRef) != CFBooleanGetTypeID(),
              let number = value as? Double, number.isFinite, range.contains(number) else {
            throw ComputerUseError.invalidRequest("Coordinate out of range")
        }
        return number
    }

    private static func decodeIndexedAction(_ object: [String: Any]) throws -> ComputerUseAction {
        guard let type = object["type"] as? String, object["elementRef"] == nil else {
            throw ComputerUseError.invalidRequest("Indexed actions cannot use elementRef")
        }
        var normalized = object
        var index: Int?
        var mouseButton: String?
        var clickCount: Int?
        var coordinateX: Double?
        var coordinateY: Double?
        let indexedTypes = ["click-element", "set-value", "select-text", "secondary-action"]
        if let rawIndex = normalized.removeValue(forKey: "elementIndex") {
            guard indexedTypes.contains(type) || type == "scroll" else {
                throw ComputerUseError.invalidRequest("This action has no indexed target")
            }
            index = try boundedInt(rawIndex, 0...1_000_000)
            if indexedTypes.contains(type) { normalized["elementRef"] = "indexed-target" }
        }
        if let rawButton = normalized.removeValue(forKey: "mouseButton") {
            guard ["click", "click-element"].contains(type), let button = rawButton as? String,
                  ["left", "right", "middle"].contains(button) else {
                throw ComputerUseError.invalidRequest("Invalid mouse button")
            }
            mouseButton = button
        }
        if let rawCount = normalized.removeValue(forKey: "clickCount") {
            guard ["click", "click-element"].contains(type) else {
                throw ComputerUseError.invalidRequest("This action has no click count")
            }
            clickCount = try boundedInt(rawCount, 1...3)
        }
        if type == "scroll" {
            if index == nil {
                coordinateX = try boundedDouble(normalized.removeValue(forKey: "x"), -100_000...100_000)
                coordinateY = try boundedDouble(normalized.removeValue(forKey: "y"), -100_000...100_000)
            } else if normalized["x"] != nil || normalized["y"] != nil {
                throw ComputerUseError.invalidRequest("Scroll must use one target")
            }
        }
        return try decodeAction(normalized, elementIndex: index, mouseButton: mouseButton,
                                clickCount: clickCount, coordinateX: coordinateX, coordinateY: coordinateY)
    }

    private static func decodeAction(_ object: [String: Any], elementIndex: Int? = nil,
                                     mouseButton: String? = nil, clickCount: Int? = nil,
                                     coordinateX: Double? = nil, coordinateY: Double? = nil) throws -> ComputerUseAction {
        guard let type = object["type"] as? String else {
            throw ComputerUseError.invalidRequest("Action type missing")
        }
        var expected: Set<String> = ["type"]
        var x: Double?, y: Double?, elementRef: String?, text: String?, key: String?
        var modifiers: [String] = []
        var deltaX: Double?, deltaY: Double?, milliseconds: Int?
        var value: String?, format: String?, prefix: String?, suffix: String?
        var selectionType: String?, fromX: Double?, fromY: Double?, toX: Double?, toY: Double?
        var actionName: String?
        switch type {
        case "click":
            expected.formUnion(["x", "y"])
            x = try boundedDouble(object["x"], -100_000...100_000)
            y = try boundedDouble(object["y"], -100_000...100_000)
        case "click-element":
            expected.insert("elementRef")
            guard let reference = object["elementRef"] as? String,
                  (1...256).contains(reference.count) else {
                throw ComputerUseError.invalidRequest("Element reference missing")
            }
            elementRef = reference
        case "type":
            expected.insert("text")
            guard let value = object["text"] as? String, value.count <= 8_192 else {
                throw ComputerUseError.invalidRequest("Text too long")
            }
            text = value
        case "key":
            expected.formUnion(["key", "modifiers"])
            guard let value = object["key"] as? String, (1...64).contains(value.count),
                  let flags = object["modifiers"] as? [String], flags.count <= 4,
                  flags.allSatisfy({ ["command", "control", "option", "shift"].contains($0) }) else {
                throw ComputerUseError.invalidRequest("Invalid key combination")
            }
            key = value
            modifiers = flags
        case "scroll":
            expected.formUnion(["deltaX", "deltaY"])
            deltaX = try boundedDouble(object["deltaX"], -10_000...10_000)
            deltaY = try boundedDouble(object["deltaY"], -10_000...10_000)
        case "wait":
            expected.insert("milliseconds")
            milliseconds = try boundedInt(object["milliseconds"], 0...10_000)
        case "set-value":
            expected.formUnion(["elementRef", "value"])
            guard let reference = object["elementRef"] as? String, (1...256).contains(reference.count),
                  let newValue = object["value"] as? String, newValue.count <= 8_192 else {
                throw ComputerUseError.invalidRequest("set-value requires an element reference and value")
            }
            elementRef = reference
            value = newValue
        case "paste":
            expected.formUnion(["text", "format"])
            guard let pasteText = object["text"] as? String, pasteText.count <= 200_000,
                  let pasteFormat = object["format"] as? String,
                  ["text", "md", "html"].contains(pasteFormat) else {
                throw ComputerUseError.invalidRequest("paste requires text and a supported format")
            }
            text = pasteText
            format = pasteFormat
        case "select-text":
            expected.formUnion(["elementRef", "text"])
            guard let reference = object["elementRef"] as? String, (1...256).contains(reference.count),
                  let target = object["text"] as? String, target.count <= 8_192 else {
                throw ComputerUseError.invalidRequest("select-text requires an element reference and text")
            }
            elementRef = reference
            text = target
            for (key, bound) in [("prefix", 2_048), ("suffix", 2_048)] {
                if let raw = object[key] {
                    guard let parsed = raw as? String, parsed.count <= bound else {
                        throw ComputerUseError.invalidRequest("select-text \(key) invalid")
                    }
                    expected.insert(key)
                    if key == "prefix" { prefix = parsed } else { suffix = parsed }
                }
            }
            if let raw = object["selectionType"] {
                guard let parsed = raw as? String,
                      ["text", "cursor-before", "cursor-after"].contains(parsed) else {
                    throw ComputerUseError.invalidRequest("select-text selectionType invalid")
                }
                expected.insert("selectionType")
                selectionType = parsed
            }
        case "drag":
            expected.formUnion(["fromX", "fromY", "toX", "toY"])
            fromX = try boundedDouble(object["fromX"], -100_000...100_000)
            fromY = try boundedDouble(object["fromY"], -100_000...100_000)
            toX = try boundedDouble(object["toX"], -100_000...100_000)
            toY = try boundedDouble(object["toY"], -100_000...100_000)
        case "secondary-action":
            expected.formUnion(["elementRef", "action"])
            guard let reference = object["elementRef"] as? String, (1...256).contains(reference.count),
                  let name = object["action"] as? String, (1...128).contains(name.count) else {
                throw ComputerUseError.invalidRequest("secondary-action requires an element reference and action")
            }
            elementRef = reference
            actionName = name
        default:
            throw ComputerUseError.invalidRequest("Unsupported action")
        }
        guard Set(object.keys) == expected else {
            throw ComputerUseError.invalidRequest("Unexpected action fields")
        }
        return ComputerUseAction(type: type, x: coordinateX ?? x, y: coordinateY ?? y,
                                 elementRef: elementIndex == nil ? elementRef : nil,
                                 text: text, key: key, modifiers: modifiers,
                                 deltaX: deltaX, deltaY: deltaY, milliseconds: milliseconds,
                                 value: value, format: format, prefix: prefix, suffix: suffix,
                                 selectionType: selectionType, fromX: fromX, fromY: fromY,
                                 toX: toX, toY: toY, actionName: actionName, elementIndex: elementIndex,
                                 mouseButton: mouseButton, clickCount: clickCount)
    }
}
