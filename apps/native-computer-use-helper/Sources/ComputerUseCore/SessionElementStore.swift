import Foundation

/// Accessed only by the helper's serial request queue. Indexes belong to a session and app.
final class SessionElementStore<Element> {
    private struct Key: Hashable { let session: String; let app: String }
    private struct State {
        var pid: Int32
        var nextIndex = 0
        var elements: [Int: Element] = [:]
        var needsRead = false
    }
    private var states: [Key: State] = [:]
    private let equal: (Element, Element) -> Bool

    init(equal: @escaping (Element, Element) -> Bool) { self.equal = equal }

    func record(session: String, app: String, pid: Int32, elements: [Element]) throws -> [Int] {
        let key = Key(session: session, app: app)
        var state = states[key] ?? State(pid: pid)
        let previous = state.pid == pid ? state.elements : [:]
        var current: [Int: Element] = [:]
        var indexes: [Int] = []
        for element in elements {
            let index: Int
            if let match = previous.first(where: { equal($0.value, element) }) {
                index = match.key
            } else if let match = current.first(where: { equal($0.value, element) }) {
                index = match.key
            } else {
                guard state.nextIndex <= 1_000_000 else {
                    throw ComputerUseError.invalidRequest("Session element index capacity exceeded")
                }
                index = state.nextIndex
                state.nextIndex += 1
            }
            current[index] = element
            indexes.append(index)
        }
        state.pid = pid
        state.elements = current
        state.needsRead = false
        states[key] = state
        return indexes
    }

    func resolve(session: String, app: String, pid: Int32, index: Int) throws -> Element {
        guard let state = states[Key(session: session, app: app)],
              state.pid == pid, !state.needsRead, let element = state.elements[index] else {
            throw ComputerUseError.staleReference
        }
        return element
    }

    func invalidate(session: String, app: String) {
        states[Key(session: session, app: app)]?.needsRead = true
    }

    func removeSession(_ session: String) {
        states = states.filter { $0.key.session != session }
    }
}
