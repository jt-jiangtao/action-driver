# 来源与实现状态

原始 vendor 只用于测试和说明，不作为候选实现依赖。

本文件按实施批次保留当时的“待完成”记录；后文的具体映射和最新状态优先。当前候选客户端/服务入口及 75 个命令注册均已接线，富文本输入已恢复；自动认证安全审查和候选服务的特权浏览器实机验收仍未完成，生产仍使用原包。

原包同时提供 `browser-client.js` 和实际入口 `browser-client.mjs`，两者字节不同。候选默认客户端装配分别与两种入口对照：9 项 runtime 初始化测试及 2 项完整装配用例均通过，覆盖默认/自定义选项、错误、RPC 捕获、显示输出和 capability/Tab 组合。此结果只证明客户端公开路径，不代替 `browser-service.mjs` 的特权服务验收。

原服务内嵌的 Browser 文档与键盘映射分别提取为 `resources/browser-documentation.json`、`resources/browser-keyboard.json`。`node analysis/codex-cua/verify-browser-resource-provenance.mjs` 只读核验两份固定来源/输出哈希，改动任一侧会明确拒绝；原包行为对照仍由对应资源与键盘单元测试负责。

| browser-client.js 内部职责 | 候选源码 | 验证 |
|---|---|---|
| FunctionAgentTransport | src/transport.ts | 命令/超时、side_effects 顺序、空响应、失败传播与原包对照 |
| display formatting / display side-effect bridge | src/display.ts | 原始值、包装值、JSON、循环对象、字节图片、截断和输出失败与原包对照 |
| isPlainObject、isRegExp、hasErrorMessage、generateRequestId | src/utilities.ts | 跨 realm、原型、访问异常和受控时间/随机数与原包对照 |

测试通过在原包副本追加 export 暴露其内部 namespace 与格式化函数；不改变函数体，候选构建不读取 vendor。手写传输层只处理本模块 side-effect envelope，不复制或重写第三方 Zod。

上述是最初识别的基础职责；随后各节记录 Browser/Tab/Playwright、命令/schema、API manifest、setup/service、后端与资源的实现。混合 bundle 内部仍有需要复核的来源边界，真实浏览器服务验收仍未完成。

## 第六批：定位与页面接口

- `src/locator.ts`：原 bundle runtime 的 PlaywrightLocator (`ml`) 定位组合、直接/批量读取与缓存、evaluate；PlaywrightFrameLocator (`Sl`) 全部定位；PlaywrightDownload (`Tl`) 路径。保留协议 command type、显式 undefined 超时字段、读取 projection 与 filter 缓存规则。Locator 动作与动作后的缓存清理/诊断仍未完成。
- `src/evaluation.ts`：原 `cl`/`dl`/`ll` 的 page/element/all 脚本与 JSON 参数序列化，函数源码只作为用户提交的协议数据；错误消息上下文与不可序列化参数保持原行为。
- `src/playwright.ts`：原 PlaywrightAPI (`Il`) 全部页面方法和 PlaywrightFileChooser (`jl`)；事件 Promise 自带 rejection handler 支持先启动等待再触发动作，真实 backend 仍未接入。
- 单元对照直接加载固定原 bundle，只附加测试 export；不导入 vendor 代码进入生产实现，不重写捆绑第三方 schema。Browser/Tab 其他 API、原生命令 schema、manifest、capabilities 与 setup/service 未完成。

## 第七批：定位器动作与错误诊断

- `src/locator.ts` 与 `src/locator-actions.ts`：原 `ml` 的全部动作、selection 规范化、读取缓存 `pl.clear()`、诊断 `nl`/`ol`。对照协议参数、默认值、返回投影、失败前/后缓存及错误上下文。
- 诊断函数由自主实现生成；函数源码格式不要求与 minified vendor 字节相同。唯一的测试归一化是诊断 `playwright_evaluate.script` 的源码文本；两版脚本都在 AsyncFunction 中对相同 DOM 夹具执行，比较实际诊断字段、DOM 访问顺序、截断、动作类别和错误消息。其他命令参数、超时和返回行为未归一化。
- 平台限制及延期模块见 `docs/codex-cua-platform-gaps.md`；Linux/Windows 不实现、不验收，vendor 保持原始基准。Browser/Tab/capabilities/schema/manifest/setup/service 仍未完整重建，不能据此切换生产依赖。

