## Why

现有 Codex CUA 与 browser 依赖仅包含编译或打包代码，不利于自主修改和长期维护。需要重建可维护实现，并以原包为基准验证行为一致。

## What Changes

- 新建 packages/cua、sky、cua-repl、browser-runtime、browser-desktop 五个源码包，以及 packages/cua-parity 差异验证包，使用 @action-driver 命名。
- 原始 vendor 保持基准职责，analysis/codex-cua 保存阅读副本。
- 固定基准、逐一分析全部自有 lib 的接口、用途和行为，依照项目架构重实现 TS，并建立原包和新实现的独立进程差异验证。
- 完整覆盖 oai_js_core、oai_js_types、oai_js_cua、oai_js_cua_repl、oai_js_browser 与 project/cua/sky_js；第三方库（包括 tslib、Statsig 及 browser 随附依赖）核实来源、锁定版本后复用，不重写。重复副本均记录来源映射。
- 前期生产运行路径继续使用原包，完成整体验收后才允许统一切换；最终切换另行记录实际验收与回退步骤。
- Battle：用户已确认长期维护、前期不替换、验收后整体替换及 packages 目录方案。已比较逐模块替换和 thirdparty 布局，选择独立 workspace 包；接受没有 source map 无法证明所有未知行为一致及集中集成成本。后续用户明确要求每个自有 lib 全覆盖，并确认第三方库不用重写；采用接口与用途分析后自主实现，保留全部自有能力，不能只覆盖顶层入口。检查目录、接口、依赖、运行边界，无其他实质性异议。

## Capabilities

### New Capabilities

- codex-cua-reconstruction：规定源码重建、基准追踪、差异验证和整体替换门槛。

### Modified Capabilities

无。保持既有 Computer Use、Browser Use 和沙箱契约；不增加产品能力。

## Impact

新增 workspace 实现与验证包、分析资料和相关脚本。原包继续位于 apps/agent-runtime/vendor/codex-cua。不把源码阅读副本当成可独立维护实现，不重写已有第三方依赖，不把未复制的原生服务计入 JS 重建范围。

第三方引入方式：按已核实的确切版本写入各包 package.json，由 pnpm-lock.yaml 固定解析结果，不复制原包 node_modules 作为新实现的依赖树，不使用 ^、~ 或 latest。无法获取确切版本或原包包含定制修改时明确报告，不能静默替换版本。Zod 适用下述用户明确批准的例外。

## 2026-09-28 schema 依赖裁决

Battle 已结束。用户明确允许固定兼容的 Zod v3 版本并以原包差异测试验证，原始确切版本仍标记未知。已检查安装目录、复制包和锁文件，没有原版本证据；比较等待不可获取的原依赖清单与固定兼容版本，推荐后者，用户已裁决。采用 npm 发布的 3.25.76，固定依赖和锁文件，不重写 schema 引擎，不声称候选版本为原版本。成功标准为实际安装版本可复现、参数与响应及错误对照无阻断差异；未覆盖解析边缘行为可能有差异，交付保留该风险。其他依赖要求及整体验收前不切换生产的要求不变。

用户补充：新实现代码不使用 oai_ 前缀，原 vendor 和来源映射中的原路径保持可追踪。

用户裁决：本期只需要 macOS；Linux/Windows 平台实现与真实验收暂缓。通用库与 browser 通用能力仍完整覆盖，原始 vendor 不删减。


## 2026-09-28 declaration-only helper ruling

Battle complete: user explicitly approved autonomous implementation of missing-runtime helpers under documented contracts. Existing declarations do not prove debounce/caching/error/help details. Alternatives were waiting for missing source (unavailable, leaves modules incomplete) and implementing explicit contracts; recommended latter, user chose it. createDelayedAction uses last-call debounce; createLazyEvaluator caches first successful return, retries synchronous throws, caches Promise identity. sleep/enumerate/invariant follow declarations; env follows documented normalization/cache/missing/invalid behavior. These MUST be labeled autonomous implementations without original runtime parity evidence. Semantic risk remains unknown original edge behavior. Default debounce delay is 0ms, latest receiver forwarded, lazy evaluation forwards first receiver; env errors are retryable and successful/default values cached. Error/help text is project-defined, not asserted original.

## 2026-09-28 browser-desktop 扩围裁决

