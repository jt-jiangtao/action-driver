# macOS 浏览器客户端实机对照（2026-09-28）

本记录验证候选 `@action-driver/browser-runtime` **客户端**调用现有原版 `browser` 特权服务的可观察结果。候选服务端未在此运行；不能据此认定服务端或四包整体完成。

## 固定夹具与运行边界

- 页面：`packages/cua-parity/fixtures/browser-acceptance.html`，由本地 Node HTTP 服务在 `127.0.0.1` 随机端口提供；包含 Name 输入、Apply 按钮和结果文本。
- 浏览器：当前 macOS Codex in-app browser，两个临时标签分别由候选客户端和原版 CUA 客户端创建；同一原版特权服务处理 RPC。
- 候选客户端：从 `packages/browser-runtime/dist/index.js` 使用 Vite 6.4.3 临时单文件打包，仅为绕过普通 CUA REPL 对 `zod/v3` 外部模块的解析限制；源包仍使用固定依赖，不把该临时文件作为生产交付物。
- 原版：`cua` API；页面交互使用原版 `setValue`、`click`、`getAXState`、`getScreenshot`。

## 观察结果

| 对照项 | 候选客户端 | 原版 | 结论 |
|---|---|---|---|
| 浏览器发现 | 2 个，类型为 extension、iab | ID/name/type 列表一致 | 通过 |
| 默认浏览器文档与标签列表 | 文档 48056 字符，初始标签数 0 | 初始标签数 0 | 通过当前夹具 |
| 打开本地页面 | 标题 `Action-Driver browser acceptance`，页面有输入/按钮/Waiting | 相同页面和控件 | 通过 |
| 输入 `Ada` 后点击 Apply | AX 文本 `Hello, Ada` | AX 文本 `Hello, Ada` | 通过 |
| 结果页截图 | 14139 字节 | 14139 字节 | 逐字节相同 |
| 清理 | 两个临时标签均关闭 | IAB 剩余标签数 0 | 通过 |

命令执行时使用 `packages/cua-parity/fixtures/browser-acceptance.html`；端口是随机值，本次为 `54752`。原版/候选截图在这一次同环境、同页面状态下字节相同，不推断不同机器/字体/浏览器版本仍逐字节相同。

## 尚需验证

候选 `./service` 的真实 native pipe、AX/WASM、认证、WebMCP、通知/响应元数据及异常清理尚未在特权服务位置运行。普通 CUA REPL 的 `nodeRepl` 没有服务端 `config`/`nativePipe` 权限；直接导入候选服务无法完成原生后端验收。生产 loader 仍指向原 vendor，整体切换门槛保持不变。
