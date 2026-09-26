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
    private let service: NativeComputerUseService
    private let guidance: GuidanceWindowController
    private let queue = ComputerRequestQueue()

    init(service: NativeComputerUseService, guidance: GuidanceWindowController) {
        self.service = service
        self.guidance = guidance
        self.wire = ComputerUseWire(service: service)
    }

    func accept(_ line: String) async -> String {
        guard let request = try? ComputerUseRequest.decode(line: line) else {
            return await wire.handle(line: line)
        }
        if request.operation == .cancel {
            let cancelled = await queue.cancel(id: request.targetRequestId ?? "")
            return encodeLine(["version": 1, "requestId": request.requestId, "ok": true,
                               "result": ["accepted": true, "cancelled": cancelled]])
        }
        do {
            return try await queue.submit(id: request.requestId) {
                await self.perform(request, line: line)
            }
        } catch {
            let cancelled = (error as? ComputerUseError) == .cancelled || error is CancellationError
            return encodeLine(["version": 1, "requestId": request.requestId, "ok": false,
                               "error": ["code": cancelled ? "CANCELLED" : "INVALID_REQUEST",
                                         "message": cancelled ? "Request cancelled before dispatch" : "Duplicate request ID"]])
        }
    }

    private func perform(_ request: ComputerUseRequest, line: String) async -> String {
        switch request.operation {
        case .guidance:
            await MainActor.run { guidance.show() }
            return encodeLine(["version": 1, "requestId": request.requestId,
                               "ok": true, "result": ["accepted": true]])
        case .shutdown:
            service.shutdownSupervision()
            let reply = await wire.handle(line: line)
            DispatchQueue.main.async { NSApp.terminate(nil) }
            return reply
        default:
            // The explicit queue holds its lease across awaits, unlike actor isolation alone.
            return await wire.handle(line: line)
        }
    }
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

private func runServer(socketPath: String, tokenPath: String, coordinator: RequestCoordinator) {
    let server = ComputerUseSocketServer(socketPath: socketPath,
                                        tokenFileURL: URL(fileURLWithPath: tokenPath))
    server.run { line, reply in
        Task {
            reply(await coordinator.accept(line))
        }
    }
}

@main
struct ComputerUseMain {
    static func main() {
        guard let socketPath = argument("--socket"),
              let tokenPath = argument("--token-file"),
              readToken(at: tokenPath) != nil else {
            FileHandle.standardError.write(Data("COMPUTER_USE_SOCKET_ARGUMENTS_MISSING\n".utf8))
            exit(2)
        }
        let application = NSApplication.shared
        application.setActivationPolicy(.accessory)
        BundleRegistration.registerHelper()
        let coordinator = MainActor.assumeIsolated { () -> RequestCoordinator in
            // The desktop app names itself so the helper can refuse to drive it (D9).
            let supervision = SessionSupervision()
            let service = NativeComputerUseService(
                ownerApplications: argument("--owner-app").map { [URL(fileURLWithPath: $0)] } ?? [],
                supervision: supervision,
                overlay: SessionOverlayController(supervision: supervision))
            return RequestCoordinator(
                service: service,
                guidance: GuidanceWindowController(service: service)
            )
        }
        Thread.detachNewThread {
            runServer(socketPath: socketPath, tokenPath: tokenPath, coordinator: coordinator)
        }
        application.run()
    }
}
