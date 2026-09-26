import AppKit
import ComputerUseCore
import Foundation

private actor OutputWriter {
    func send(_ line: String) {
        FileHandle.standardOutput.write(Data((line + "\n").utf8))
    }
}

private func encodeLine(_ object: [String: Any]) -> String {
    guard let data = try? JSONSerialization.data(withJSONObject: object),
          let line = String(data: data, encoding: .utf8) else { return "" }
    return line
}

private actor RequestCoordinator {
    private let wire: ComputerUseWire
    private let output = OutputWriter()
    private var current: (id: String, task: Task<Void, Never>)?
    private let guidance: GuidanceWindowController

    init(service: NativeComputerUseService, guidance: GuidanceWindowController) {
        self.guidance = guidance
        self.wire = ComputerUseWire(service: service)
    }

    func accept(_ line: String) async {
        guard let request = try? ComputerUseRequest.decode(line: line) else {
            await output.send(await wire.handle(line: line))
            return
        }
        if request.operation == .guidance {
            await MainActor.run { guidance.show() }
            await output.send(encodeLine(["version": 1, "requestId": request.requestId,
                                          "ok": true, "result": ["accepted": true]]))
            return
        }
        if request.operation == .cancel {
            if current?.id == request.targetRequestId { current?.task.cancel() }
            await output.send(await wire.handle(line: line))
            return
        }
        if request.operation == .shutdown {
            current?.task.cancel()
            await output.send(await wire.handle(line: line))
            Foundation.exit(0)
        }
        if current != nil {
            await output.send(encodeLine(["version": 1, "requestId": request.requestId,
                "ok": false, "error": ["code": "ENGINE_UNAVAILABLE", "message": "Computer Use is busy"]]))
            return
        }
        let id = request.requestId
        let task = Task { [wire, output] in
            let reply = await wire.handle(line: line)
            await output.send(reply)
            self.finished(id)
        }
        current = (id, task)
    }

    private func finished(_ id: String) {
        if current?.id == id { current = nil }
    }

    func waitForCurrent() async {
        await current?.task.value
    }
}

@main
struct ComputerUseMain {
    static func main() {
        let application = NSApplication.shared
        application.setActivationPolicy(.accessory)
        // `main()` already runs on the main thread, so the AppKit objects can be built inline while
        // the stdio protocol keeps running on its own thread.
        let coordinator = MainActor.assumeIsolated { () -> RequestCoordinator in
            let service = NativeComputerUseService()
            return RequestCoordinator(
                service: service,
                guidance: GuidanceWindowController(service: service)
            )
        }

        // The stdio protocol is served off the main thread so AppKit keeps the run loop and can
        // animate the guidance window.
        Thread.detachNewThread {
            while let line = readLine(strippingNewline: true) {
                let semaphore = DispatchSemaphore(value: 0)
                Task {
                    await coordinator.accept(line)
                    semaphore.signal()
                }
                semaphore.wait()
            }
            Task {
                await coordinator.waitForCurrent()
                await MainActor.run { NSApp.terminate(nil) }
            }
        }
        application.run()
    }
}
