import XCTest
@testable import ComputerUseCore

final class SensitiveSettingsPaneTests: XCTestCase {
    /// System Settings shows the current pane as its window title. Privacy grants, passwords and
    /// accounts are off limits (D9): the model must not grant itself permissions or touch credentials.
    func testPrivacyPasswordAndAccountPanesAreForbiddenInBothLanguages() {
        for title in ["Privacy & Security", "隐私与安全性", "Accessibility", "辅助功能",
                      "Screen & System Audio Recording", "屏幕与系统录音", "Input Monitoring", "输入监控",
                      "Full Disk Access", "完全磁盘访问权限", "Automation", "自动化",
                      "Touch ID & Password", "触控 ID 与密码", "Users & Groups", "用户与群组",
                      "Passwords", "密码", "  privacy & security  "] {
            XCTAssertTrue(SensitiveSettingsPane.isForbidden(windowTitle: title), title)
        }
    }

    /// Titles observed on a real machine (macOS 27): the privacy pane is "隐私与安全", and spacing
    /// around Latin words varies between releases.
    func testMatchesTitlesAsTheyAppearOnMacOS27AndIgnoresSpacing() {
        for title in ["隐私与安全", "触控ID与密码", "Touch ID&Password"] {
            XCTAssertTrue(SensitiveSettingsPane.isForbidden(windowTitle: title), title)
        }
    }

    func testOrdinarySettingsPanesStayAvailable() {
        for title in ["Wi‑Fi", "显示器", "Displays", "Sound", "声音", "General", "通用", ""] {
            XCTAssertFalse(SensitiveSettingsPane.isForbidden(windowTitle: title), title)
        }
        XCTAssertFalse(SensitiveSettingsPane.isForbidden(windowTitle: nil))
    }
}
