# browser-desktop 候选来源与状态

独立原件保留在 `thirdparty/backup/browser-desktop/@oai/browser-desktop@0.1.1`，106 个文件的逐项归属与哈希见 `analysis/codex-cua/desktop-inventory.json` 和 `analysis/codex-cua/desktop-source-map.md`。候选包不在运行时导入备份或 vendor。原 client bundle 与内嵌 browser client 字节相同，故 `setupBrowserDesktop` 复用 `@actiondriver/browser-runtime` 的显式 host 客户端接口；原 desktop service bundle 的哈希和大小不同，不能复用内嵌服务来声称相同。

`createBrowserDesktopService` 是独立的候选生命周期边界：显式 host，setup 前拒绝命令，关闭后拒绝命令且一次性关闭宿主。`codex-app` 原资源缺少 `browserAuthSafetyPrecheck.md`，setup 保持拒绝。cloud/orbit 的该资源已复制到候选包，测试按 SHA-256 对照只读原件。四套 101 个原资源完整复制在 `resources/environment-docs`，仅用于来源保全和受控资源读取；不能把文档中可能提及的 Codex 专有行为当作已实现能力。

目前 desktop 专有服务层只完成包壳、共享 client、资源哈希与独立生命周期。desktop service 相对内嵌 service 的新增命令、profile/会话管理、认证安全、错误、清理和第三方 `classic-level@3.0.0` 调用面仍需逐模块确认并实现。自有 Chrome 宿主也只实现了部分命令；因此本包仍属未完成候选，不能切换生产依赖。

`codex-app` 环境的普通浏览器初始化和标签操作现可通过显式 ActionDriver 宿主执行；缺少 `browserAuthSafetyPrecheck.md` 仅在认证交接命令请求该资源时拒绝，客户端与服务入口均在下发该命令前检查。定向测试覆盖普通发现和认证拒绝。本机独立 Chrome/profile 与离线页面验证了候选客户端创建标签、导航、截图、点击、输入、按钮提交及关闭后 profile 清理；这只证明上述基础 UI 行为，不证明整个 desktop service bundle 已还原。
