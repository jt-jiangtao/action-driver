import Foundation

enum ApplicationInstructions {
    private static let entries: [String: String] = {
        guard let url = Bundle.module.url(forResource: "app-instructions", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let entries = try? JSONDecoder().decode([String: String].self, from: data) else { return [:] }
        return entries
    }()
    static func forApp(_ bundleIdentifier: String) -> String? { entries[bundleIdentifier] }
}
