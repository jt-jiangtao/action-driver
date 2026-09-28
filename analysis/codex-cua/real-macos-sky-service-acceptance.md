# macOS Sky 候选服务隔离验收（2026-09-28）

候选 `@actiondriver/sky` 的 `dist/service.js` 已在真实 ChatGPT App 随附的 `cua_node` Rust supervisor / Node REPL 特权宿主中隔离加载，并完成 `sky` 的 `setup` 与 `list_apps` 原包对照。此记录只证明只读发现路径；需应用授权的 AX、截图和操作仍未在候选服务端验收。

测试先构建 `packages/sky`，将 `dist/`、`package.json` 临时复制到 `~/.codex/sky-service-acceptance-<随机>/`，将 `node_modules` 符号链接到同一工作树锁定的 Sky 依赖。分别启动两个独立的 `cua-repl` MCP 子进程：一个保留插件 `.mcp.json` 中的原版 `NODE_REPL_TRUSTED_SERVICES.sky`；另一个仅在该子进程环境中将 `sky` 映射到临时候选 `dist/service.js`。两个进程均完成 MCP `initialize`，Node REPL 首次调用按 CUA 要求执行 `cua.getState()`，随后通过 `nodeRepl.rpc('sky', ...)` 调用服务。每次测试结束都停止子进程并删除临时目录；插件配置与生产映射未修改。

| 实际请求 | 原版服务 | 候选服务 |
|---|---:|---:|
| `setup` target | `mac` | `mac` |
| `setup` 方法数 | 11 | 11 |
| `execute` → `list_apps` 数量 | 27 | 27 |
| 所有 ID 为字符串 | 是 | 是 |
| 所有 `isRunning` 为布尔值 | 是 | 是 |
| 不存在的方法调用 | 拒绝 | 同一错误拒绝 |

追加两次独立进程对照：11 个方法的排序列表完全一致；对应用发现结果中有序的 `[id, isRunning]` 数组计算 SHA-256，两版摘要一致。这里只记录相等性，不记录应用名称或摘要值。

两次发现请求均无 MCP 工具错误，使用了实际 macOS 原生服务；记录中不保存个人应用清单。`get_app_state` 等命令需要特权宿主的用户授权和绑定会话。先前候选 **客户端**经原版服务完成活动监视器 AX/截图、计算器动作和清理的证据见 [real-macos-computer-acceptance.md](real-macos-computer-acceptance.md)；不能把两类局部证据相加称作候选服务完整端到端通过。

追加 `--read-app-state com.apple.ActivityMonitor` 的只读探测：原版和候选都在原生 AX 调用前立即拒绝，分类均为 `missing-elicitation`，脚本按未验收返回非零。自建 MCP 客户端没有 App 为正式工具请求提供的 `nodeRepl.createElicitation`；本次未显示审批、未获取或记录窗口内容，也未绕过审批。可用原命令继续单独复核发现路径；可选参数明确暴露授权边界。

可复现脚本 [`verify-macos-sky-service.py`](verify-macos-sky-service.py) 接受当前插件 `.mcp.json` 路径；先构建 `packages/sky` 再运行即可。它在内存中比较方法列表、有序应用状态摘要和不存在的方法错误，只输出数量与相等性，不打印应用名称、ID 或摘要，并在异常时清理两次隔离进程和暂存目录。2026-09-28 复跑结果：11 个方法、27 个应用，类型、错误及相等性检查均通过。
