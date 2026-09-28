# 来源与实现状态

原始 vendor 只用于测试和说明，不作为候选实现依赖。

| 原始模块 | 候选 | 状态 |
|---|---|---|
| cua-repl/src/instructions.js | src/instructions.ts | macOS 与 browser 环境选择、文档内容对照通过 |
| cua-repl/src/launch.js | src/launch.ts | 参数配置、子进程关闭、信号与监听清理单元测试通过 |
| instructions/*.md、macos/*.md | resources/instructions | 原文资源；Linux/Windows 暂缓 |
| instructions/banner.js | resources/instructions/banner.js | 改为自有命名；通过候选 `@actiondriver/cua/tinysky-alt` 注册全局 CUA，隔离真实 macOS Node REPL 宿主已验收 |
| plugin/.mcp.template.json | plugin/.mcp.template.json | 原资源逐字节保留，候选包打包清单和实际归档均验证包含 |
| plugin/.codex-plugin/plugin.json | plugin/.codex-plugin/plugin.json | 原插件清单逐字节保留，候选包实际归档验证包含；App 内加载行为未验收 |

本包提供可注入 host 的启动函数和 macOS CLI；`@actiondriver/cua` 是显式 workspace 依赖。真实 App Rust/Node REPL 的隔离客户端已完成 candidate banner 初始化、computer-only `getState()`、`js_reset` 后重新初始化，并与原版成功状态对照。browser service 的特权 turn metadata/native pipe 验收仍见 `analysis/codex-cua/real-macos-service-acceptance.md`；复制的原包缺失 `bin/cua-repl.mjs`，但包含插件模板，故 CLI 包装的完整原版逐项对照仍不可得。未修改生产启动路径。
