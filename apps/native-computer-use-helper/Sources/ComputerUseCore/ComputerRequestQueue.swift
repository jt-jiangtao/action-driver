import Foundation

/// Actor reentrancy must not let a second native operation run while the first awaits.
public actor ComputerRequestQueue {
    private struct Job {
        let id: String
        let operation: @Sendable () async throws -> String
        let continuation: CheckedContinuation<String, Error>
    }
    private var waiting: [Job] = []
    private var active: (id: String, task: Task<Void, Never>)?

    public init() {}

    public func submit(id: String, operation: @escaping @Sendable () async throws -> String) async throws -> String {
        guard active?.id != id, !waiting.contains(where: { $0.id == id }) else {
            throw ComputerUseError.invalidRequest("Duplicate request ID")
        }
        return try await withCheckedThrowingContinuation { continuation in
            waiting.append(Job(id: id, operation: operation, continuation: continuation))
            startNext()
        }
    }

    @discardableResult
    public func cancel(id: String) -> Bool {
        if let index = waiting.firstIndex(where: { $0.id == id }) {
            let job = waiting.remove(at: index)
            job.continuation.resume(throwing: ComputerUseError.cancelled)
            return true
        }
        if active?.id == id {
            active?.task.cancel()
            return true
        }
        return false
    }

    private func startNext() {
        guard active == nil, !waiting.isEmpty else { return }
        let job = waiting.removeFirst()
        let task = Task {
            do {
                try Task.checkCancellation()
                job.continuation.resume(returning: try await job.operation())
            }
            catch { job.continuation.resume(throwing: error) }
            finish(id: job.id)
        }
        active = (id: job.id, task: task)
    }

    private func finish(id: String) {
        guard active?.id == id else { return }
        active = nil
        startNext()
    }
}
