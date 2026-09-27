import Foundation

enum InterfaceStability {
    /// Compare two adjacent reads; bound animated interfaces to five seconds of sampling. The bound
    /// counts the reads themselves: reading a large tree takes about a second, so counting only the
    /// pauses would let an interface that never settles hold the request for every sample.
    static func read<Value>(maxSamples: Int = 21,
        budget: TimeInterval = 5,
        now: () -> TimeInterval = { ProcessInfo.processInfo.systemUptime },
        pause: () async throws -> Void = { try await Task.sleep(nanoseconds: 250_000_000) },
        sample: () async throws -> (String, Value)) async throws -> Value {
        guard maxSamples > 0 else { throw ComputerUseError.invalidRequest("Invalid sample limit") }
        let started = now()
        var previous: String?
        for index in 0..<maxSamples {
            try Task.checkCancellation()
            let (fingerprint, value) = try await sample()
            if fingerprint == previous || index == maxSamples - 1 || now() - started >= budget {
                return value
            }
            previous = fingerprint
            try await pause()
        }
        throw ComputerUseError.invalidRequest("No interface sample")
    }
}