## 第八批：Tab 子接口与核心控制

- `src/tab-apis.ts`：原 Cl/El/Al/Ml/Ol/Zl 的 DomCUAAPI、CUAAPI、AXAPI、ContentAPI、TabClipboardAPI 和 TabDevAPI。对照观察模式、state/screenshot 错误和缺图、全部动作字段、剪贴板 wire 映射、日志 warning/参数规范化；不把坐标 `typeof number` 检查改为 finite 限制，服务 schema 验证仍独立待实现。
- `src/tab-controls.ts`：原 mh 的导航、状态读取、截图裁剪、交接、JS dialog 核心行为。此内部基类供完整 Tab 后续装配使用，不作为已完成 Tab 导出；playwright、AX 等组合与 capability 注册仍由 13.6 跟踪。
- `src/dialogs.ts`：原 ch/dh/lh/uh/hh，保持公开属性和 dismiss/confirm/prompt 行为，alert/beforeunload 不添加原包没有的 accept。
- 新构造函数只读取声明的 scope 字段；额外 enumerable getter 的原包回归测试用于验证不执行无关 accessor。修复同时覆盖此前 Locator/FrameLocator/Download/PlaywrightAPI/FileChooser 构造函数。
- `packages/back/` 原样备份 vendor 全部包、三方代码及平台资源；原 vendor 不删除、不切换生产入口。完整备份清单独立于候选实现源码。

## 第九批：Browser 选择与集合核心

- `src/browser-agent.ts`：原 Jd/Gd/Hd 的 Browsers/Documentation/Agent，保留 observer 在 factory 前调用、延后 onBrowserUsed 捕获 info 身份、错误与返回行为。此 Agent 仍依赖调用方提供 browser factory，不能视为默认 runtime setup 完成。
- `src/browser-controls.ts`：原 sm 的 history/documentation/nameSession 核心内部基类。history 使用构造时 id；documentation/nameSession 使用公开 browserId；保留可观察的差异。
- `src/tab-collections.ts`：原 Yd 的 new/selected/list/get 与 el 的 openTabs/claimTab 内部基类。content/getTabContext 依赖原 schema 解析仍未完成，不对外作为完整 Tabs/BrowserUser 类导出。
- `src/protocol.ts`：只装配协议 JSON，不实现第三方 schema 引擎或公开 Commands/AtlasCommand 的 parse 行为；命令 schema/API 完整重建仍有独立任务。
- bundle 中可确认存在第三方 schema 实现，但 vendor 元数据未提供确切版本。用户已裁决固定兼容的 `zod@3.25.76` 并以原包对照验证，不能将候选版本写成原包确切版本。候选 capability、Browser/Tab、schema 和服务装配已在后续批次实现；特权服务实机验收仍待完成。

第九批审查及验证补充：BrowserInfo.name/type 与原 bundle 必填字段对齐，类型分别为 string 和 iab|extension|cdp；浏览器和标签工厂的 async 返回按 Awaited<T> 展开。12 项选择/文档/集合对照及 22 项全包编译赋值断言通过。基础类保持内部导入，不当作完整 Browser/Tab 对外导出。schema 库精确版本、capabilities、tabs.content、user.getTabContext、setup/service 尚未完成。

## 第十批：能力基础与 API 视图（部分 14.6/10.5）

- `src/capabilities.ts` 对应原 `Ll`、`ql`、`Ul`、`Bl`、`Fl`：公开 metadata/transport/documentation 引用、id getter、文档路径、集合查找与列表、注册工厂。保留记录引用与继承查找、null internalOnly 省略、工厂 options spread 和 info 覆盖等可观察行为。
- `src/api-view.ts` 对应 `mm` 构造内视图算法和 createBrowser 内支持规则：隐藏禁用成员、方法稳定绑定、返回值代理、Promise/数组递归、参数内已有代理解包、描述符/has/ownKeys、Tab 装饰及支持覆盖。将运行时类型表作为内部装配输入；不新增完整 API factory 导出。
- 15 项受控原包对照通过；测试仅追加内部符号 export，候选源码不引入 vendor。基础 metadata 类与注册方法可独立导出；API view 仅内部使用。具体能力和完整 Browser/Tab 装配继续未完成。
- schema 证据与缺口见 `dependency-evidence.md`；Zod 系列特征不当作确切版本证据。

