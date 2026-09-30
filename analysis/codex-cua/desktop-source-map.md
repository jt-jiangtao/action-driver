# 独立 browser-desktop 来源与实现边界

本清单只读取 `thirdparty/backup/browser-desktop/@oai/browser-desktop/` 原件，不启动其服务。逐文件哈希、大小与分类在 [`desktop-inventory.json`](desktop-inventory.json)，由 `node analysis/codex-cua/inventory-browser-desktop.mjs` 生成并与只读备份基准核对。106 个文件全有分类：环境资源 101、package 元数据 1、client bundle 1、service bundle 1、WASM 2。

| 原件 | 证据 | 候选归属与限制 |
| --- | --- | --- |
| `scripts/browser-client.mjs` | SHA-256 `d9d0143a…e1324`，151506 字节；与内嵌 browser client 完全相同 | `@action-driver/browser-runtime` 的客户端接口可共享；需要显式 Action-Driver host port，不能使用原版 `globalThis.nodeRepl.rpc('browser', …)`。 |
| `scripts/browser-service.mjs` | SHA-256 `fc0660ba…90086`，1905434 字节；内嵌版为 `65833283…1f855e`，1372505 字节 | 单独的 `@action-driver/browser-desktop` 服务适配。两个 bundle 虽均导出 `handleRpc`，分派 `setup`/`execute`，并接受 `codex-app`、`training`、`cloud`、`orbit` 环境，但哈希/大小不同，不能用内嵌版代替。内部差异需按接口和行为测试逐一确认。 |
| `scripts/browser-accessibility.wasm.br` | SHA-256 `97d2773f…8185ee`，4084148 字节；与内嵌版相同 | 原件/生成资源，只记录哈希；不重写 WASM。需确定可再分发来源和自有 CDP 宿主的加载边界。 |
| `scripts/zxing_reader.wasm` | SHA-256 `0e8d688d…92a392`，1065866 字节；与内嵌版相同 | 第三方 QR 解码资源，既有 `zxing-wasm@3.1.2` 证据见 browser-runtime 来源映射；按固定版本引入，不重写。 |
| `environment-docs/*` | `cloud` 27、`codex-app` 29、`orbit` 28、`training` 17 文件，完整哈希见 JSON | 资源选择属于 desktop 差异模块。文档是原件资料，不直接作为 Action-Driver 运行时指令；`codex-app` 缺 `browserAuthSafetyPrecheck.md`，对应认证分支必须保持拒绝。 |
| `package.json` | 唯一显式运行依赖 `classic-level@3.0.0` | 仅在实际需要的候选模块按固定版本引入；bundle 内其他代码的精确第三方归属仍要逐一核对。 |

原 service 尾部可静态读出 `handleRpc(request)`，它按 `request.method` 调用 `setup(params)` 或 `execute(params)`；`setup` 返回 `apiManifest` 与 `disabledMemberIds`，`execute` 在初始化前报错。它初始化时仍读取特权 Node REPL、私有服务信息以及环境配置，因此这些静态接口证据不构成可直接使用的宿主实现。`browser-client.mjs` 相同只证明 client bundle 可共享，不证明 service 差异可忽略。

初始隔离扫描见 [`service-isolation-initial.json`](service-isolation-initial.json)：四个现有候选 `src` 共发现 25 个需迁移的私有宿主引用，涉及 `nodeRepl`、native pipe 和 turn metadata。扫描器在 `packages/cua-parity/src/service-isolation.ts`，定向测试覆盖私有 RPC、伪装为本地 socket 的 native pipe、动态加载原 bundle、App 路径与安全允许的自有 helper/socket。扫描是迁移证据，不是运行时沙箱；历史 `analysis/codex-cua/real-macos-*.md` 中的 Codex App 验收只保留研究用途，不计入最终自有宿主验收。

尚未证明的项目：desktop service 约 0.53 MB 增量对应的具体职责；`classic-level` 调用面；环境资源如何精确选择；自有 CDP 宿主对标签、上传、截图、认证和关闭的实机行为；两个 WASM 在候选包中的分发与加载。以上都属于后续实现/验收阻断项，不以 106 文件清单代替代码还原。
