import Foundation

/// System Settings panes Computer Use must never read or drive (D9): privacy grants, passwords and
/// accounts. System Settings titles its window with the current pane, in English or Chinese; titles
/// change between releases (macOS 27 shows "隐私与安全"), so matching ignores case and all spacing.
enum SensitiveSettingsPane {
    static let bundleIdentifier = "com.apple.systempreferences"

    private static let titles: Set<String> = Set([
        "privacy & security", "隐私与安全性", "隐私与安全",
        "accessibility", "辅助功能",
        "screen & system audio recording", "屏幕与系统录音", "screen recording", "屏幕录制",
        "input monitoring", "输入监控",
        "full disk access", "完全磁盘访问权限",
        "automation", "自动化",
        "files & folders", "files and folders", "文件与文件夹",
        "developer tools", "开发者工具",
        "touch id & password", "触控 id 与密码", "login password", "登录密码",
        "users & groups", "用户与群组",
        "passwords", "密码"
    ].map(normalized))

    static func isForbidden(windowTitle: String?) -> Bool {
        guard let title = windowTitle.map(normalized), !title.isEmpty else { return false }
        return titles.contains(title)
    }

    private static func normalized(_ title: String) -> String {
        String(title.lowercased().unicodeScalars.filter { !CharacterSet.whitespacesAndNewlines.contains($0) })
    }
}
