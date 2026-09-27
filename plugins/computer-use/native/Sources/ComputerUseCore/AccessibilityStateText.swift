import Foundation

enum AccessibilityStateText {
    static func render(_ tree: [String: Any]) -> String {
        func quoted(_ value: String) -> String {
            let data = try? JSONSerialization.data(withJSONObject: [value])
            guard let data, let text = String(data: data, encoding: .utf8) else { return "\"\"" }
            return String(text.dropFirst().dropLast())
        }
        var lines: [String] = []
        func walk(_ node: [String: Any], depth: Int) {
            let role = node["role"] as? String ?? "element"
            let index = node["elementIndex"] as? Int ?? -1
            let title = node["title"] as? String ?? node["description"] as? String ?? ""
            var line = String(repeating: "  ", count: depth) + "[\(index)] \(role) \(quoted(title))"
            if let value = node["value"] as? String { line += " value=\(quoted(value))" }
            if let actions = node["actions"] as? [String], !actions.isEmpty {
                line += " actions=[\(actions.joined(separator: ","))]"
            }
            lines.append(line)
            for child in node["children"] as? [[String: Any]] ?? [] { walk(child, depth: depth + 1) }
        }
        walk(tree, depth: 0)
        return lines.joined(separator: "\n")
    }

    static func diff(previous: String, current: String) -> String {
        let before = previous.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
        let after = current.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
        var remaining = after.reduce(into: [String: Int]()) { $0[$1, default: 0] += 1 }
        var removed: [String] = []
        for line in before {
            if remaining[line, default: 0] > 0 { remaining[line, default: 0] -= 1 }
            else { removed.append("- " + line) }
        }
        remaining = before.reduce(into: [String: Int]()) { $0[$1, default: 0] += 1 }
        var added: [String] = []
        for line in after {
            if remaining[line, default: 0] > 0 { remaining[line, default: 0] -= 1 }
            else { added.append("+ " + line) }
        }
        return removed.isEmpty && added.isEmpty ? "no changes since the previous state"
            : (removed + added).joined(separator: "\n")
    }
}
