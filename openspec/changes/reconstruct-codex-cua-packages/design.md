## Context

见 proposal.md。现有三个 @oai 包包含编译 JS 和类型声明，browser 为嵌套 bundle；核心自有代码缺少原始 TS 与 source map。pnpm workspace 已覆盖 packages/*。原始资料位于 apps/agent-runtime/vendor/codex-cua。

## Goals / Non-Goals

**Goals:** 获得独立构建、可修改、可验证的五套实现；覆盖固定基准内通用自有 lib、JS 模块、类型与接口以及 macOS 平台能力，保留来源对应和已知差异；所有候选包与 Codex 私有服务隔离。

**Non-Goals:** 精确恢复原作者文本；重写第三方依赖；重建未复制原生二进制；提前接入产品；增加 Browser Use 产品功能。非本机平台的真实运行结果不得由 mock 冒充。

## Decisions

1. **源码归属**：packages/cua、sky、cua-repl、browser-runtime、browser-desktop；使用 @actiondriver/*。每包 src、tests、docs/source-mapping.md。相比 thridparty，该布局匹配现有 workspace，适合自主维护；用户已确认。
2. **验证归属**：packages/cua-parity 管理独立进程 runner、固定夹具、差异规则和报告。analysis/codex-cua 仅放阅读副本，不作为编译输入。原始 vendor 不重写。
3. **基准版本**：清点全部文件、导出、动态导入、资源及第三方模块；保存版本、哈希和来源。原包同步发生变化时验证明确拒绝，重新采纳基准需独立记录，不能自动接受。
4. **实现方法**：先分析每个自有 lib 的用途、接口、状态变化、错误、副作用与依赖，分别标注声明、源码和运行实验依据，以及尚未确认的推断，再按项目架构编写可维护 TS。不要求逐语句翻译或保留原内部模块划分，但所有自有能力与类型必须有对应实现和验证，不能遗漏未被当前产品使用的能力。重复捆绑模块识别后记录全部来源，未经验证不合并。第三方代码核实来源并复用确切版本，不重写；无法确定归属的代码保留 unknown，不擅自当成第三方排除。

   自有库清单包括 oai_js_core、oai_js_types、oai_js_cua、oai_js_cua_repl、oai_js_browser 及 project/cua/sky_js 下的 core、types、targets。oai_js 目前可见内容为 tslib 编译辅助库；dist/node_modules 包含 Statsig；browser 内依赖逐项核验。cua 与 sky 的 core/types/tslib 已检查内容一致，仍须固定基准后完整映射。只有类型声明的工具纳入分析与类型测试；行为证据不足时记录阻塞，不凭名字猜测后声称完成。共享库最终物理位置和依赖接线由清点结果确定；新增 workspace 包须先记录目录与依赖方案，不能把本次第三方范围确认当成额外目录授权。
5. **对比方法**：同一输入在独立进程中执行，受控时间、随机数和协议响应，比较返回、错误、事件、调用顺序、资源清理。归一化字段采用明确允许清单，保留原始差异证据，禁止吞掉未知差异。真实操作分别在重置的页面、应用和会话夹具运行，避免重复副作用。截图比较固定环境并记录容差，不能只靠截图宣称一致。
6. **替换节奏**：逐模块替换反馈更快，但用户选择完成后整体替换。前期仅差异 runner 引用新实现，禁止改 agent-runtime 默认依赖、生产 loader 与打包接线。所有自有模块实现、公共接口兼容、关键成功/失败路径、跨包调用、browser/computer-use 真实场景及可复现构建通过后，交付报告，再推进整体切换与回退。
7. **边界**：沿用既有原生 helper、信任与沙箱边界。原包在宿主中已有适配时，原包和新实现采用相同适配条件，分别报告原包独立行为和当前宿主行为，不能把适配差异当成重建偏差。

## Risks / Trade-offs

- [无 source map，无法证明所有未知路径等价] → 模块清单、静态审查与动态对比共同验收，明确覆盖缺口。
- [browser 大 bundle 和跨包重复逻辑] → 先识别归属与依赖，逐模块验证，未知边界升级 Battle。
- [原包需私有服务或平台依赖] → 区分 mock 协议验证与真实运行；不可用真实路径记录阻塞，禁止静默缩减验收范围。
- [macOS 特权 Node 对原生依赖的 Team ID 检查] → 隔离加载实验证实工作区 ad-hoc 签名的 classic-level 3.0.0 被 App Node 拒绝，同版本 App 签名包可加载；最终独立产物必须在目标宿主签名/打包流程中验证，不将测试用 App 包路径作为生产依赖。
- [隔离 MCP 客户端缺 Codex App 注入的 turn metadata] → 候选服务虽曾在真实 Rust supervisor 中加载，但浏览器发现按契约拒绝；用户现禁止所有候选接 Codex 私有服务，后续验收必须改用 ActionDriver 自有宿主。历史实验不计最终验收，不能伪造元数据。
- [集中替换产生集成风险] → 提前执行跨包与真实夹具测试，保留原包及切换回退记录。
- [格式化及分析资料膨胀] → 生成脚本和来源清单可复现，生成资料不进入产品构建。
- [原始资料含专有声明] → 保存来源标识；重建与行为对齐本身不改变原始资料声明，不将它推断为独立原创证明。

## Migration Plan

规划审查后编写实施计划；清点与基准固定；独立 workspace 与对比框架；逐模块还原；整体验收报告。验收前不替换。验收后统一调整接线，在原包基准可用前提下保留可逆回退，并按主仓库提交规则完成一次提交前全量验证。

## Third-party Dependencies

用户确认第三方库直接按版本引入：在使用方 package.json 声明确切版本，由 pnpm-lock.yaml 固定传递依赖；不重写或沿用 vendor/node_modules 作为新实现依赖树。清点核实实际版本、模块格式与是否存在定制补丁，只有可获取且匹配的版本才引入。缺失版本或定制修改属于需处理的差异，不自动升级或猜测替代。第三方模块集成仍参与行为对比。

## Naming

用户要求新实现不要 oai_ 前缀：package 名使用 @actiondriver/*，内部目录、模块与标识按职责命名（core、types、browser、computer 等），不复制 oai_js_* 的目录名；原始 vendor 与来源映射可保留原路径作为追踪证据。

## Unit Tests

用户要求单元测试保证每个自有库预期效果：每个自主实现模块必须包含正常、边界、错误与可观察副作用用例；可运行原逻辑时进行差异对比，类型工具提供编译期断言。单元测试不替代跨包与真实操作验收。

## Platform Scope

用户明确调整为本期仅 macOS。原包快照保持完整；清单将 Linux/Windows 专属模块标记 deferred-platform，不计本期实现验收，不能误标已实现。macOS REPL 对其他平台明确报不可用；通用代码已有的兼容分支不新增其他平台开发或验收任务。browser 中若混合平台实现，只移植通用与 Mac 路径并记录来源边界。最终替换验收限定 macOS，不宣称 Linux/Windows 可用。


## 2026-09-28 schema 依赖裁决


Battle 已结束。用户明确允许固定兼容的 Zod v3 版本并以原包差异测试验证，原始确切版本仍标记未知。已检查安装目录、复制包和锁文件，没有原版本证据；比较等待不可获取的原依赖清单与固定兼容版本，推荐后者，用户已裁决。采用 npm 发布的 3.25.76，固定依赖和锁文件，不重写 schema 引擎，不声称候选版本为原版本。成功标准为实际安装版本可复现、参数与响应及错误对照无阻断差异；未覆盖解析边缘行为可能有差异，交付保留该风险。其他依赖要求及整体验收前不切换生产的要求不变。

用户补充：新实现代码不使用 oai_ 前缀，原 vendor 和来源映射中的原路径保持可追踪。

用户裁决：本期只需要 macOS；Linux/Windows 平台实现与真实验收暂缓。通用库与 browser 通用能力仍完整覆盖，原始 vendor 不删减。

This explicit user-approved exception supersedes the exact original-version requirement only for Zod. The implementation MUST pin the dependency and verify original parameter/result/error parity.

Markdown renderer follows the original exact-version rule without an exception. Original browser bundle linkify code uses the 14.1.1 tail-star character scan; 14.1.0 uses a regular expression, and differential rendering excludes 14.2.0 and later. Pin markdown-it 14.1.1, preserve the original `breaks/html/linkify/typographer` settings, and compare HTML, clipboard payload and editable-page effect. The earlier compatible-version question became unnecessary after this source-level identification.


## 2026-09-28 declaration-only helper ruling

Battle complete: user explicitly approved autonomous implementation of missing-runtime helpers under documented contracts. Existing declarations do not prove debounce/caching/error/help details. Alternatives were waiting for missing source (unavailable, leaves modules incomplete) and implementing explicit contracts; recommended latter, user chose it. createDelayedAction uses last-call debounce; createLazyEvaluator caches first successful return, retries synchronous throws, caches Promise identity. sleep/enumerate/invariant follow declarations; env follows documented normalization/cache/missing/invalid behavior. These MUST be labeled autonomous implementations without original runtime parity evidence. Semantic risk remains unknown original edge behavior. Default debounce delay is 0ms, latest receiver forwarded, lazy evaluation forwards first receiver; env errors are retryable and successful/default values cached. Error/help text is project-defined, not asserted original.

## 2026-09-28 browser-desktop Decision

**Decision:** Add a distinct `packages/browser-desktop` workspace package for the installed `@oai/browser-desktop@0.1.1` client, service-facing contract and resources. Keep its immutable source snapshot under `packages/back/browser-desktop/@oai/browser-desktop`; never import that snapshot from product code. The existing `browser-runtime` continues to represent the copied `@oai/cua` nested browser baseline. Shared behavior may be delegated to verified `@actiondriver/browser-runtime` APIs, but differing service behavior must retain separate mapping, tests and explicit adapters.

**Boundary:** All reconstructed `@actiondriver/*` packages and their acceptance tests do not connect to or depend on Codex App private services, its native pipes, session IDs, turn metadata or auth broker. ActionDriver-owned helpers, sockets and browser hosts remain valid. Define owned host interfaces and use local stubs for unit/differential tests. Existing computer-use native Swift helper is a candidate owned backend; browser capabilities need an owned host. Real macOS acceptance for every affected package must run through ActionDriver-owned hosts on resettable fixtures; an isolated run of an original bundle, historical Codex-host run or mock does not count. Keep the production loader unchanged until all original and expanded acceptance gates pass.

**Alternatives:** Merging both bundles into `browser-runtime` saves a package but obscures divergent service contracts and makes provenance and rollback harder. Using the installed Codex service would give convenient real-device coverage but violates the user's isolation requirement. Waiting for a proprietary host API would leave the newly requested package unimplemented. The separate package plus owned host interface is selected.

**Risks / trade-offs:** The installed service bundle is 1,905,434 bytes without original TS/source map; some private-host paths may remain unverifiable offline. `classic-level@3.0.0` remains a third-party dependency, but local App Node Team ID checks cannot be satisfied by ad-hoc signing, and this machine has no matching signing identity. Do not treat an App-signed test binary as standalone package acceptance. Cloud/orbit include byte-identical `browserAuthSafetyPrecheck.md`; codex-app does not, so the codex-app auth precheck remains fail-closed. Unverified private-host paths block production replacement rather than being waived.

**Expanded ruling:** The user clarified that the Codex-service ban applies to *all* reconstructed packages, not only browser-desktop. An interface-only implementation with mock tests is executable but cannot meet the prior complete-then-switch goal; recommended path is to adapt all candidates to ActionDriver-owned macOS computer/browser hosts. Existing `sky`/`browser-runtime`/`cua-repl` Node REPL and private-pipe seams require an audit and migration. The original snapshots remain immutable even where they contain private-service calls. Historical Codex-backed experiments remain labeled research, never final acceptance. Risk: building the owned browser host substantially expands effort; no production cutover until it exists and real macOS scenarios pass.

**Merge sequencing override:** The user explicitly chose an immediate work-in-progress merge to local `main` after being told the candidate still contains private-host seams and lacks owned-host acceptance. The alternative was finishing isolation and acceptance on this branch before merge; it reduces mainline risk but delays visibility. Respect the chosen sequence: commit the current candidate with incomplete status and full pre-commit checks, fast-forward local `main`, then continue implementation. Do not switch production dependencies or treat the merge as acceptance. Do not push remote without a separate request. This override changes integration timing only; the final no-Codex-service and acceptance gates remain binding.
