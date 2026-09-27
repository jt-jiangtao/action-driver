import Darwin
import Foundation
import XCTest
@testable import ComputerUseCore

final class SocketOwnershipTests: XCTestCase {
    func testAnotherServerCannotReplaceALiveListener() throws {
        let directory = URL(fileURLWithPath: "/tmp/adu-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let path = directory.appendingPathComponent("socket").path
        let first = ComputerUseSocketServer(socketPath: path, token: "first")
        let listener = first.listenOnSocket()
        XCTAssertGreaterThanOrEqual(listener, 0)
        defer { if listener >= 0 { Darwin.close(listener) } }
        let second = ComputerUseSocketServer(socketPath: path, token: "second")
        let duplicate = second.listenOnSocket()
        defer { if duplicate >= 0 { Darwin.close(duplicate) } }
        XCTAssertEqual(duplicate, -1)
        XCTAssertTrue(FileManager.default.fileExists(atPath: path))
    }

    func testStaleSocketCanBeReplacedButRegularFilesArePreserved() throws {
        let directory = URL(fileURLWithPath: "/tmp/adu-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let path = directory.appendingPathComponent("socket").path
        let server = ComputerUseSocketServer(socketPath: path, token: "token")
        let stale = server.listenOnSocket()
        XCTAssertGreaterThanOrEqual(stale, 0)
        if stale >= 0 { Darwin.close(stale) }
        let replacement = server.listenOnSocket()
        XCTAssertGreaterThanOrEqual(replacement, 0)
        if replacement >= 0 { Darwin.close(replacement) }
        try FileManager.default.removeItem(atPath: path)
        try "preserve me".write(toFile: path, atomically: true, encoding: .utf8)
        let overFile = server.listenOnSocket()
        defer { if overFile >= 0 { Darwin.close(overFile) } }
        XCTAssertEqual(overFile, -1)
        XCTAssertEqual(try String(contentsOfFile: path), "preserve me")
    }
}