Battle 已结束：用户明确要求纳入独立的 desktop 包，并禁止连接 Codex 的服务。目标是把当前 App 中实际加载的 `@oai/browser-desktop@0.1.1` 也纳入可维护、可验证的 macOS 自主实现，而不是将其误认为已复制的 `@oai/cua` 内嵌 browser service。两个 service bundle 哈希不同，客户端文件相同；前者有 106 个文件和独立环境文档。比较了并入既有 `browser-runtime` 与独立 `@action-driver/browser-desktop` 两种可执行方案；后者便于保留两套服务契约、单独验收和回退，用户选择纳入 desktop，并追加不接 Codex 私有服务的边界。

原件从本机安装包复制到 `thirdparty/backup/browser-desktop/@oai/browser-desktop`，保存版本、逐文件哈希和来源；它只作只读基准。新实现放 `packages/browser-desktop`，复用经验证的通用自有代码和确切版本第三方依赖，不重写第三方库。用户进一步明确：**所有重建后的 `@action-driver/*` 包及其验收测试都不能连接 Codex App 私有服务**，包括通过 Node REPL、私有 native pipe、会话/turn metadata 或认证 broker 的间接连接；Action-Driver 自有 helper、socket 和浏览器宿主允许使用。原包仅可作离线静态基准及不会触达私有服务的受控差异对照，不把 App 签名二进制作为候选依赖或验收捷径。原件保持不变；验收前既有生产 loader 也保持不变，但它不能作为新实现独立性的证据。

可用的离线原包行为、受控替身与 Action-Driver 自有宿主上的重置 macOS 夹具分别标注证据等级。既有候选经 Codex 服务得到的实机记录保留为历史研究，不计入最终验收。需要真实宿主能力的路径须迁移到 Action-Driver 自有接口；缺少该真实路径时，相关包的整体验收与统一生产替换保持未完成。

认证安全说明只按原包环境来源纳入 cloud/orbit；codex-app 环境未发现同名文档，仍须缺失即拒绝，不得把其他环境说明静默注入。风险：独立服务的部分行为依赖不可访问的 Codex 私有宿主，无法靠 mock 证明真实等价；用户的服务隔离要求优先，保留这些路径为未验收，不降低替换门槛。

## 2026-09-28 提前合并裁决

用户在看到“当前候选仍有待移除的 Codex 私有宿主接线、尚未达到全包隔离与真实验收”的风险后，明确选择**现在先把未完成候选代码合并到本地 main**，再继续实现，最后另行替换生产依赖。与“全部完成后才合并”相比，提前合并便于在主线保留进度，但主线会暂时包含不可用于生产的候选模块；这是用户覆盖原合并节奏的已知风险。保持原件和当前生产 loader 不变，未完成包继续标注未验收，不能把合并视为整体验收或生产替换许可。提交前按仓库治理运行一次全量检查，合并只更新本地 main，不推送远端。

## 2026-09-28 vendor 移除与 Browser Use 联合交付裁决

用户要求完全移除 `apps/agent-runtime/vendor`，明确要求 Computer Use 持续可用，并要求与 `integrate-browser-use-desktop` 的右侧内置浏览器及 Agent 启动的外部 Chrome 一起完成。`thirdparty/backup` 的原件备份不在删除范围，仅供离线对照，不能进入生产加载或打包。当前生产 REPL、Sky 服务、构建复制脚本仍读取 vendor；直接删除会破坏功能和构建。比较了立即删除并暂时停用 Computer Use、将原件挪至备份后继续加载，以及先完成自有宿主验收再整体切换并删除；用户选择第三项。联合交付以两项 OpenSpec 变更的真实验收共同通过为准，不把浏览器基础路径成功或目录删除单独视作完成。

## Archive Decision (2026-09-30)

- Battle 状态：已裁决。用户明确确认当前没有任务要执行，并要求一次性归档全部活动 OpenSpec 变更。
- 本变更处置：终止未完成任务后归档；归档时任务勾选为 181/236，未勾选项仍代表未完成，不视为已交付。
- Delta spec：1 份原样保存在归档中；本次不向主规范同步。
- 重新启动条件：若再次需要这项能力，应依据当前代码和主规范重新提出或更新变更，不把归档任务自动恢复为待执行承诺。
