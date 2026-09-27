import Foundation
import XCTest
@testable import ComputerUseCore

final class SessionElementStoreTests: XCTestCase {
    func testReorderingKeepsIndexesAndRemovedIndexesNeverPointAtNewElements() throws {
        let store = SessionElementStore<String>(equal: ==)
        XCTAssertEqual(try store.record(session: "s", app: "a", pid: 1, elements: ["one", "two"]), [0, 1])
        XCTAssertEqual(try store.record(session: "s", app: "a", pid: 1, elements: ["two", "three"]), [1, 2])
        XCTAssertThrowsError(try store.resolve(session: "s", app: "a", pid: 1, index: 0))
        XCTAssertEqual(try store.resolve(session: "s", app: "a", pid: 1, index: 1), "two")
    }

    func testAFailedReadRequiresRereadingOnlyItsSessionAndApplication() throws {
        let store = SessionElementStore<String>(equal: ==)
        for (session, app) in [("s", "a"), ("s", "b"), ("other", "a")] {
            _ = try store.record(session: session, app: app, pid: 1, elements: ["button"])
        }
        store.invalidate(session: "s", app: "a")
        XCTAssertThrowsError(try store.resolve(session: "s", app: "a", pid: 1, index: 0))
        XCTAssertEqual(try store.resolve(session: "s", app: "b", pid: 1, index: 0), "button")
        XCTAssertEqual(try store.resolve(session: "other", app: "a", pid: 1, index: 0), "button")
        XCTAssertEqual(try store.record(session: "s", app: "a", pid: 1, elements: ["button"]), [0])
        XCTAssertEqual(try store.resolve(session: "s", app: "a", pid: 1, index: 0), "button")
    }

    func testRestartDoesNotReuseOldIndexesAndEndingSessionClearsReferences() throws {
        let store = SessionElementStore<String>(equal: ==)
        _ = try store.record(session: "s", app: "a", pid: 1, elements: ["button"])
        XCTAssertThrowsError(try store.resolve(session: "s", app: "a", pid: 2, index: 0))
        XCTAssertEqual(try store.record(session: "s", app: "a", pid: 2, elements: ["button"]), [1])
        XCTAssertThrowsError(try store.resolve(session: "s", app: "a", pid: 2, index: 0))
        store.removeSession("s")
        XCTAssertThrowsError(try store.resolve(session: "s", app: "a", pid: 2, index: 1))
    }
}
