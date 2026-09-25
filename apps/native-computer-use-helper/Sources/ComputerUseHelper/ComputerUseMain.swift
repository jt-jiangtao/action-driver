import ComputerUseCore
import Foundation

private actor OutputWriter {
    func send(_ line: String) {
        FileHandle.standardOutput.write(Data((line + "\n").utf8))
    }
}

private actor RequestCoordinator {
    private let wire = ComputerUseWire(service: NativeComputerUseService())
    private let output = OutputWriter()
    private var current: (id: String, task: Task<Void, Never>)?

    func accept(_ line: String) async {
        guard let request = try? ComputerUseRequest.decode(line: line) else {
            await output.send(await wire.handle(line: line))
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
            let response: [String: Any] = ["version": 1, "requestId": request.requestId,
                "ok": false, "error": ["code": "ENGINE_UNAVAILABLE", "message": "Computer Use is busy"]]
            if let data = try? JSONSerialization.data(withJSONObject: response),
               let line = String(data: data, encoding: .utf8) {
                await output.send(line)
            }
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
    static func main() async {
        let coordinator = RequestCoordinator()
        while let line = readLine(strippingNewline: true) {
            await coordinator.accept(line)
        }
        await coordinator.waitForCurrent()
    }
}
