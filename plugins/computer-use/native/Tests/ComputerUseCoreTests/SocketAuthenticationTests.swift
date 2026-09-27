import Foundation
import XCTest
@testable import ComputerUseCore

final class SocketAuthenticationTests: XCTestCase {
    func testTokenReplacementDoesNotRequireAnotherHelperInstance() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let tokenFile = directory.appendingPathComponent("token")
        try "first-token".write(to: tokenFile, atomically: true, encoding: .utf8)
        let server = ComputerUseSocketServer(socketPath: directory.appendingPathComponent("socket").path,
                                            tokenFileURL: tokenFile)
        XCTAssertTrue(server.handshake("{\"token\":\"first-token\"}"))
        try "replacement-token\n".write(to: tokenFile, atomically: true, encoding: .utf8)
        XCTAssertFalse(server.handshake("{\"token\":\"first-token\"}"))
        XCTAssertTrue(server.handshake("{\"token\":\"replacement-token\"}"))
        try FileManager.default.removeItem(at: tokenFile)
        XCTAssertFalse(server.handshake("{\"token\":\"replacement-token\"}"))
    }

    func testEmptyOrMalformedTokensNeverAuthenticate() throws {
        let tokenFile = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: tokenFile) }
        try " \n".write(to: tokenFile, atomically: true, encoding: .utf8)
        let server = ComputerUseSocketServer(socketPath: "/unused", tokenFileURL: tokenFile)
        XCTAssertFalse(server.handshake("{\"token\":\"\"}"))
        XCTAssertFalse(server.handshake("{\"token\":42}"))
        XCTAssertFalse(server.handshake("not-json"))
    }
}
