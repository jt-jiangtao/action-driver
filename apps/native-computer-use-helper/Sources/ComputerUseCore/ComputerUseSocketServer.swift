import Darwin
import Foundation

/// Private Unix domain socket server used instead of stdio, so the helper is launched by
/// LaunchServices and therefore owns its own TCC identity.
public final class ComputerUseSocketServer {
    public typealias LineHandler = (String, @escaping (String) -> Void) -> Void

    private let socketPath: String
    private let loadToken: () -> String?
    private var ownershipLock: Int32 = -1

    deinit {
        if ownershipLock >= 0 { close(ownershipLock) }
    }

    public init(socketPath: String, token: String) {
        self.socketPath = socketPath
        self.loadToken = { token.isEmpty ? nil : token }
    }

    /// Read the private token at each connection, so replacing it does not strand a live helper.
    public init(socketPath: String, tokenFileURL: URL) {
        self.socketPath = socketPath
        self.loadToken = {
            guard let text = try? String(contentsOf: tokenFileURL, encoding: .utf8) else { return nil }
            let token = text.trimmingCharacters(in: .whitespacesAndNewlines)
            return token.isEmpty ? nil : token
        }
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
            Thread.detachNewThread { self.serve(client, handle) }
        }
    }

    func listenOnSocket() -> Int32 {
        // Hold the lock for this server's lifetime. Probing then unlinking alone races another
        // instance that binds the same stale path between those two operations.
        if ownershipLock < 0 {
            let lock = open(socketPath + ".lock", O_CREAT | O_RDWR | O_NOFOLLOW, 0o600)
            guard lock >= 0 else { return -1 }
            guard flock(lock, LOCK_EX | LOCK_NB) == 0 else {
                close(lock)
                return -1
            }
            ownershipLock = lock
        }
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
        var existing = stat()
        if lstat(socketPath, &existing) == 0 {
            guard existing.st_mode & mode_t(S_IFMT) == mode_t(S_IFSOCK) else {
                close(listener)
                return -1
            }
            let probe = socket(AF_UNIX, SOCK_STREAM, 0)
            guard probe >= 0 else { close(listener); return -1 }
            _ = fcntl(probe, F_SETFL, O_NONBLOCK)
            let connected = withUnsafePointer(to: &address) {
                $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { connect(probe, $0, size) }
            }
            let connectionError = errno
            close(probe)
            guard connected < 0 && (connectionError == ECONNREFUSED || connectionError == ENOENT) else {
                close(listener)
                return -1
            }
            guard unlink(socketPath) == 0 || errno == ENOENT else {
                close(listener)
                return -1
            }
        } else if errno != ENOENT {
            close(listener)
            return -1
        }
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

    func serve(_ client: Int32, _ handle: LineHandler) {
        let connection = SocketReplies(client)
        defer { connection.closeConnection() }
        var timeout = timeval(tv_sec: 60, tv_usec: 0)
        setsockopt(client, SOL_SOCKET, SO_RCVTIMEO, &timeout, socklen_t(MemoryLayout<timeval>.size))
        setsockopt(client, SOL_SOCKET, SO_SNDTIMEO, &timeout, socklen_t(MemoryLayout<timeval>.size))
        var noSignal: Int32 = 1
        setsockopt(client, SOL_SOCKET, SO_NOSIGPIPE, &noSignal, socklen_t(MemoryLayout<Int32>.size))
        var buffer = Data()
        var authenticated = false
        var nextReply = 0
        var chunk = [UInt8](repeating: 0, count: 65_536)
        while true {
            let received = read(client, &chunk, chunk.count)
            if received <= 0 { return }
            buffer.append(contentsOf: chunk[0..<received])
            while let newline = buffer.firstIndex(of: 0x0A) {
                let lineData = buffer.subdata(in: buffer.startIndex..<newline)
                buffer.removeSubrange(buffer.startIndex...newline)
                guard lineData.count <= (authenticated ? 128 * 1024 : 4096),
                      let line = String(data: lineData, encoding: .utf8) else { return }
                if !authenticated {
                    authenticated = handshake(line)
                    if !authenticated { return }
                    continue
                }
                let replyID = nextReply
                nextReply += 1
                guard connection.begin(replyID) else { return }
                handle(line) { reply in connection.respond(replyID, text: reply) }
            }
            if buffer.count > (authenticated ? 128 * 1024 : 4096) { return }
        }
    }

    func handshake(_ line: String) -> Bool {
        guard let data = line.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let value = object["token"] as? String,
              let expected = loadToken() else { return false }
        return value == expected
    }

}

/// Replies may finish out of order; protect the FD from interleaved writes and reuse after close.
private final class SocketReplies {
    private let descriptor: Int32
    private let lock = NSLock()
    private var closed = false
    private var pending: Set<Int> = []

    init(_ descriptor: Int32) { self.descriptor = descriptor }

    func begin(_ id: Int) -> Bool {
        lock.lock(); defer { lock.unlock() }
        guard !closed, pending.count < 128 else { return false }
        pending.insert(id)
        return true
    }

    func closeConnection() {
        lock.lock(); defer { lock.unlock() }
        guard !closed else { return }
        closed = true
        pending.removeAll()
        Darwin.close(descriptor)
    }

    func respond(_ id: Int, text: String) {
        lock.lock(); defer { lock.unlock() }
        guard !closed, pending.remove(id) != nil, !text.isEmpty else { return }
        let bytes = Array((text + "\n").utf8)
        var written = 0
        while written < bytes.count {
            let count = bytes.withUnsafeBytes { pointer -> Int in
                guard let base = pointer.baseAddress else { return -1 }
                return Darwin.write(descriptor, base.advanced(by: written), bytes.count - written)
            }
            if count <= 0 { return }
            written += count
        }
    }
}