## 第十一批：可信宿主初始化与服务生命周期（setup/service 的基础部分）

- `src/runtime-initialization.ts` 对应 client `pm`：可信 nodeRepl/RPC 检查、三个 setup 字段投影与 environment 默认值、捕获 unbound RPC、显示桥、100000 字符截断和工厂边界。只提供内部 initializeBrowserRuntime；不导出尚未完成的 setupBrowserRuntime/default factory。
- `src/service-lifecycle.ts` 对应 service `fse`/`JXe`：自身方法分派、四种 environment 值校验、prepareHost/createRuntime Promise 生命周期、setup 结果集合序列化、初始化前拒绝、后续 execute 与并发 setup 的实例捕获规则。
- 初始化 9 项测试中 8 项为原 client 受控对照、1 项验证内部装配参数传递；服务 6 项为原 service RPC 状态函数受控对照。原 service 测试仅在追加测试 hook 中替换 SU/SN 宿主与运行时装配边界并重置状态，不改 fse/JXe 函数体；不验证被替换的后端实现。
- 截图用受控 RPC 响应串联 Agent→TabsControls→AXAPI→FunctionAgentTransport→显示桥，对照原完整客户端路径的命令和 Uint8Array 输出。测试中的最小 Browser/Tab 装配仅是夹具，不属于完成的生产工厂。
- cloud/orbit/training 是原服务协议允许的环境标签；保留校验规则不代表本期新增这些部署环境或 Linux/Windows 平台支持。schema、完整 Browser/Tab 装配、实际浏览器后端、原生服务、真实整体验收仍未完成。

## 第十五批：API 工厂装配

`src/api-factory.ts` 对应原 mm 的 createBrowser/wrapAgent/createAgent：组合 API 视图、每浏览器支持覆盖、Agent 与 FunctionAgentTransport，保留公开 manifest/disabled 集合引用与回调。8 项原包对照覆盖成员隐藏、后续引用修改、命令/显示顺序、方法绑定、未知 runtime interface、Tab 装饰与服务错误身份。另串联候选可信初始化→工厂→Agent→BrowserControls，与原 setupBrowserRuntime 对比 RPC 和 history 返回。

此工厂为内部模块，完整 Browser/Tab registry 和构造由调用方注入；部分对照注入原 Browser 类型仅用于隔离原 mm 的工厂逻辑，端到端核心测试使用候选 BrowserControls。未宣称 capabilities、tabs.content/user.getTabContext、完整 Browser/Tab、schema、默认 setup 导出或真实浏览器后端完成。生产实现不导入原包。

## 第十六批：Browser/Tab 子接口组合

`src/composition.ts` 对应原 sm/mh 构造中的子接口和集合装配。ComposedTab 组合 Playwright、DomCUA、CUA、AX、Content、Clipboard、Dev 与 Capabilities；ComposedBrowser 组合 capabilities、tabs 和 user。Tab 动作读取当前 id，子接口捕获初始 id；Browser 集合捕获初始 browserId，后续建 Tab 读取捕获配置对象当前 tab 能力列表。公开 ownKeys 顺序保持原包。

能力 factory Map 必须明确注入；原具体 capability/schema 仍未完成，不使用空默认注册表把已知能力当作已支持。测试只追加原 oh/im registry export，部分对照注入原 factories 验证组合算法，不进入候选构建。9 项原包对照和 1 项候选注册边界测试覆盖未知能力、重复条目、注册工厂固定说明、初始 scope、缺 id/transport、动态配置以及候选工厂→Browser→Tab→Locator 的完整受控调用。schema 依赖的 tabs.content/user.getTabContext 与具体能力命令继续保持未完成；内部组合类不作为完整 Browser/Tab 公开导出。

## 第十八批：WebMCP 快照与 browserAuth 请求转换

