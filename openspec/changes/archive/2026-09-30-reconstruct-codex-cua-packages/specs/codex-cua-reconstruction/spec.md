## Purpose

定义 Codex CUA、Sky、CUA REPL 与 browser JavaScript 代码的独立重建和长期维护流程，保证原包基准可追踪、对比结果可复现，并在整体验收完成前保持现有运行时依赖不变。

## ADDED Requirements

### Requirement: 独立源码与固定原包基准
系统 SHALL 将重建实现放在 packages/cua、sky、cua-repl、browser-runtime、browser-desktop，对比框架放在 packages/cua-parity。系统 SHALL 保存原包版本、文件哈希、资源及依赖清单和原文件至重建模块的映射；阅读副本 MUST NOT 作为产品构建输入。新实现包名 SHALL 使用 @action-driver/*，内部目录与标识 MUST NOT 使用 oai_ 前缀；原始来源记录允许保留原路径。

#### Scenario: 原包变化
- **WHEN** 原包文件与固定基准不一致
- **THEN** 差异验证明确拒绝并报告变更，不自动接受新基准

### Requirement: 行为差异验证
验证框架 SHALL 在独立进程中用相同输入和受控依赖执行两个实现，比较返回、错误、事件、底层调用及清理结果。系统 SHALL 明确记录归一化规则，MUST NOT 隐藏未知差异或把 mock 当成真实操作证据。

#### Scenario: 重建版出现错误差异
- **WHEN** 两个实现返回不同错误或执行不同底层调用
- **THEN** 报告保存可复现输入与差异，验收不通过

#### Scenario: 真实操作对比
- **WHEN** 比较 browser 或 computer-use 真实操作
- **THEN** 分别重置夹具后执行，比较操作结果及资源释放，截图只作为其中一项证据

### Requirement: 完整重建后才能替换
系统 MUST 在整体验收前保持现有生产依赖与 loader 不变。验收 SHALL 要求全部本期通用与 macOS 自有 lib、JS 模块及类型有实现和对应记录、公共接口兼容、关键成功与失败路径及跨包验证通过、browser/computer-use 真实场景通过、独立可复现构建成功，且无未解决的阻断差异。第三方依赖 SHALL 核实确切版本并通过 package.json 与锁文件直接引入，MUST NOT 纳入自行重写任务，未复制原生服务不属于 JS 重建交付。

#### Scenario: 部分模块完成
- **WHEN** 仅部分模块通过对比
- **THEN** 新实现只用于独立验证，生产运行仍使用原包

#### Scenario: 整体完成
- **WHEN** 全部验收条件通过并交付报告
- **THEN** 后续整体切换提供原包回退方案与实际运行验证记录

### Requirement: 每个自有库都有用途与契约说明
系统 SHALL 覆盖 oai_js_core、oai_js_types、oai_js_cua、oai_js_cua_repl、oai_js_browser 和 project/cua/sky_js 的通用与 macOS 自有代码及类型。每项 SHALL 记录用途、接口、依赖、状态、错误和副作用的证据及验证；内部实现允许按项目架构重新组织，MUST NOT 仅因当前产品未调用而遗漏能力。重复副本 SHALL 保留全部来源映射，归属未知的代码 MUST NOT 被自动排除。

#### Scenario: 多个原包包含同一工具库
- **WHEN** 清点发现内容相同的自有工具或类型库
- **THEN** 记录每个原始位置与共享实现对应关系，并验证各调用方兼容

#### Scenario: 只有类型声明
- **WHEN** 自有工具只有声明而缺少独立实现或行为依据
- **THEN** 将其纳入清单、补充证据与类型验证，证据缺失时明确记录，不声称已经完成

#### Scenario: 识别第三方库
- **WHEN** 依赖来源和确切版本已核实
- **THEN** 通过 package.json 声明确切版本并由锁文件固定，保留来源及验证记录，不安排自行重写；版本不可获取或存在定制修改时明确报告，不静默升级

### Requirement: 单元测试验证每个自有实现
每个自主实现模块 SHALL 提供单元测试验证正常、边界、错误与可观察副作用，类型工具 SHALL 提供编译期断言；有可运行原逻辑时 SHALL 纳入原包差异对比，MUST NOT 以单元测试通过代替真实操作整体验收。

#### Scenario: 实现一个模块
- **WHEN** 新模块被标记为已实现
- **THEN** 对应单元测试与适用类型断言已经运行并通过，原包差异或证据缺口明确记录

### Requirement: 本期仅支持 macOS
本期重建 SHALL 只实现和验收 macOS 平台，保留全部原始基准与来源记录；Linux/Windows 专属模块 SHALL 标记暂缓而非已实现。macOS 启动入口遇到其他平台 SHALL 明确拒绝，不静默降级。

#### Scenario: 非 Mac 平台启动
- **WHEN** 本期 REPL 在 Linux 或 Windows 平台启动
- **THEN** 返回明确平台不可用错误，不创建子进程

### Requirement: 独立 browser-desktop 包
系统 SHALL 将本机 `@oai/browser-desktop@0.1.1` 的完整原件及版本和逐文件哈希保存在 `thirdparty/backup/browser-desktop/@oai/browser-desktop`，并将其自有 JavaScript、接口和资源还原为独立的 `@action-driver/browser-desktop` 源码包。与已复制内嵌 browser bundle 相同的内容可以复用已验证的自有实现，但差异部分 SHALL 单独映射和测试。第三方依赖按确切版本引入，不自行重写。

#### Scenario: 独立原件与实现
- **WHEN** 检查 browser-desktop 的交付物
- **THEN** 原件、哈希清单、来源映射与独立构建的候选包均存在，候选包不从备份目录导入运行代码

### Requirement: 所有候选包与 Codex 私有服务隔离
全部重建的 `@action-driver/*` 包及其验收测试 MUST NOT 连接、调用或依赖 Codex App 私有服务、私有 native pipe、会话、turn metadata 或认证 broker。需要计算机或浏览器宿主能力时 SHALL 使用 Action-Driver 自有宿主接口及其 macOS 实现，缺少能力时明确失败。原件保留不变，仅可用于静态或不触达私有服务的离线差异对照；历史 Codex 服务实验 MUST NOT 计入最终验收。

#### Scenario: 私有服务不可用
- **WHEN** 独立包执行需要浏览器宿主能力的操作
- **THEN** 只能经 Action-Driver 自有宿主接口执行或明确报告能力不可用，不回退到 Codex 私有服务

#### Scenario: 独立包验收
- **WHEN** 对任一候选包宣称 macOS 真实操作验收通过
- **THEN** 必须提供 Action-Driver 自有宿主、可重置本地操作夹具、行为和资源清理证据；离线原包差异或 mock 结果不得代替

#### Scenario: 认证安全文档来源
- **WHEN** 请求读取 browserAuthSafetyPrecheck
- **THEN** 仅 cloud/orbit 使用其各自原件，codex-app 缺失时拒绝；不得跨环境借用该文档


## 2026-09-28 schema 依赖裁决


Battle 已结束。用户明确允许固定兼容的 Zod v3 版本并以原包差异测试验证，原始确切版本仍标记未知。已检查安装目录、复制包和锁文件，没有原版本证据；比较等待不可获取的原依赖清单与固定兼容版本，推荐后者，用户已裁决。采用 npm 发布的 3.25.76，固定依赖和锁文件，不重写 schema 引擎，不声称候选版本为原版本。成功标准为实际安装版本可复现、参数与响应及错误对照无阻断差异；未覆盖解析边缘行为可能有差异，交付保留该风险。其他依赖要求及整体验收前不切换生产的要求不变。

用户补充：新实现代码不使用 oai_ 前缀，原 vendor 和来源映射中的原路径保持可追踪。

用户裁决：本期只需要 macOS；Linux/Windows 平台实现与真实验收暂缓。通用库与 browser 通用能力仍完整覆盖，原始 vendor 不删减。

This explicit user-approved exception supersedes the exact original-version requirement only for Zod. The implementation MUST pin the dependency and verify original parameter/result/error parity.


## 2026-09-28 declaration-only helper ruling

Battle complete: user explicitly approved autonomous implementation of missing-runtime helpers under documented contracts. Existing declarations do not prove debounce/caching/error/help details. Alternatives were waiting for missing source (unavailable, leaves modules incomplete) and implementing explicit contracts; recommended latter, user chose it. createDelayedAction uses last-call debounce; createLazyEvaluator caches first successful return, retries synchronous throws, caches Promise identity. sleep/enumerate/invariant follow declarations; env follows documented normalization/cache/missing/invalid behavior. These MUST be labeled autonomous implementations without original runtime parity evidence. Semantic risk remains unknown original edge behavior. Default debounce delay is 0ms, latest receiver forwarded, lazy evaluation forwards first receiver; env errors are retryable and successful/default values cached. Error/help text is project-defined, not asserted original.

### Requirement: 生产切换后完全移除 agent-runtime vendor
系统 SHALL 在自有 macOS 宿主真实验收通过后，将生产 Computer Use REPL、CUA、Sky、构建和打包统一切换到 Action-Driver 自有实现，并删除 `apps/agent-runtime/vendor`。切换后的 Computer Use MUST 保持现有授权、取消、截图、重置和资源清理能力。`thirdparty/backup` MAY 作为离线对照输入，但 MUST NOT 被产品运行时、构建产物或生产依赖图读取。最终交付还 SHALL 满足 `integrate-browser-use-desktop` 的内置与外部 Chrome 真实验收。

#### Scenario: 完成联合切换
- **WHEN** Browser Use 与 Computer Use 自有宿主真实验收均通过
- **THEN** 生产运行和打包不读取原件，仓库不存在 `apps/agent-runtime/vendor`，Computer Use 仍可执行并清理会话

#### Scenario: 自有路径尚有阻断差异
- **WHEN** 浏览器或计算机宿主的生产必需操作未通过真实验收
- **THEN** 不删除当前生产原件，也不宣称联合交付完成
