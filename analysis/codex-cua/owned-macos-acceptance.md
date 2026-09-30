# Action-Driver 自有 macOS 宿主验收（进行中）

本记录只计入不连接 Codex 私有服务的自有宿主结果。历史 `real-macos-*.md` 中的 Codex App/Rust Node REPL 调用不计入此验收。

## 2026-09-28：自有 Chrome/CDP 基础路径

执行 `corepack pnpm --filter @action-driver/browser-runtime build`，再运行 `node analysis/codex-cua/verify-owned-macos-browser.mjs`。脚本仅启动 `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`、临时独立 profile 和 127.0.0.1 离线 HTTP 页面。验证 list/create/navigate/get tab、CDP `Runtime.evaluate`、真实点击、文本输入、Enter 键、鼠标移动、双击、拖拽、PNG 截图和关闭后 profile 清理。证据在 `owned-macos-browser-evidence.json`，截图在 `owned-macos-browser-fixture.png`；主仓库 `main` 最新执行时标题 `Action-Driver fixture`、初始 CDP 文本 `Ready`、点击输入与提交后文本 `Owned input`，页面记录 Enter 和双击事件，截图 10468 字节，SHA-256 `cb91861925bc9b5e90e49165de9b7e17550c0f99c34a67739807edd545baa4fa`，profile 剩余条目为空。截图字节可随 Chrome 渲染细节变化；功能断言以页面状态和清理结果为准，哈希记录该次实际输出。

此结果只验证基础浏览器宿主命令。BrowserBackend 的其余命令、上传/下载、AX/WASM、认证安全、取消/断连恢复、desktop service 差异、Sky/CUA/REPL 自有宿主路径均未完成，不据此切换生产。
