import Foundation

public final class ComputerUseWire {
    private let service: NativeComputerUseService

    public init(service: NativeComputerUseService) { self.service = service }

    public func handle(line: String) async -> String {
        var requestId = "invalid"
        if let data = line.data(using: .utf8),
           let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let id = object["requestId"] as? String,
           (1...128).contains(id.count) { requestId = id }
        do {
            let request = try ComputerUseRequest.decode(line: line)
            requestId = request.requestId
            let result = try await service.execute(request)
            return encode(["version": 1, "requestId": requestId, "ok": true,
                           "result": result])
        } catch {
            let code: String
            let message: String
            switch error {
            case ComputerUseError.appForbidden:
                code = "APP_FORBIDDEN"; message = "Application forbidden by Computer Use policy"
            case ComputerUseError.appDenied:
                code = "APP_DENIED"; message = "Application denied by organization policy"
            case ComputerUseError.ambiguousApp:
                code = "AMBIGUOUS_APP"; message = "Use an unambiguous application identifier"
            case ComputerUseError.appBusy:
                code = "APP_BUSY"; message = "Application is in use by another session"
            case ComputerUseError.userStoppedSession:
                code = "USER_STOPPED_SESSION"; message = "User stopped the Computer Use session"
            case ComputerUseError.userIntervened:
                code = "USER_INTERVENED"; message = "User input interrupted the current action"
            case ComputerUseError.backgroundInputUnsupported:
                code = "BACKGROUND_INPUT_UNSUPPORTED"; message = "Bring the target application to the foreground"
            case ComputerUseError.invalidRequest(let detail):
                code = "INVALID_REQUEST"; message = detail
            case ComputerUseError.staleReference:
                code = "STALE_REFERENCE"; message = "Observe the current interface again"
            case ComputerUseError.timedOut:
                code = "TIMED_OUT"; message = "Request deadline elapsed"
            case ComputerUseError.cancelled, is CancellationError:
                code = "CANCELLED"; message = "Request cancelled"
            case NativeComputerUseError.accessibilityDenied:
                code = "ACCESSIBILITY_DENIED"; message = "Enable Accessibility for Action-Driver Computer Use"
            case NativeComputerUseError.screenRecordingDenied:
                code = "SCREEN_RECORDING_DENIED"; message = "Enable Screen Recording for Action-Driver Computer Use"
            case NativeComputerUseError.eventPostingDenied:
                code = "ACCESSIBILITY_DENIED"; message = "Allow Action-Driver Computer Use to control the Mac"
            case NativeComputerUseError.noFrontmostApplication:
                code = "ENGINE_UNAVAILABLE"; message = "No foreground application"
            case NativeComputerUseError.selfIsFrontmost:
                code = "ENGINE_UNAVAILABLE"
                message = "The Computer Use window is in front; bring the target app forward and observe again"
            case NativeComputerUseError.actionFailed(let detail):
                code = "ACTION_FAILED"; message = detail
            default:
                code = "ACTION_FAILED"; message = "Computer Use operation failed"
            }
            return encode(["version": 1, "requestId": requestId, "ok": false,
                           "error": ["code": code, "message": message]])
        }
    }

    private func encode(_ object: [String: Any]) -> String {
        guard let data = try? JSONSerialization.data(withJSONObject: object),
              let text = String(data: data, encoding: .utf8) else {
            return #"{"version":1,"requestId":"invalid","ok":false,"error":{"code":"ACTION_FAILED","message":"Response serialization failed"}}"#
        }
        return text
    }
}
