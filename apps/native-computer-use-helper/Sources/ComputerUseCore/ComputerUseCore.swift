import Foundation

public enum ComputerUseError: Error, Equatable {
    case invalidRequest(String)
    case staleReference
    case timedOut
    case cancelled
}

public enum ComputerUseOperation: String {
    case permissions, observe, capture, act, cancel, shutdown, guidance
    case listApps = "list-apps"
    case appState = "app-state"
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
}

public struct ComputerUseRequest {
    public let requestId: String
    public let deadlineUnixMs: Int64
    public let operation: ComputerUseOperation
    public let maxElements: Int?
    public let maxDepth: Int?
    public let maxWidth: Int?
    public let maxHeight: Int?
    public let observationId: String?
    public let action: ComputerUseAction?
    public let targetRequestId: String?
    public let prompt: Bool?
    public let target: String?
    public let app: String?
    public let disableDiff: Bool?

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
        var maxWidth: Int?
        var maxHeight: Int?
        var observationId: String?
        var action: ComputerUseAction?
        var targetRequestId: String?
        var prompt: Bool?
        var target: String?
        var app: String?
        var disableDiff: Bool?

        switch operation {
        case .listApps:
            break
        case .appState:
            expected.formUnion(["app", "maxElements", "maxDepth"])
            guard let requestedApp = object["app"] as? String,
                  (1...512).contains(requestedApp.count) else {
                throw ComputerUseError.invalidRequest("App identifier missing")
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
            if let capture = object["capture"] {
                expected.insert("capture")
                guard let captureObject = capture as? [String: Any],
                      Set(captureObject.keys) == ["maxWidth", "maxHeight"] else {
                    throw ComputerUseError.invalidRequest("Capture bounds invalid")
                }
                maxWidth = try boundedInt(captureObject["maxWidth"], 1...4096)
                maxHeight = try boundedInt(captureObject["maxHeight"], 1...4096)
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
        case .observe:
            expected.formUnion(["maxElements", "maxDepth"])
            maxElements = try boundedInt(object["maxElements"], 1...500)
            maxDepth = try boundedInt(object["maxDepth"], 1...12)
        case .capture:
            expected.formUnion(["maxWidth", "maxHeight"])
            maxWidth = try boundedInt(object["maxWidth"], 1...4096)
            maxHeight = try boundedInt(object["maxHeight"], 1...4096)
        case .act:
            expected.formUnion(["observationId", "action"])
            guard let observed = object["observationId"] as? String,
                  (1...128).contains(observed.count),
                  let actionObject = object["action"] as? [String: Any] else {
                throw ComputerUseError.invalidRequest("Action requires an observation")
            }
            observationId = observed
            action = try decodeAction(actionObject)
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
            maxElements: maxElements, maxDepth: maxDepth, maxWidth: maxWidth,
            maxHeight: maxHeight, observationId: observationId, action: action,
            targetRequestId: targetRequestId, prompt: prompt, target: target,
            app: app, disableDiff: disableDiff
        )
    }

    private static func boundedInt(_ value: Any?, _ range: ClosedRange<Int>) throws -> Int {
        guard let number = value as? Int, range.contains(number) else {
            throw ComputerUseError.invalidRequest("Integer argument out of range")
        }
        return number
    }

    private static func boundedDouble(_ value: Any?, _ range: ClosedRange<Double>) throws -> Double {
        guard let number = value as? Double, number.isFinite, range.contains(number) else {
            throw ComputerUseError.invalidRequest("Coordinate out of range")
        }
        return number
    }

    private static func decodeAction(_ object: [String: Any]) throws -> ComputerUseAction {
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
        return ComputerUseAction(type: type, x: x, y: y, elementRef: elementRef,
                                 text: text, key: key, modifiers: modifiers,
                                 deltaX: deltaX, deltaY: deltaY, milliseconds: milliseconds,
                                 value: value, format: format, prefix: prefix, suffix: suffix,
                                 selectionType: selectionType, fromX: fromX, fromY: fromY,
                                 toX: toX, toY: toY, actionName: actionName)
    }
}

public final class ObservationGate {
    private var current: (id: String, pid: pid_t, windowId: Int)?
    public init() {}
    public func record(pid: pid_t, windowId: Int) -> String {
        let id = UUID().uuidString
        current = (id, pid, windowId)
        return id
    }
    public func validate(observationId: String, pid: pid_t, windowId: Int) throws {
        guard let current, current.id == observationId,
              current.pid == pid, current.windowId == windowId else {
            throw ComputerUseError.staleReference
        }
    }
    public func invalidate() { current = nil }
}