- `src/webmcp-snapshot.ts`：原 ah（公开 toWebMcpToolDescriptor）与 ih.fetchTools 解析之后的快照阶段。保留工具别名、说明格式、重复 alias 的最后记录、冻结返回对象、trim 查找、registration metadata、input/timeout wire 投影及结果/异常传播。内部 createWebMcpSnapshot 要求已通过 schema 的记录；不暴露未验证的 fetchTools 能力。工具 metadata 在构造时捕获，调用时读取 context 当前 browserId/tabId/transport，支持原能力对象 public slots 的后续改变。
- `src/browser-auth-request.ts`：原 Pu.request 的参数投影与 Au selector 校验。字段、autocomplete、options/field_ids、QR literal 与 submit；仅接受同 browser/tab 的真实 PlaywrightLocator 或字符串。输出仍须交给后续 command schema 验证；不声明完整 BrowserAuthTabCapability.request 已实现。
- 15 项原包对照：8 项 WebMCP、7 项 auth（部分测试多组输入）。WebMCP 原能力在测试中使用原 ResultSchema 校验有效工具，候选内部快照仅使用有效记录；不以此验证 schema 或恶意工具列表处理。Auth 比较原实际 request 发送数据与 selector 错误，完整 ID/数量/选项关系验证仍由 schema 任务跟踪。候选未加载原捆绑 schema、未重写第三方实现。

## 第十九批：CDP send 与 transport accessor 顺序

`src/cdp-capability.ts` 对应原 pu.send/fu：scope 与 public transport 动态读取、method/params/target wire 投影、明确传输 timeout 字段、返回 unknown 的透传。8 项原包对照覆盖任意结果、引用、target/timeout 边界、metadata/documentation、constructor 额外 getter、target 单次读取与 transport.send accessor 顺序。ResultSchema 为 h.unknown()，该结果透传无需实现第三方解析引擎。命令对象仅提供现阶段 transport 使用的 toJSON 契约；完整 AtlasCommand/schema 与 readEvents 的结构化结果仍未完成，内部 CdpTabCapability 未公开注册或导出。

新增 WebMCP accessor 对照复现其 send getter 必须在 scope 读取前执行，修正快照发送构造并保留回归。通用 dispatch 的其余调用点需要审计 transport/getter 可观察顺序，已进入未完成任务，不对其他路径宣称这种输入已验收。

## Structured commands and concrete default client

AtlasCommand maps to src/command.ts. Public command/schema inventory is analysis/codex-cua/browser-command-contracts.json with original SHA-256; analysis scripts materialize declarative schemas in src/commands/index.ts, using upstream zod/v3 and manually implemented selection/clipboard refinements. Candidate runtime neither imports analysis nor vendor. CDP/content/context/auth/assets/WebMCP and browser management/visibility/viewport schemas live in grouped command modules. Concrete classes map to tab-capabilities.ts/browser-capabilities.ts/cdp-capability.ts, registrations to capability-registry.ts. composition.ts now supplies default registrations; default-runtime.ts uses all candidate classes for setupBrowserRuntime. Default client initialization remains trusted host RPC. The candidate service/backend is wired, but its privileged nativePipe/page behavior and production switch remain unaccepted.

Native service foundations have own `service-context`, `service-rpc`, `service-native-pipe`, `service-backend-api` and discovery modules. Tests append exports to baseline service to expose internal functions; context tests replace only discovery assembly, discovery tests replace only native connection creation. The later sections of this mapping record profile enrichment, feature gates, diagnostics, command handlers and the exported service entry. They remain subject to the rich-text/auth-safety decisions and actual privileged browser acceptance.

### Assets and macOS input (2026-09-28)

- uM/lM and asset helpers -> service-asset-discovery.ts; Pf -> service-page-assets.ts. Inventory/page identity, filesystem bundles and approvals covered by6 comparison tests; default diagnostics and service assembly pending.
- Sf -> service-mouse-input.ts +service-cua-input.ts; Lg/ul/al -> service-input-guard.ts; Mi/SC/CC -> service-keyboard-input.ts. Keyboard data is extracted as data, with source SHA256 and reproducible extraction in analysis/codex-cua/browser-keyboard-provenance.json. Only macOS keyboard platform paths implemented; Linux/Windows command maps omitted and dispatch rejects.
- OR/MR/NR/FR/LR/_s/UR/jR/qR/r0 -> service-dom-state.ts. Own snapshot state, isolated execution retry, serialized clipping function and iframe geometry; baseline comparisons plus VM execution. Snapshot producer and full backend still pending.
- NB/xB/ZX/QX/XX -> service-file-chooser.ts. Event lifecycle, authorization and file input dispatch. Out-of-process uploads rejected as original. Unit coverage does not establish native upload acceptance.
- SessionBrowserApi native tab ID declarations corrected through actual CDP/tabs/UI constructor type assertions. Wire inputs remain number/string compatible; native list entries have numeric IDs.

