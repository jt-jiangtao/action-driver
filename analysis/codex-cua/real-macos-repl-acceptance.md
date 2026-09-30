# 候选 CUA REPL：macOS 隔离宿主验收

2026-09-28，在当前 App 自带的 `cua_node/bin/node` 与 `node_repl` Rust supervisor 上，使用两个独立 MCP stdio 子进程分别运行原版 launcher 与候选 `packages/cua-repl/bin/cua-repl.mjs`。生产插件配置和服务映射均未修改。两次均只启用 `computer` surface；候选子进程把 `NODE_REPL_JS_BANNER` 指向 `@action-driver/cua/tinysky-alt`，把真实文件副本组成的临时 `node_modules` 加入 `NODE_REPL_NODE_MODULE_DIRS`。临时根位于现有 `NODE_REPL_TRUSTED_CODE_PATHS` 内，结束后删除，进程组停止。

| 步骤 | 原版 | 候选 |
|---|---|---|
| MCP `initialize` | 成功 | 成功 |
| 首次 `js`: `await cua.getState()` | `isError: false` | `isError: false` |
| `js_reset` | `isError: false` | `isError: false` |
| 再次 `js`: 读取 `cua` 与应用数量 | `isError: false` | `isError: false` |

只记录工具成功状态与内容块数量；不保存本机应用列表。此测试的 Sky 服务仍由原版受信服务提供，因此验证的是候选 REPL 启动、候选 CUA 全局注册、surface 环境、重置与重新导入，不证明候选 Sky/browser 服务整体等价。原复制包缺失 `bin/cua-repl.mjs`，但含 `plugin/.mcp.template.json` 和 `plugin/.codex-plugin/plugin.json`；候选现按字节复制两份资源并验证打包。CLI 包装的完整原版逐项对照仍不可得。

可复现脚本是 [`verify-macos-repl-host.py`](verify-macos-repl-host.py)：先构建 CUA、Sky、CUA-REPL，再以 `--plugin-config` 指向当前安装的 CUA REPL 插件 `.mcp.json`。脚本只输出上述四步的布尔结果，并在异常时清理隔离进程和临时目录。

首次隔离运行发现候选 CUA runtime 在 Node REPL 沙箱中读取不存在的 `process` 全局；已改为显式注入平台测试 seam 与 macOS 默认，CLI 宿主仍拒绝非 macOS。符号链接暂存的候选包被 REPL 的 realpath 包根检查排除；验收使用实际复制的构建产物。候选 `cua-repl` 现在声明 `@action-driver/cua` 依赖；其打包产物连同本地打包的传递依赖完成离线安装和冻结锁文件重装。生产入口与 vendor/back 均保持原样。

补充非敏感宿主探针：原版与候选版均报告 `process` 为 `undefined`，`Buffer` 为 `function`。因此 CUA runtime 不得读取 `process.platform`，但原包/候选的文档字节计数和截图 base64 处理可继续使用 `Buffer`；脚本会在状态读取后打印这两个类型，不打印应用信息。
