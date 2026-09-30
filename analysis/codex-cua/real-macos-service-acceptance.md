# macOS 候选浏览器服务隔离加载记录（2026-09-28）

本次仅验证临时 NodeREPL 的特权服务加载路径。**候选服务已真实加载并完成 `setup`，但浏览器发现因缺少 Codex App 提供的 turn metadata 而被拒绝；nativePipe、页面交互和截图均未验收。**生产插件映射与原 vendor 未修改。

后续增加与**复制版**原服务的同宿主对照：[`verify-macos-browser-service-boundary.py`](verify-macos-browser-service-boundary.py) 分别将浏览器服务映射到 App 内字节等同复制版的 `@oai/cua` bundle，以及临时候选入口。两者 `setup` 返回的完整 API manifest 和禁用成员数组相等，`list_browsers` 均因缺少真实 `session_id`/`turn_id` 拒绝，普通 `cua.getState()` 也都显示相同的缺失元数据边界。脚本仅输出布尔比较与错误类别，不输出浏览器状态；进程和暂存目录均清理。它没有绕过门禁，也没有证明 nativePipe 或页面操作通过。当前插件正式映射的 `@oai/browser-desktop/service` 是另一 bundle，不能充当复制版原服务的哈希基准。

## 宿主与固定证据

- 当前插件配置：`/Users/jiangtao/.codex/plugins/cache/openai-bundled/unified-computer-use/26.924.22138/.mcp.json`。其 `NODE_REPL_TRUSTED_SERVICES` 将 browser 映射到 `@oai/browser-desktop/service`，Sky 映射到 `@oai/sky/service`；`NODE_REPL_TRUSTED_CODE_PATHS` 包含 `/Users/jiangtao/.codex` 与 App 的 `cua_node/lib/node_modules`。本次只在子进程环境中将 browser 映射改为临时候选入口。
- 原版 `browser-service.mjs` 的 `GN()` 通过 `globalThis.nodeRepl?.config` 判断特权宿主，`nativePipe.createConnection` 也从同一个 `nodeRepl` 取得。候选 `packages/browser-runtime/src/service.ts` 经 `initializeBrowserHost()` 要求相同的 `config`，`service-discovery.ts` 在发现浏览器前要求真实请求元数据中的 `session_id`、`turn_id`。
- `/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node_repl` 是独立 MCP stdio/Rust supervisor。可执行文件内的受信服务 loader 接受 `file:` 或绝对路径服务入口，并对每个文件依赖的 realpath 检查 `NODE_REPL_TRUSTED_CODE_PATHS`。因此临时服务入口、候选依赖与 App 签名依赖都位于已配置的可信根内。
- `pnpm --filter @action-driver/browser-runtime build` 通过。候选 `dist/service.js` SHA-256：`6c8fa6367c35d902d1c23415d6fa4684242ce038cb8b123eb3aa79cd80fdc8ff`。暂存的 `package.json` SHA-256：`0b4e9a5a659ac09637be0256f933328fde97ae5a80e7325cdbab440b7f5fcffb`。

## 隔离启动与结果

先把候选 `dist/`、`resources/`、`package.json` 复制到 `/Users/jiangtao/.codex/browser-service-acceptance-<随机>/`。暂存包的 `node_modules` 以符号链接指向固定依赖：Zod 3.25.76、playwright-core 1.59.0、Statsig js-client 3.33.1、Sentry 10.48.0 均指向本工作树的锁定安装；只有 `classic-level` 指向 App 随附的 3.0.0。该包的 `index.js` 与本地 3.0.0 的 SHA-256 同为 `6958a1d105be7eca861e18d244a42b3a6e7fc28c3cf9dbe6dd24720c529a171c`。App 随附的 `classic-level.node` SHA-256 为 `2a824d7d0f27edca92c7a463c53c53a5dd543e83cc6baab9170c16ad477cd3ef`，签名 Team ID 为 `2DC432GLL2`，与 App 随附 Node 一致。

隔离 MCP 客户端以插件 `.mcp.json` 的 `command`、`args` 和环境启动 `cua-repl`，**仅在这个子进程**设置：

```text
NODE_REPL_TRUSTED_SERVICES={"browser":"/Users/jiangtao/.codex/browser-service-acceptance-<随机>/dist/service.js","sky":"@oai/sky/service"}
```

MCP `initialize` 与 `tools/list` 成功，列出 `js`、`js_add_node_module_dir`、`js_reset`、`turn_ended`。随后调用 `js` 执行 `nodeRepl.write({candidateReady: typeof cua !== "undefined"})`，返回 `{ candidateReady: true }` 且 `isError: false`。这证实临时进程通过真实 Rust supervisor 加载了候选服务入口并完成客户端初始化；没有改变当前 Codex App 使用的插件实例。

直接从工作树加载候选曾被 macOS 签名阻止：本地 pnpm 的 `classic-level.node` 为 ad-hoc/no Team ID，App 随附 Node 为 `2DC432GLL2`，`dlopen` 报不同 Team ID。改用上述 App 随附的**同版本已签名**包后，隔离加载成功。未禁用签名检查或修改生产二进制。

下一步只读调用 `cua.getState()` 时，browser 部分返回 `Missing required Codex turn metadata: session_id, turn_id`。自建 MCP 客户端没有 Codex App 向正式工具请求注入的 turn metadata；服务按原契约拒绝发现。没有伪造元数据、绕过门禁或尝试 nativePipe 连接。虽然 `getState()` 的其他部分返回了结果，本记录不保存个人应用清单。未创建测试标签、没有页面交互或截图，因此也没有页面需要清理。两次独立 MCP 测试的进程组均已停止，临时暂存目录已删除。

## 后续验收边界

要完成真实 nativePipe/list_browsers、可重置本地页面交互和截图，需由 Codex App 将**临时受信服务实例**作为真正工具请求发起方，自动附带其可信 `session_id`、`turn_id`；现有工具没有把自建 MCP 子进程接入当前 App 会话并继承该元数据的入口。不能把无元数据的独立 MCP 客户端或普通 CUA REPL 的结果写成服务端实机通过。候选 `@action-driver/cua-repl` bin 的 computer-only 真实宿主启动与重置对照已另行完成，见 [real-macos-repl-acceptance.md](real-macos-repl-acceptance.md)。