- S_/UB/HB/oJ -> service-page-waits.ts. Document lifecycle/network-idle/URL matching, timers and cleanup covered by3 original comparisons.
- XD/JD/Xm/YD/ZD/QD/VB/eB/tB/rB -> service-tab-commands.ts. Tab lifecycle, credential redaction and adjacent history navigation covered; Xs safe URL navigation restoration pending.
- zB/GB/XB/JB/CO/nf/YB -> service-tab-interaction-commands.ts. Virtual clipboard and JavaScript dialog handlers, matching source frame and cancellation; full service registry pending.

- KN -> service-command-timing.ts; ZN and descriptor/result helpers -> service-performance-spans.ts.2 timing+2 span comparisons cover approvals, retries, all22 original span descriptors, cycle-safe result counts and trusted host delegation.
- n_/mD/o_/fD/Pm/gD/bD/yD/hD/wD -> service-statsig.ts. Third-party SDK @statsig/js-client3.33.1 directly pinned (embedded SDK_VERSION evidence); own adapters,3 comparisons plus actual offline packed SDK validation. Default service lifecycle pending.
- vU -> service-error-reporter.ts. @sentry/node10.48.0 directly pinned (embedded Or version evidence); captured host fetch/SDK transport/privacy/identity/tag/capture.2 comparisons replace SDK leaf boundary only. Default reporter installation and final service assembly pending.

- i_/Bm/_D/Dm/mt/s_ -> service-telemetry.ts: caller identity and header policy barrier,2 original comparisons. SDK adapters are independent from identity orchestration. No unverified identity can authorize header policy.
- UN/qee/$ee/Hee/Wee/Vee/Yee -> service-discovery.ts default enrichment, SDK gates and diagnostics;9 tests incl7 original comparisons and default wiring. ih+eh assembly -> service-native-context.ts,3 actual framed socket fixture tests; not real backend acceptance.
- Zf/I0/yee/wee/PN -> service-auth-broker.ts,5 tests. Static register options, messages/statuses/delivery validation and transport bounds. Node privileged socket bridge retained; GAAS host/full auth handlers remain pending.
- SU/pse/mse/CU/lC -> service-host-initialization.ts: privileged host capture, GAAS broker binding, config/preferences/native context, filesystem, error reporter, timing/spans and scoped cleanup.5 tests including2 original host comparisons; singleton SDK diagnostic callbacks now bound to captured reporter. Telemetry startup is assembled by service-native-runtime.ts; real Codex App host acceptance remains pending.
- Xs/OX/dB/MX/pB/NX/mB/FX/fB/Jn/LX/UX/Mp/hk/gk -> service-navigate-url.ts: approved navigation, event predicates, document ownership, guarded bounded history restoration and credential epoch permits.3 tests,2 original comparisons cover7 modes plus timeout. Auth document producer and registry integration pending.
- bV/aV/Ni/Sn -> service-visible-dom-page.ts: independent serialized visible snapshot page program;2 original comparisons execute in DOM realms across limits, shadows, form redaction, reviewer and viewport modes.
- XR/KR/Py/JR/uV/YR/lV/cV/Ry/ky/dV/pV/mV/fV/hV/gV/ZR/Iy/Ey/Ay -> service-visible-dom.ts: frame traversal/priority, bounds/clipping and shared snapshot refs.2 original frame assembly comparisons,8 mode combinations; full backend/reviewer auth integration pending.
- wk/lz/$y/cz/dz/pz/mz/fz/yk/Fp/Lp -> service-screenshot.ts: CSS/device screenshots, crop/full page, fresh screencast, fallback and credential guard;2 comparisons,32 option modes +stale-frame success/failure. Real capture acceptance and service registry pending.
- FQ/Tl/nN/LQ/UQ/jQ/g0/b0/qQ/rN -> service-response-metadata.ts: typed response surfaces, controlled tab summaries, screenshot privacy and native-credential suppression;2 comparisons. Full lifecycle integration pending.
- oN/$Q/WQ/HQ -> service-audit-telemetry.ts: security decision/source/permission conversion and suppression;1 original matrix comparison covers7280 combinations.
- AO -> playwright-core1.59.0 fixed dependency, service-playwright-injected.ts own sensitive ARIA-value patch. Whole-source provenance: analysis/codex-cua/playwright-injected-provenance.json and verify-playwright-injected-provenance.mjs. Normalized1.59.0 differs only original521-character redaction insertion.2 actual helper DOM comparisons; no third-party rewriting.
- W_/Ke/H_/CY/FO/ro/X_/wf/DO/BO/bf/TY/EY/J_/ta/OO/z_/MO/to/SY -> service-selector-policy.ts; retry/deadline/error/target helpers with original comparisons.
- yf helper installation/execution/world/cache/recovery methods -> service-playwright-worlds.ts;3 tests,2 original comparisons/8 recovery modes plus bounded cache invalidation. Concrete selector routing/actions pending.
- yf.selectorScopeFunctions/ea -> service-selector-scope.ts: independent serialized same-origin frame scopes, selector slicing/capture, visible strict fallback and pointer geometry.2 original DOM comparisons/4 strict/visibility modes +invalid/inaccessible errors. JSDOM fixtures have no generated pseudo-content and use ordinary style queries.
- yf frameRouteForFirstOopif/resolveSelectorTarget/frameIdForFrameMatch/targetForFrame -> service-playwright-selectors.ts, original routing and metadata programs. Node resolution/binding/page/single/all/readonly preparation/distinct/frame identity methods restored.4 selector comparisons including8 routing modes and actual serialized page functions. Pointer/focus/fill/sequential/select/checked operations and full service wiring pending.
- yf.clickLocator/focusLocator/focusNode/prepareLocatorFill/prepareSequentialInput/readCheckedState/readElementState/performPointerAction/resolvePointerActionTarget/currentTopLevelPointForAction/currentPointInParentFrame/obstructingFrameHitTarget/obstructingFrameBoundaryHitTarget/describeBackendNodeForHitTarget +kO/Ha/IY/To -> service-playwright-input.ts。5 项原包对照；真实页面函数与原生边界请求分别验证。完整服务、连续输入命令及实机验证仍待完成。
- Nu/Fu/Lu/Uu/SB/TB/EB/AB/RB/kB/DB/BB/OB -> service-playwright-commands.ts；IB -> service-playwright-sequential.ts；x_ -> service-playwright-fill.ts；jc/za 的 paste 路径 -> service-playwright-paste.ts；vB/MB/CB -> 命令处理器与 service-playwright-media-download.ts。6 项命令与2项粘贴对照。原 jc copy/cut 分支、press 快捷键、只读求值和完整服务注册仍待完成。

