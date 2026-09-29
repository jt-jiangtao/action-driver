# Browser 捆绑依赖证据与缺口

## Schema 库

基准来源：`thirdparty/backup/codex-cua/@oai/cua/dist/lib/js/oai_js_browser/dist/skill/scripts/browser-client.js`。

静态证据包含 `ZodFirstPartyTypeKind`、`ZodPipeline`、`ZodReadonly`，字符串 schema 的 `jwt`、`cidr`、`base64url` 等方法。这些可识别 Zod v3 系列实现，但不能唯一确定确切发布版本，也不能排除定制修改。

复制的 browser 目录没有提供该库的 package.json、源映射或锁文件；外层 `@oai/cua` 0.2.5 的 dependencies 为空，不是 schema 库版本证据。当前不声称确切版本已确认，不添加猜测版本或自行实现通用 schema 引擎。

后续需取得与基准产物对应的依赖清单/锁文件，或以候选上游发布物对照全部捆绑实现确认版本与修改情况。仅凭 API 特征或当前项目已安装版本不足以确认。核实后按确切版本声明依赖、锁定解析结果，并补参数/响应解析成功和错误对照。

## 当前影响

已完成的能力集合、元数据、文档路由、注册描述符和 API 可见性视图不依赖通用 schema 引擎。具体能力命令、tabs.content、user.getTabContext、完整 Browser/Tab 和 setup/service 仍未完成；这些基础模块通过测试不构成完整运行时可替换证据。

## 安装来源补查

2026-09-28 检查 `/Applications/ChatGPT.app` 26.924.22138（build 11645）。其 browser-client.js、browser-client.mjs、browser-service.mjs 与已复制基准逐文件 SHA-256 相同，分别为：

- `b1875cb071efd73995652a1edacc778c86c422cbc593565986a3bafb9c3a11ff`
- `d9d0143a6f250151e5fcb87957d21d171178c2aada6019ab72fb7056ac1e1324`
- `658332836ffa0d1730337eacf58c323c7175c7ff26fe062be3f728760e1f855e`

已检查安装内 cua_node 的 pnpm lock.yaml，未找到 Zod 版本记录。当前 app 的 Statsig 已为 3.33.3，与基准路径明确的 3.32.6 不同，不能替换基准依赖证据。匹配 browser 文件仅证明来源一致，仍无法唯一确认 schema 版本。

另补查安装中的独立 `@oai/browser-desktop` 0.1.1：package.json 只声明 classic-level 3.0.0，没有 Zod；其 browser-client.mjs 与基准哈希相同，browser-service.mjs 为 `fc0660ba45e6c10b532d8faa0c1bac704d987dad3d4b74478f49fdd82bf90086`，与基准不同。不能将此包的整体版本或服务行为直接套到复制基准；client 匹配依然不提供捆绑 schema 版本。

## Approved compatible-version exception

2026-09-28: user explicitly approved pinned compatible Zod v3 with original parity tests. Original exact version remains unknown. Candidate zod 3.25.76 is an upstream dependency, not a reconstructed engine. Uncovered edge semantics remain a risk.

## classic-level

Original copied `dist/skill/node_modules/classic-level/package.json` explicitly identifies 3.0.0. Candidate directly pins `classic-level: 3.0.0` and pnpm locks all transitive resolutions. The upstream library is used for read-only profile discovery through a temporary copy; it is not rewritten. Tests open a real database and compare original profile functions with only the dynamic third-party import rebound to the installed same-version library. Isolated offline artifact install/frozen reinstall and database roundtrip pass. Native prebuilds are supplied by the upstream package.
