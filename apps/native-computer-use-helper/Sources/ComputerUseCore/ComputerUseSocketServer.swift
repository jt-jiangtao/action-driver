import Darwin
import Foundation

/// Private Unix domain socket server used instead of stdio, so the helper is launched by
/// LaunchServices and therefore owns its own TCC identity.
public final class ComputerUseSocketServer {
    public typealias LineHandler = (String) -> String

    private let socketPath: String
    private let token: String

    public init(socketPath: String, token: String) {
        self.socketPath = socketPath
        self.token = token
    }

    /// Serves connections forever; call from a dedicated thread.
    public func run(_ handle: @escaping LineHandler) {
        let listener = listenOnSocket()
        guard listener >= 0 else {
            // A helper without a socket is useless, and staying alive would pile up processes on
            // every launch attempt.
            FileHandle.standardError.write(Data("COMPUTER_USE_SOCKET_UNAVAILABLE\n".utf8))
            exit(3)
        }
        while true {
            let client = accept(listener, nil, nil)
            if client < 0 { continue }
            serve(client, handle)
            close(client)
        }
    }

    private func listenOnSocket() -> Int32 {
        unlink(socketPath)
        let listener = socket(AF_UNIX, SOCK_STREAM, 0)
        guard listener >= 0 else { return -1 }
        var address = sockaddr_un()
        address.sun_family = sa_family_t(AF_UNIX)
        let pathBytes = Array(socketPath.utf8)
        guard pathBytes.count < MemoryLayout.size(ofValue: address.sun_path) else {
            close(listener)
            return -1
        }
        withUnsafeMutableBytes(of: &address.sun_path) { buffer in
            for (index, byte) in pathBytes.enumerated() { buffer[index] = byte }
            buffer[pathBytes.count] = 0
        }
        let size = socklen_t(MemoryLayout<sockaddr_un>.size)
        let bound = withUnsafePointer(to: &address) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { bind(listener, $0, size) }
        }
        guard bound == 0 else {
            close(listener)
            return -1
        }
        chmod(socketPath, 0o600)
        guard listen(listener, 4) == 0 else {
            close(listener)
            return -1
        }
        return listener
    }

    private func serve(_ client: Int32, _ handle: LineHandler) {
        var buffer = Data()
        var authenticated = false
        var chunk = [UInt8](repeating: 0, count: 65_536)
        while true {
            let received = read(client, &chunk, chunk.count)
            if received <= 0 { return }
            buffer.append(contentsOf: chunk[0..<received])
            while let newline = buffer.firstIndex(of: 0x0A) {
                let lineData = buffer.subdata(in: buffer.startIndex..<newline)
                buffer.removeSubrange(buffer.startIndex...newline)
                guard let line = String(data: lineData, encoding: .utf8) else { continue }
                if !authenticated {
                    authenticated = handshake(line)
                    if !authenticated { return }
                    continue
                }
                let reply = handle(line)
                if !reply.isEmpty { write(reply + "\n", to: client) }
            }
        }
    }

    private func handshake(_ line: String) -> Bool {
        guard let data = line.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let value = object["token"] as? String else { return false }
        return value == token
    }

    private func write(_ text: String, to client: Int32) {
        let bytes = Array(text.utf8)
        var written = 0
        while written < bytes.count {
            let count = bytes.withUnsafeBytes { pointer -> Int in
                guard let base = pointer.baseAddress else { return -1 }
                return Darwin.write(client, base.advanced(by: written), bytes.count - written)
            }
            if count <= 0 { return }
            written += count
        }
    }
}