- ju/Cn/Wg/$4/q4 -> service-playwright-press.ts/service-playwright-clipboard-shortcut.ts；jc/PC 的 copy/cut 路径 -> service-playwright-copy.ts；bB/yB/$X/WX/HX -> service-playwright-snapshot.ts。真实隔离页面序列化、跨 iframe 焦点及剪贴板令牌对照通过；只读 JS、安全沙箱与完整命令服务入口仍待完成。
- jO/UY/jY/Y_/Z_/qY/qO/$O/UO/dn/Q_/WO/e0/HO/VO/zO/WY -> service-readonly-evaluate.ts 与 service-readonly-sandbox.ts。只读 DOM 防护内核为原包一方可读源码直接恢复，约2705行，已独立封装为自有源码，非第三方包；来源行41587–44292。动态导入、DOM 写入、凭据、选择器多元素、上下文销毁重建及失败后的临时绑定清理均与原包对照通过；`playwright_evaluate` 已接入候选 Playwright 命令表。完整后端服务注册与实机验收仍待完成。

### 服务命令与候选入口（2026-09-28）

- 权限状态 `src/service-permission-state.ts` / `src/service-preferences.ts` 对照原服务 `c0` / `jM` / `ra.maybeAutoAnswerBrowserUseRequest` 与 `Zo`：未知资源类型没有配置表或审批模式，不能借用 upload 表的持久授权，也不建立会话存储；非字符串的 `approvals_reviewer` 不能因字符串转换而成为自动审查结果。原包差异回归见 `tests/service-permissions.test.ts`；权限门及命令安全定向测试仍通过。完整服务接线和真实宿主验收另行跟踪。

