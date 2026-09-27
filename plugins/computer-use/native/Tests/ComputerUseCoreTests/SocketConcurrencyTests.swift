import Darwin
import Foundation
import XCTest
@testable import ComputerUseCore

final class SocketConcurrencyTests: XCTestCase {
    func testRejectsOversizedHandshakeAndInvalidUTF8BeforeDispatch() throws {
        let cases: [Data] = [Data(repeating: 65, count: 4097),
                            Data("{\"token\":\"token\"}\n".utf8) + Data([0xff, 0x0a])]
        for payload in cases {
            var descriptors: [Int32] = [0, 0]
            XCTAssertEqual(socketpair(AF_UNIX, SOCK_STREAM, 0, &descriptors), 0)
            let client = descriptors[0], peer = descriptors[1]
            defer { Darwin.close(client) }
            let closed = expectation(description: "invalid connection closed")
            let server = ComputerUseSocketServer(socketPath: "/unused", token: "token")
            DispatchQueue.global().async {
                server.serve(peer) { _, _ in XCTFail("Invalid input must not reach the executor") }
                closed.fulfill()
            }
            XCTAssertEqual(payload.withUnsafeBytes { Darwin.write(client, $0.baseAddress, payload.count) }, payload.count)
            wait(for: [closed], timeout: 2)
        }
    }

    func testReadsCancellationWhileAnotherReplyIsPending() throws {
        var descriptors: [Int32] = [0, 0]
        XCTAssertEqual(socketpair(AF_UNIX, SOCK_STREAM, 0, &descriptors), 0)
        let client = descriptors[0], peer = descriptors[1]
        defer { Darwin.close(client) }
        var timeout = timeval(tv_sec: 2, tv_usec: 0)
        setsockopt(client, SOL_SOCKET, SO_RCVTIMEO, &timeout, socklen_t(MemoryLayout<timeval>.size))
        let completed = expectation(description: "connection closed")
        let firstReceived = expectation(description: "first request")
        let lock = NSLock()
        var firstReply: ((String) -> Void)?
        let server = ComputerUseSocketServer(socketPath: "/unused", token: "token")
        DispatchQueue.global().async {
            server.serve(peer) { line, reply in
                if line == "first" {
                    lock.lock(); firstReply = reply; lock.unlock()
                    firstReceived.fulfill()
                } else { reply("cancel-accepted") }
            }
            completed.fulfill()
        }
        let data = Array("{\"token\":\"token\"}\nfirst\n".utf8)
        _ = data.withUnsafeBytes { Darwin.write(client, $0.baseAddress, data.count) }
        wait(for: [firstReceived], timeout: 2)
        let cancel = Array("cancel\n".utf8)
        _ = cancel.withUnsafeBytes { Darwin.write(client, $0.baseAddress, cancel.count) }
        var buffer = [UInt8](repeating: 0, count: 1024)
        let count = Darwin.read(client, &buffer, buffer.count)
        XCTAssertGreaterThan(count, 0)
        if count > 0 { XCTAssertEqual(String(decoding: buffer.prefix(count), as: UTF8.self), "cancel-accepted\n") }
        lock.lock(); let reply = firstReply; lock.unlock()
        reply?("first-complete")
        let firstCount = Darwin.read(client, &buffer, buffer.count)
        XCTAssertGreaterThan(firstCount, 0)
        if firstCount > 0 { XCTAssertEqual(String(decoding: buffer.prefix(firstCount), as: UTF8.self), "first-complete\n") }
        shutdown(client, SHUT_RDWR)
        wait(for: [completed], timeout: 2)
    }
}
