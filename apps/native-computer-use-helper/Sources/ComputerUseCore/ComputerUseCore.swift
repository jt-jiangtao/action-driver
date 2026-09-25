import Foundation

public enum ComputerUseError: Error, Equatable {
    case invalidRequest(String)
    case staleReference
    case timedOut
    case cancelled
}

public enum ComputerUseOperation: String {
    case permissions, observe, capture, act, cancel, shutdown
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

        switch operation {
        case .permissions, .shutdown:
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
            targetRequestId: targetRequestId
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
        default:
            throw ComputerUseError.invalidRequest("Unsupported action")
        }
        guard Set(object.keys) == expected else {
            throw ComputerUseError.invalidRequest("Unexpected action fields")
        }
        return ComputerUseAction(type: type, x: x, y: y, elementRef: elementRef,
                                 text: text, key: key, modifiers: modifiers,
                                 deltaX: deltaX, deltaY: deltaY, milliseconds: milliseconds)
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