- `service-playwright-commands.ts` 现注册 jB/qB/HB、NB/xB 和 jO：页面等待、文件选择器、只读求值经原包对照，失败的节点绑定会删除临时全局并释放 CDP 句柄。
- `service-extra-commands.ts` 对应 id/Za/NT/FT/SO/GO/KO；`service-misc-commands.ts` 对应 Fp/Xs/jm/EO；`service-cdp-commands.ts` 对应 yO/wO；`service-content-export.ts` 与 `service-content-export-page.ts` 对应 vO/xO 及页面脚本；`service-webmcp.ts`/`service-webmcp-page.ts` 对应 $D/il/b_ 与注册代际。每组有原包差异测试；页面测试与受控 CDP fixture 不等于真实 macOS 验收。
- `service-backend.ts` 对应 zf 的一浏览器状态装配/生命周期；`service-command-registry.ts` 对原 vf 注册原始 75 个命令中的现有具体处理器做显式去重。目前 75/75 个原始命令名均已注册。`cua_type`、`dom_cua_type` 的纯文本和富文本路径均已对照；认证自动安全审查及真实特权浏览器验收仍未完成，命令名覆盖不代表行为完整。
- `service-auth-command.ts`/`service-auth-registry.ts` 对应 AD 主处理器；`service-auth-*` 模块分别对应原包的页面/表单绑定、GK/KK 凭据预检、bk/qy 文档请求保护、jy 私有隔离表单、Uy/lX 输入提交、QR 解码与轮询、Zf broker。普通表单、ordinary v10、private v8 和 native 凭据交付已接实际服务宿主 API；分段 OTP、`press_enter`、无字段 selector 选项及 native+manual 混合标志有定向行为测试。原包差分包括 GK/KK/jy/Uy/d_/XK、请求验证、字段计划、绑定与 broker 边界；文档 permit 用 HMAC 校验 POST 字段并测试中断/释放路径。当前证据为认证及 registry/dispatcher 定向测试和 browser-runtime build，未在真实 native pipe 中完成端到端认证验收。
- 认证仍保持部分路径拒绝：跨域可信 iframe 仅在原包 d_/XK 的 registrable-domain 和嵌套 frame 链校验全部通过时开放，并在提示标注 `cross_origin_iframe`；缺失跨站 registrable-domain 或中间 frame 不受信任时返回 `locator_invalid`。自动安全审查开启时，复制版 tk 在读取缺失的 `browserAuthSafetyPrecheck` 内置文档处即抛出 `BrowserUseSecurityError(approval_unavailable)`，尚未进入截图、reviewer 或凭据提示。`service-auth-safety-checkpoint.ts` 在四种环境下对齐此错误的类型、原因、消息、底层原因和停止顺序；仍未宣称 tk 审查 checkpoint 的可运行路径已还原。复制的 vendor/back 没有 `browserAuthSafetyPrecheck.md`；当前 App 安装包的 cloud/orbit 目录有两份字节相同的官方资源（SHA-256 `a0002fc9b9bcda1f6db4f759431e625321e45d68e02bacfb4f226d4542a94ee8`），codex-app 目录没有。App 随附的 `@oai/cua` 复制对应 bundle SHA-256 相同，但当前受信映射实际指向另一包 `@oai/browser-desktop/service`，其 bundle SHA-256 不同，不把两者服务行为混作同一基准。复制版内置的 15 项文档与 App 的 training 目录逐项相同，原版无显式 root 的资源读取也使用该内置清单。QR 首次捕获及后续轮询都先经固定 `zxing-wasm@3.1.2` reader WASM 解码，再在无法判定时使用页面 BarcodeDetector；原包内置 WASM 与 npm 文件 SHA-256 均为 `0e8d688d71932ebb6b8b33f700d43d3cb997f59ed9cab3c05102d7f10288a392`，真实 QR 图像的原包差分通过。候选实现不导入 vendor/analysis/back，未切换生产 loader。
- `service-auth-safety-checkpoint.ts` 的内部 `runAuthSafetyCheckpoint` 已把原 tk 的说明读取、认证 frame 可见 DOM 捕获、审查前重校验、review/screenshot 并发及最终重校验独立还原；测试只在原包和候选的隔离资源中注入相同合成说明，并将原 KR 页面快照边界替换为相同受控夹具。十一种成功/失败模式的请求 payload、调用顺序、返回值与错误逐项一致，包括同步审查创建失败及两个并发分支同时失败的优先顺序。生产打包的说明仍缺失，认证主处理器仍先 fail-closed，尚未接入真实安全审查或 native pipe。
- `service-command-dispatch.ts` 对应 SN 中命令调度段，复用凭据观察门并在命令前做文档、安全和 WebMCP 注册名检查；`service-native-runtime.ts` 对应 SN 资源、文档、后端装配。新装配与原 SN 差异测试覆盖 reporter/Statsig 启动、invocation started/setup/ready 事件及安全审计回调字段；定向测试先 RED 后 GREEN。`service.ts` 在释放旧实例前调用一次性 `beginNativeRuntimeTelemetry`，新装配消费标记以避免重复事件；时序差异回归先 RED 后 GREEN。候选入口经受控 setup/全局 list_browsers 与重复 setup 释放测试；两个并发 setup 曾泄漏一组宿主钩子，现将装配与旧实例释放串行化。响应元数据和通知生命周期已接入并有定向测试。生产仍加载 vendor；候选客户端已在真实 macOS 特权宿主调用原版服务完成浏览器验收，候选服务端的 native pipe、AX/WASM、完整认证及真实 socket/浏览器验收仍待完成。

