import AppKit
import ComputerUseCore
import Foundation

private func encodeLine(_ object: [String: Any]) -> String {
    guard let data = try? JSONSerialization.data(withJSONObject: object),
          let line = String(data: data, encoding: .utf8) else { return "" }
    return line
}

private actor RequestCoordinator {
    private let wire: ComputerUseWire
    private let guidance: GuidanceWindowController

    init(service: NativeComputerUseService, guidance: GuidanceWindowController) {
        self.guidance = guidance
        self.wire = ComputerUseWire(service: service)
    }

    func accept(_ line: String) async -> String {
        guard let request = try? ComputerUseRequest.decode(line: line) else {
            return await wire.handle(line: line)
        }
        switch request.operation {
        case .guidance:
            await MainActor.run { guidance.show() }
            return encodeLine(["version": 1, "requestId": request.requestId,
                               "ok": true, "result": ["accepted": true]])
        case .shutdown:
            let reply = await wire.handle(line: line)
            DispatchQueue.main.async { NSApp.terminate(nil) }
            return reply
        default:
            // The socket loop serves one request at a time, so requests stay serialised.
            return await wire.handle(line: line)
        }
    }
}

private final class ReplyBox: @unchecked Sendable {
    var value = ""
}

private func argument(_ name: String) -> String? {
    let arguments = ProcessInfo.processInfo.arguments
    guard let index = arguments.firstIndex(of: name), index + 1 < arguments.count else { return nil }
    return arguments[index + 1]
}

private func readToken(at path: String) -> String? {
    // The launcher owns this file: keeping it lets a relaunched app reuse the running helper.
    guard let text = try? String(contentsOfFile: path, encoding: .utf8) else { return nil }
    let token = text.trimmingCharacters(in: .whitespacesAndNewlines)
    return token.isEmpty ? nil : token
}

private func runServer(socketPath: String, token: String, coordinator: RequestCoordinator) {
    let server = ComputerUseSocketServer(socketPath: socketPath, token: token)
    server.run { line in
        // The socket loop is synchronous, so each request waits for its async reply here.
        let semaphore = DispatchSemaphore(value: 0)
        let box = ReplyBox()
        Task {
            box.value = await coordinator.accept(line)
            semaphore.signal()
        }
        semaphore.wait()
        return box.value
    }
}

@main
struct ComputerUseMain {
    static func main() {
        guard let socketPath = argument("--socket"),
              let tokenPath = argument("--token-file"),
              let token = readToken(at: tokenPath) else {
            FileHandle.standardError.write(Data("COMPUTER_USE_SOCKET_ARGUMENTS_MISSING\n".utf8))
            exit(2)
        }
        let application = NSApplication.shared
        application.setActivationPolicy(.accessory)
        BundleRegistration.registerHelper()
        let coordinator = MainActor.assumeIsolated { () -> RequestCoordinator in
            let service = NativeComputerUseService()
            return RequestCoordinator(
                service: service,
                guidance: GuidanceWindowController(service: service)
            )
        }
        Thread.detachNewThread {
            runServer(socketPath: socketPath, token: token, coordinator: coordinator)
        }
        application.run()
    }
}
