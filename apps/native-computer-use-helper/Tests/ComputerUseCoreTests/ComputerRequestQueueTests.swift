import XCTest
@testable import ComputerUseCore

private actor QueueProbe {
    var events: [String] = []
    func record(_ value: String) { events.append(value) }
    func values() -> [String] { events }
}

final class ComputerRequestQueueTests: XCTestCase {
    func testCompletedOperationKeepsItsResultWhenCancellationArrivesTooLate() async throws {
        let queue = ComputerRequestQueue()
        let result = try await queue.submit(id: "done") { "executed" }
        let cancelled = await queue.cancel(id: "done")
        XCTAssertEqual(result, "executed")
        XCTAssertFalse(cancelled)
    }

    func testDuplicateActiveIdIsRejectedWithoutReplacingTheOperation() async throws {
        let queue = ComputerRequestQueue()
        let probe = QueueProbe()
        let first = Task {
            try await queue.submit(id: "same") {
                await probe.record("started")
                try await Task.sleep(nanoseconds: 50_000_000)
                return "original"
            }
        }
        while await probe.values().isEmpty { await Task.yield() }
        do { _ = try await queue.submit(id: "same") { "replacement" }; XCTFail("Duplicate accepted") }
        catch { XCTAssertEqual(error as? ComputerUseError, .invalidRequest("Duplicate request ID")) }
        let value = try await first.value
        XCTAssertEqual(value, "original")
    }
    func testAwaitingOperationDoesNotPermitAnotherOperationToRun() async throws {
        let queue = ComputerRequestQueue()
        let probe = QueueProbe()
        let first = Task {
            try await queue.submit(id: "first") {
                await probe.record("first-start")
                try await Task.sleep(nanoseconds: 50_000_000)
                await probe.record("first-end")
                return "first"
            }
        }
        while await probe.values().isEmpty { await Task.yield() }
        let second = Task {
            try await queue.submit(id: "second") {
                await probe.record("second")
                return "second"
            }
        }
        let a = try await first.value
        let b = try await second.value
        XCTAssertEqual(a, "first")
        XCTAssertEqual(b, "second")
        let values = await probe.values()
        XCTAssertEqual(values, ["first-start", "first-end", "second"])
    }

    func testQueuedCancellationDoesNotRunTheCancelledOperation() async throws {
        let queue = ComputerRequestQueue()
        let probe = QueueProbe()
        let first = Task {
            try await queue.submit(id: "first") {
                await probe.record("first")
                try await Task.sleep(nanoseconds: 100_000_000)
                return "first"
            }
        }
        while await probe.values().isEmpty { await Task.yield() }
        let second = Task {
            try await queue.submit(id: "cancelled") {
                await probe.record("must-not-run")
                return "cancelled"
            }
        }
        while !(await queue.cancel(id: "cancelled")) { await Task.yield() }
        do { _ = try await second.value; XCTFail("Cancelled request succeeded") }
        catch { XCTAssertEqual(error as? ComputerUseError, .cancelled) }
        _ = try await first.value
        let values = await probe.values()
        XCTAssertEqual(values, ["first"])
    }

    func testActiveCancellationReachesTheOperationAndReleasesTheQueue() async throws {
        let queue = ComputerRequestQueue()
        let probe = QueueProbe()
        let first = Task {
            try await queue.submit(id: "active") {
                await probe.record("active")
                try await Task.sleep(nanoseconds: 5_000_000_000)
                return "must-not-finish"
            }
        }
        while await probe.values().isEmpty { await Task.yield() }
        await queue.cancel(id: "active")
        do { _ = try await first.value; XCTFail("Cancelled request succeeded") }
        catch { XCTAssertTrue(error is CancellationError) }
        let next = try await queue.submit(id: "next") { "next" }
        XCTAssertEqual(next, "next")
    }
}