默认 runtime 的集成回归不传自定义 handler：候选 75 项注册表经 `createNativeRuntimeFromInitialized`、凭据 guard、文档检查及安全调度，实际执行候选 Playwright DOM 计数；非法填充报错后释放凭据命令。`analysis/codex-cua/real-macos-playwright-acceptance.md` 另记录复制版与候选版在真实 macOS Chromium 页面上的定位、点击、填充效果对照，页面级成功不替代 App 特权服务验收。

默认 `BrowserBackend` 的另一项集成回归自行建立 CDP 附着，在受控 DOM 上完成计数、下拉选择和输入填充，并检查运行时释放时撤销剪贴板桥接的绑定及注入脚本。这里的 CDP 和安全模式为测试夹具；没有注入 App 的真实 turn metadata，也不代表真实特权 nativePipe 验收。

同一受控后端夹具还验证一次性 CDP 求值错误由选择器重试恢复、持续求值错误到截止时间拒绝、以及失败后下一条命令继续可用；该结果不替代真实宿主断连验收。

实机客户端验收记录见 `analysis/codex-cua/real-macos-client-acceptance.md`：候选客户端调用原版特权服务，对同一本地页面完成发现、创建、输入、点击、AX 和截图对照。候选服务端隔离加载记录见 `analysis/codex-cua/real-macos-service-acceptance.md`：真实 Rust supervisor 加载候选入口，但自建 MCP 客户端没有 Codex App 注入的 turn metadata，发现命令按契约拒绝；nativePipe 与页面操作尚未验收。

### 富文本第三方版本调查（2026-09-28）

原版服务内的 Markdown 渲染器配置为 `breaks: true`、`html: false`、`linkify: false`、`typographer: false`。差异样本排除 13.0.2 与 14.2.0 及以后，只余 14.1.0/14.1.1。复制版 bundle 内联 `linkify` 规则的尾星号处理为逐字符 `charCodeAt(...)=42` 回退；[14.1.0 原源码](https://raw.githubusercontent.com/markdown-it/markdown-it/14.1.0/lib/rules_inline/linkify.mjs) 仍用 `/\*+$/` 正则，[14.1.1 原源码](https://raw.githubusercontent.com/markdown-it/markdown-it/14.1.1/lib/rules_inline/linkify.mjs) 改为逐字符回退。结合版本边界，固定 `markdown-it@14.1.1`；测试直接检查内联代码指纹，并对 14 个代表输入及 96 个固定种子的混合标记输入比较原包富文本 HTML。原 14.1.1 仅在 `typographer: true` 下触发的 [smartquotes 性能公告](https://github.com/markdown-it/markdown-it/security/advisories/GHSA-6v5v-wf23-fmfq) 不覆盖本路径的 `false` 配置。

`service-rich-text.ts` 还原 `qq/$q/Gb/jq/Lq`：纯文本/HTML 剪贴板条目、HTML 首尾空白与单段落展开、Google Sheets 排除规则及固定 Markdown 渲染。`cua_type`/`dom_cua_type` 均复用该模块；原包差异用例比较剪贴板条目、`richTextFallback` 与真实 DOM 可编辑元素插入的 HTML。打包后离线安装/冻结锁重装再次验证 14.1.1 与实际渲染。
