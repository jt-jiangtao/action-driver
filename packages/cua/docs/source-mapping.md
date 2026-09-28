# 来源与实现状态

原始 vendor 只用于测试和说明，不作为候选实现依赖。

| 原始模块 | 候选 | 状态 |
|---|---|---|
| oai_js_core/src/mirror_map.js | src/core/mirror-map.ts | 单元差异测试通过 |
| oai_js_core/src/UnreachableCaseError.js | src/core/unreachable-case-error.ts | 单元差异测试通过 |
| oai_js_types/src/*.d.ts 与 Param | src/types/index.ts、parameters.ts | 10 项类型断言通过 |
| oai_js_cua/src/get_apps.js | src/discovery.ts/getApps | 单元差异测试通过 |
| oai_js_cua/src/get_browser_tabs.js | src/discovery.ts/getBrowserTabs | 单元差异测试通过 |
| oai_js_cua/src/get_state.js | src/discovery.ts/getState | 单元差异测试通过 |

tinysky_alt/tab_reference.js → src/tab-reference.ts 的 URL 解析与唯一浏览器选择单元差异测试通过。

以下各批记录保留实施当时的状态；最新实现与限制以本文件末尾及 OpenSpec tasks 为准。候选 CUA 入口、默认装配和 macOS REPL 已实现并完成对应的定向与宿主对照；生产依赖仍使用原包，浏览器候选服务的特权页面路径仍待整体验收。新增职责名与原命名不同，最终切换仍需单独验证。

## macOS 第二批

- tinysky_alt/documentation.js → src/documentation.ts：文档读取、请求确认策略与 UTF-8 字节限制；有效输入与原包对照。未知文档名主动拒绝，避免资源目录逃逸。
- tinysky_alt/create_tinysky_alt.js 的 macOS computer 分支 → src/computer-session.ts：应用绑定到原生返回的 canonical app、观察/截图、操作转发、文档输出队列与重写。原包测试使用受控 macOS backend，不构成真实桌面验收。
- 原始 Markdown 文档复制到 resources/docs，属于资源，不改写其内容。

本段记录第二批时只完成注入原生后端的 computer session；后续批次已继续实现浏览器适配、默认工厂及服务入口。生产替换仍以整体任务验收为准。

## 浏览器 Tab 适配第五批

tinysky_alt/create_tinysky_alt.js 的 Tab decorator → src/tab-adapter.ts。状态/截图输出、对象身份、全部动作转发、emit=false、组合截图缺失和 browser focus index 校验与原包对照通过。这里只适配注入的 AX 接口，浏览器选择/认领、文档生命周期与完整默认工厂尚未完成。

## 第十二批：browser 会话与 globals 注册边界

- `src/browser-session.ts` 对应 create_tinysky_alt 的 browser-only facade、文档输出队列及 helper u/a：选择/URL 规范化/扩展实例匹配、创建 tab/sessionName/visibility、id/providerId/mention/URL 匹配、认领、列表/state、文档缓存/失败淘汰/重写。使用注入 agent，不代替默认浏览器初始化工厂。
- 13 项原包受控对照通过，覆盖成功/失败、providerId 补全、重复/过期引用、能力缺失、并发文档复用、输出失败恢复与迟到 writer。公开成员顺序回归 RED→GREEN 修复。原测试只替换 browser setup 动态导入边界，原 facade 函数体不改；不构成真实浏览器验收。
- `src/global-registration.ts` 对应 globals.js：启用配置必填、trim/filter/去重/允许值、await 工厂、initialize 别名、全局写入。4 项原入口对照通过，原测试只替换 create_tinysky_alt import 为注入工厂；此模块保持内部使用，尚未新增 tinysky-alt 自动启动导出路径。
- Browser runtime TabSummary 补元数据索引签名，跨包编译断言先 RED 后 GREEN；TabControls+AXAPI→CUA decorator→SessionTab 与 TabsControls→SessionBrowser 均通过类型兼容验证。此装配用来检查边界，不代表完整 Tab/Browser factory 完成。
- browser 与 computer 单独会话均已实现；合并会话必须共享文档生命周期，默认工厂及配置/原生入口仍未完成，不允许把两个单独对象直接拼接后宣称完整。

## 第十三批：共享会话生命周期与配置装配

- `src/session-lifecycle.ts` 对应原 create_tinysky_alt 的共同 g emitter：core/browser 文档缓存、requestMeta owner、串行输出及失败后恢复。browser/computer 单独会话也复用该模块；合并会话只持有一个生命周期。
- 宿主 `write` 属性可由 getter 提供；原 emitter 每次入队只读取并绑定一次。候选曾重复读取，导致轮换 writer 时文档进入错误输出目标。`src/session-lifecycle.ts` 已按原顺序修复，原包受控 writer getter 对照先 RED 后 GREEN。
- `src/session.ts` 对应共同 getState 与启用面装配：getState 聚合两个后端、共享文档重写与输出，按原公开成员顺序选择性提供浏览器/桌面方法。6 项原合并会话对照验证初始化只输出一份 core、metadata 重写、并发观察、失败恢复以及单/双/无注入后端。
- `src/runtime-factory.ts` 对应 browser/computer 初始化 Promise.all 与 CUA_REPL_BROWSER_ENV/初始化文档配置：并行加载、四个环境值、decorateTab、隐藏 Tab.ax 与文档排除。7 项测试中 5 项原配置装配对照、2 项 macOS 范围/loader 控制验证。非 macOS 提前拒绝是本期已批准范围，不作为原包跨平台行为一致证据。
- 原对照仅替换浏览器 setup/sky 导入边界，原共同 emitter/config/facade 函数体保留；不验证被替换的浏览器/原生后端。配置装配仍要求显式传入加载器，未接入具体默认加载器或自动启动 export，不宣称默认工厂/生产入口完成。
- `src/default-runtime.ts` 的默认 browser 加载器保留 `setupBrowserRuntime()` 返回的完整 agent，使原包发布到 `globalThis.agent` 的 `documentation.get()` 仍可用；此前只保留 `browsers` 的缺口由原包受控装配与候选实际 RPC 定向对照 RED→GREEN 验证。此测试不构成真实浏览器服务验收。
- 合并/单独会话的声明构建与类型断言通过；对输入启用面的 overload 保留相应方法的可调用类型。browser-runtime 完整装配、schema 版本/SDK 锁定和真实操作验收仍未完成。

## 第十七批：旧版 CUA initialize 生命周期

`oai_js_cua/src/cua.js` → `src/legacy-facade.ts`。与 tinysky_alt REPL facade 分开：公开 computer/browsers/documentation 初始为 null；每次 initialize 都重新调用 setupBrowserRuntime({undocumentedApiMembers:['Tab.ax']})，依次绑定引用，再聚合状态。保留脱离对象调用、setup 失败保留旧引用、getter 失败部分绑定、provider 第二次读取、并发完成顺序和调用方改写 public slots 后初始化覆盖的原行为。

9 项原模块对照测试只替换 browser setup 与 sky import 的装配边界，实际 get_state/get_apps/get_browser_tabs 保持原实现；相对 imports 转 data URL，原函数体不改。候选共享自身 discovery，不加载原包。低层生命周期内部工厂与泛型接口已实现，但未新增默认 cua 单例或替换 index.js；默认具体 backend 和真实验收仍待完成。

## Approved declaration-only implementation

2026-09-28 user approved documented autonomous contracts because original runtime files are absent. CUA core tools map to src/core/declared-helpers.ts; Sky env/unimplemented map to src/core/env.ts. Unit/type tests validate the approved contracts, NOT original runtime parity. Debounce default0ms, latest receiver/arguments; lazy first-success result cache (sync throws retry, Promise identity cached); env normalization and first-success/default cache follow declarations, while help/errors are project-defined. Full original edge equivalence remains unknown.
