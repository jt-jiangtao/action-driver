import AppKit
import Foundation

/// Read-only application resolution and policy. Never launches or activates a target.
struct ApplicationPolicy {
    let organizationPolicyURL: URL
    /// ActionDriver itself, recognized by path: it ships as a renamed Electron.app, so its bundle id
    /// says nothing about it, and the model must never drive the app that shows its approvals.
    var ownerApplications: [URL] = []

    /// The app a packaged helper lives in (`X.app/Contents/Helpers/<helper>.app`), if any.
    static func containingApplication(of helper: URL) -> URL? {
        let components = helper.standardizedFileURL.pathComponents
        guard components.count >= 4,
              components[components.count - 2] == "Helpers",
              components[components.count - 3] == "Contents",
              components[components.count - 4].hasSuffix(".app") else { return nil }
        return URL(fileURLWithPath: NSString.path(withComponents: Array(components.dropLast(3))))
    }

    private var roots: [URL] {
        ["/Applications", "/System/Applications", NSHomeDirectory() + "/Applications"]
            .map { URL(fileURLWithPath: $0).resolvingSymlinksInPath() }
    }

    /// Directories indexed for display names. Kept apart from `roots`, so the path branch keeps
    /// accepting only the three standard application directories (D10) while a registered app such
    /// as Finder, which lives in CoreServices, can still be addressed by its display name.
    private var nameRoots: [URL] {
        roots + ["/System/Library/CoreServices", "/System/Library/CoreServices/Applications"]
            .map { URL(fileURLWithPath: $0).resolvingSymlinksInPath() }
    }

    func resolve(_ identifier: String) throws -> URL {
        if identifier.contains("/") {
            let expanded = (identifier as NSString).expandingTildeInPath
            let url = URL(fileURLWithPath: expanded).resolvingSymlinksInPath()
            guard url.pathExtension == "app", roots.contains(where: { url.path.hasPrefix($0.path + "/") }),
                  Bundle(url: url)?.bundleIdentifier != nil else {
                throw ComputerUseError.invalidRequest("Application path must identify an app in a standard application directory")
            }
            return url
        }
        if let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: identifier) {
            return url.resolvingSymlinksInPath()
        }
        var candidates: Set<URL> = []
        for root in nameRoots {
            guard let enumerator = FileManager.default.enumerator(at: root,
                includingPropertiesForKeys: [.isDirectoryKey], options: [.skipsHiddenFiles]) else { continue }
            for case let url as URL in enumerator where url.pathExtension == "app" {
                enumerator.skipDescendants()
                guard let bundle = Bundle(url: url), let id = bundle.bundleIdentifier,
                      NSWorkspace.shared.urlForApplication(withBundleIdentifier: id) != nil else { continue }
                let names = [bundle.infoDictionary?["CFBundleDisplayName"] as? String,
                             bundle.infoDictionary?["CFBundleName"] as? String,
                             url.deletingPathExtension().lastPathComponent].compactMap { $0 }
                if names.contains(where: { $0.caseInsensitiveCompare(identifier) == .orderedSame }) {
                    candidates.insert(url.resolvingSymlinksInPath())
                }
            }
        }
        guard candidates.count <= 1 else { throw ComputerUseError.ambiguousApp }
        guard let result = candidates.first else { throw ComputerUseError.invalidRequest("Unknown application: \(identifier)") }
        return result
    }

    func evaluate(_ identifier: String) throws -> [String: Any] {
        let url = try resolve(identifier)
        guard let bundle = Bundle(url: url), let id = bundle.bundleIdentifier else {
            throw ComputerUseError.invalidRequest("Application has no bundle identifier")
        }
        let forbidden: Set<String> = ["com.apple.Terminal", "com.googlecode.iterm2", "dev.warp.Warp-Stable",
            "com.mitchellh.ghostty", "com.apple.SecurityAgent", "com.apple.keychainaccess",
            "com.actiondriver.computer-use"]
        let owners = Set(ownerApplications.map { $0.resolvingSymlinksInPath().standardizedFileURL.path })
        let isForbidden = forbidden.contains(id) || id.hasPrefix("com.actiondriver.")
            || id == Bundle.main.bundleIdentifier
            || owners.contains(url.resolvingSymlinksInPath().standardizedFileURL.path)
        let highRisk: Set<String> = ["com.apple.systempreferences", "com.apple.Safari", "com.google.Chrome", "org.mozilla.firefox",
            "com.microsoft.edgemac", "com.apple.mail", "com.apple.MobileSMS", "com.tencent.xinWeChat"]
        let risk = highRisk.contains(id) || isForbidden ? "high" : "low"
        let denied = try deniedApplications()
        let decision = isForbidden ? "forbidden" : denied.contains(id) ? "denied" : "allowed"
        let displayName = bundle.infoDictionary?["CFBundleDisplayName"] as? String
            ?? bundle.infoDictionary?["CFBundleName"] as? String ?? url.deletingPathExtension().lastPathComponent
        var target: [String: Any] = ["bundleId": id, "displayName": displayName, "appPath": url.path, "risk": risk]
        if risk == "high" { target["warningSubtitle"] = "此应用可能涉及敏感信息或对外操作，请谨慎授权。" }
        return ["decision": decision, "allowPersistentApproval": decision == "allowed" && risk == "low", "target": target]
    }

    private func deniedApplications() throws -> Set<String> {
        guard FileManager.default.fileExists(atPath: organizationPolicyURL.path) else { return [] }
        do {
            let data = try Data(contentsOf: organizationPolicyURL)
            guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let ids = object["deniedBundleIds"] as? [String],
                  ids.allSatisfy({ !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }) else {
                throw ComputerUseError.invalidRequest("Invalid organization application policy")
            }
            return Set(ids)
        } catch {
            throw ComputerUseError.invalidRequest("Cannot read organization application policy: \(error)")
        }
    }
}
