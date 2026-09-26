import XCTest
@testable import ComputerUseCore

final class InterfaceStabilityTests: XCTestCase {
    func testWaitsForTwoConsecutiveEqualSamples() async throws {
        var values = ["old", "new", "new"], reads = 0, pauses = 0
        let result = try await InterfaceStability.read(maxSamples: 4,
            pause: { pauses += 1 }, sample: {
                reads += 1
                let value = values.removeFirst()
                return (value, value)
            })
        XCTAssertEqual(result, "new")
        XCTAssertEqual(reads, 3)
        XCTAssertEqual(pauses, 2)
    }
    func testBoundsAnInterfaceThatNeverSettlesAndReturnsLatestSample() async throws {
        var reads = 0
        let result = try await InterfaceStability.read(maxSamples: 3, pause: {}, sample: {
            reads += 1; return (String(reads), reads)
        })
        XCTAssertEqual(result, 3)
        XCTAssertEqual(reads, 3)
    }
    /// A large tree takes about a second per read; the five second bound must count the reads too,
    /// or an interface that never settles holds the request for 21 reads.
    func testTimeBoundIncludesTheReadsThemselves() async throws {
        var clock: TimeInterval = 0, reads = 0
        let result = try await InterfaceStability.read(maxSamples: 21, budget: 5, now: { clock },
            pause: { clock += 0.25 }, sample: {
                reads += 1; clock += 1.1; return (String(reads), reads)
            })
        XCTAssertEqual(reads, 4)
        XCTAssertEqual(result, 4)
    }
    func testCancellationDuringWaitStopsFurtherReads() async {
        var reads = 0
        do {
            _ = try await InterfaceStability.read(maxSamples: 3,
                pause: { throw CancellationError() }, sample: { reads += 1; return ("state", reads) })
            XCTFail("Cancelled read must fail")
        } catch { XCTAssertTrue(error is CancellationError) }
        XCTAssertEqual(reads, 1)
    }
}
