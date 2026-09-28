## 1. 实施准备与基准

- [x] 1.1 用户审查书面设计，使用 Superpowers writing-plans 编写详细计划并确认执行方式，以审核后的计划为证据。
- [ ] 1.2 清点五个包及其每个自有 lib 的全部模块、类型、导出、资源、动态导入及第三方依赖，核实确切版本并在使用方 package.json 引入、由锁文件固定；交付版本与哈希清单，定向验证漂移明确失败。

1.2 增量证据：Browser 内嵌文档和键盘数据的来源/输出哈希现有独立只读校验命令 `node analysis/codex-cua/verify-browser-resource-provenance.mjs`；两份记录通过。新定向测试先因校验器缺失失败，补齐后 2 项通过，并分别证明来源与输出内容漂移会按路径报错。tslib 原包确切版本及混合 bundle 内部归属仍未确认，1.2 不标完成。

本机 App 安装的三份裁剪 `tslib` 文件与固定复制包哈希相同；安装锁文件的 `tslib@2.8.1` 属于 `@emnapi/runtime` 依赖，不能作为这些裁剪文件的版本依据。1.2 的确切版本要求仍未满足。
- [ ] 1.3 分析每个自有 lib 的用途与行为契约，区分事实和推断；识别 browser bundle 模块和重复捆绑代码，交付来源对应清单；未知归属不得被忽略，新增边界决策先 Battle。

重复 Sky 来源补充：CUA 与 Sky 的 54 个共同 JS 路径中 53 个字节相同，唯一不同的 macOS telemetry 文件只在 Statsig 的直接导入/虚拟构建入口上不同；已有同输入原包两份与候选 telemetry 对照。`analysis/codex-cua/verify-duplicated-sky.py` 固定检查路径与差异。browser 三个混合 bundle 的内部归属尚未全部证明，1.3 保持未完成。
- [ ] 1.4 根据接口与用途清单将下列包级任务细化为单次会话可完成的自主实现任务，包含全部 core/types 与只含声明的工具，各任务包含正常、边界与错误单元测试及对应差异用例，更新同一 tasks 并校验范围一致。

## 2. 独立源码与验证框架

- [x] 2.1 建立四个 @actiondriver workspace 实现包和 cua-parity，新实现目录与标识不使用 oai_ 前缀，验证 workspace 识别、独立构建及运行时默认依赖未改变。
- [x] 2.2 建立可复现阅读副本生成与原文件映射，验证原 vendor 哈希不变且分析资料不进入构建。
- [x] 2.3 建立原包/重建版独立进程 runner、受控依赖与固定输入，验证两次基准运行稳定、进程故障与清理可诊断。
- [x] 2.4 建立结果、错误、事件、调用序列的差异报告和显式归一化清单，用故意不同的实现验证差异不被吞掉。

## 3. 模块重建（须先完成 1.4 的模块任务拆分）

- [ ] 3.1 按接口与用途细化清单自主实现 sky 通用与 macOS 自有 JS 逻辑和资源接线，交付 TS、来源映射与全部对应差异用例结果。
- [ ] 3.2 按接口与用途细化清单自主实现 cua，验证公共导出、参数默认值、观察动作与异常契约和跨包调用。
- [ ] 3.3 按接口与用途细化清单自主实现 cua-repl，验证入口、文档输出、会话状态及重置行为。
- [ ] 3.4 按接口与用途细化清单自主实现 browser 客户端，验证 API manifest、序列化、命令与文档输出契约。
- [ ] 3.5 按接口与用途细化清单自主实现 browser 服务端，验证协议、事件、资源释放和识别后的第三方依赖版本。

## 4. 整体验收

- [ ] 4.1 执行跨包成功与失败路径对比，覆盖关闭后操作、断连、超时、非法输入和重置，交付可复现报告且无阻断差异。

4.1 增量证据：CUA 合并会话新增 computer 发现断连后 browser 文档继续可用、computer 后续重试成功的原包差异用例；browser 默认后端补一次性 CDP 失败重试、持续失败到截止时间及下一条命令恢复的受控集成用例。两文件 15 项定向测试及两个包的类型检查通过。真实特权宿主断连、关闭与重置全路径尚未验收，4.1 保持未完成。
- [ ] 4.2 分别在重置夹具上执行 browser 和 computer-use 真实操作，对比状态、截图与资源清理；不可用路径报告阻塞，mock 不计真实验收。
- [ ] 4.3 核对全部自有模块实现和来源映射、接口兼容、第三方锁定、独立可复现构建，交付覆盖矩阵与已知限制。
- [x] 4.4 验证验收前生产依赖、loader 和打包接线一直使用原包，以运行路径证据和改动审查确认。

4.4 证据：`runtime-process.ts` 仍把 `dist/vendor/codex-cua` 交给 Computer Use；`repl-server.mjs` 按该根加载原 `@oai/sky` 和 `@oai/cua`，`apps/agent-runtime/package.json` 不依赖任何新 `@actiondriver/*` 包。`workspace-boundary.test.ts` 固定此接线并核对 vendor/back 字节一致，`entry.test.ts` 仍检查公开入口引用原包；两组定向测试各 3 项通过。后续切换前须再次运行边界测试和改动审查，此时未切换生产。

4.2 阶段证据：`analysis/codex-cua/real-macos-client-acceptance.md` 记录候选 browser **客户端**通过原版特权服务运行本地重置夹具，输入/点击后的 AX 文本及 14139 字节截图逐字节一致、临时标签清理完成。`analysis/codex-cua/real-macos-computer-acceptance.md` 记录候选 Sky **客户端**通过原版特权服务执行计算器点击、应用状态/截图和退出清理对照。`analysis/codex-cua/real-macos-sky-service-acceptance.md` 记录候选 Sky **服务端**在独立真实 Rust supervisor 中加载，`setup` 的 mac/11 方法和原生 `list_apps` 的 27 项数量/类型与原版一致；授权后的 AX/动作未在候选服务中验收。`analysis/codex-cua/real-macos-service-acceptance.md` 记录候选 browser 服务在隔离真实 Rust supervisor 中加载，并用同版本 App 签名的 classic-level 3.0.0 跨过 macOS 签名边界；随后发现步骤因隔离客户端缺 Codex App 注入的真实 turn metadata 而按契约拒绝。候选浏览器服务的 nativePipe、页面操作和截图仍未实机验收，故 4.2 保持未完成。

2026-09-28 边界裁决：以上 Codex 服务实验仅留作历史研究，**不计入最终 4.2 验收**。五个候选包的最终真实场景均须使用 ActionDriver 自有 macOS 宿主；离线原包/候选差异可继续，但不得触达 Codex 私有服务。

## 5. 后续整体切换与交付

- [ ] 5.1 在 4.1–4.4 全部通过后编写具体整体切换与原包回退计划，记录验收结论；新增边界与范围冲突先裁决。
- [ ] 5.2 按验收后的计划统一替换运行和打包接线，定向验证实际加载新包、真实场景兼容与回退可用。
- [ ] 5.3 准备提交时按 AGENTS.md 一次性执行适用全量检查，记录数量及已知无关失败，只提交本任务文件；完成后按 OpenSpec archive 流程归档。

## 6. 首批自有模块（按清点结果拆分）

- [x] 6.1 实现双向映射与不可达异常，正常值、重复值、键冲突、symbol 和错误消息与原包单元对比通过。
- [x] 6.2 实现全部现有通用类型声明，10 项数组、参数位置、右侧覆盖和展平的编译断言通过。
- [x] 6.3 实现应用发现、标签合并、状态汇总，跨平台、去重、用户标签失败和部分失败单元对比通过。
- [x] 6.4 实现 sky 字节读取和编码，子数组偏移、空数组、文件缺失的单元测试通过。
- [x] 6.5 实现标签引用解析及浏览器选择，非法 URL、重复字段、缺失/多个 profile 与原包单元对比通过。
- [x] 6.6 明确只有声明的工具函数行为，补充证据并定义完整单元测试，未确认部分不标已还原。
- [x] 6.7 完成 tinysky 对象与文档生命周期适配，按接口清单验证完整状态和错误行为。
- [ ] 6.8 完成 macOS 客户端、RPC 与 browser bundle 的分模块实施计划，逐项单元验证且不替换生产入口。

## Verification Record

首批在隔离工作区 codex/cua-reconstruction 执行；原包清点 1117 条目。五包定向构建通过、通用类型断言通过、原包基准无漂移。未准备 git commit，因此未运行仓库全量测试。原包单元差异对比不代替完整真实操作验收。

第三方安装尚未完成：离线 lock 操作报告现有多文档锁文件解析与元数据缺失；未修改锁文件、未升级依赖。被重建的主工作区根依赖和工具入口已从保留 store 恢复，tsc/vitest 版本验证通过；隔离工作区改用独立工具链接。独立全新环境安装和依赖元数据完整性尚未验收，不勾选 1.2。

最终首批定向验证：13 文件、31 单元测试通过，10 项类型断言通过；独立审查的 5 项问题均有复现测试并修复。

平台补充裁决：本期只实现与验收 macOS，Linux/Windows 专属模块标记暂缓，原始基准保持完整。
6.7 复核：候选共享 Session、浏览器/计算机并发初始化、文档缓存、全局注册及默认工厂在受控原包对照中覆盖状态和失败路径；定向 5 文件 22 项通过。真实 macOS 双服务端组合和生产入口仍由 4.x/17.4/18.4 跟踪。

## 7. macOS 第二批（局部实现，不代表 3.x 完成）

- [x] 7.1 重建 REPL 文档装配，按 macOS 与 browser 环境选择原始资源，原包有效输入内容对照，拒绝非 macOS。
- [x] 7.2 重建可注入的 REPL 启动参数与子进程生命周期，验证禁用 surface、环境覆盖、信号、错误与监听清理。
- [x] 7.3 重建 CUA 文档读取及确认策略，验证 UTF-8 字节上限和无效 metadata，拒绝未知文档路径。
- [x] 7.4 重建 macOS computer session 与 bound-app 观察和动作，验证 canonical app、缺失截图、参数转发、emit=false、文档缓存/失败恢复及 metadata 身份。
- [ ] 7.5 完成默认工厂和服务模块导出、跨包接线与可启动入口；此前不声明 launcher 可直接替换。
- [ ] 7.6 完成 macOS 原生 backend/RPC 和浏览器分支，执行真实 macOS 场景对照。

第二批定向验证：17 文件、59 单元测试通过；CUA 与 CUA-REPL 构建、10 项类型断言、完整原包基准漂移检查、OpenSpec strict 校验通过。未运行仓库全量测试，未提交或切换依赖。

第二批独立审查：确认 emit=false 与晚接入 host 的文档初始化差异；两项复现测试 RED→GREEN 修复，未遗留已确认审查问题。

## 8. macOS RPC 第三批（已裁决模块拆分，仍属 3.1 的局部实现）

- [x] 8.1 重建全部 server code 与错误模型，保留协议 error.name，未知 code 明确 jsonRPCError。
- [x] 8.2 重建 4 字节小端长度帧编解码，验证 UTF-8、8 MiB 上限、分片与多帧原包差异。
- [x] 8.3 重建 RPC 会话队列、metadata、deadline、响应匹配、超时与断连失败，验证队列恢复和迟到响应。
- [x] 8.4 重建连接重试、API version 握手、host ensureService 和 launchServices fallback，验证失败原因与迟到连接关闭；受控启动序列原包对照。
- [x] 8.5 重建全部 MacComputerUseClient 请求，验证观察/音频/动作、默认值、非法参数、transport 缓存与 metadata 优先级；6 项类型断言通过。
- [x] 8.6 重建上层 policy、telemetry 自有逻辑、snake_case facade、window_result 和音频输出，受控 SDK/backend 接入既有 CUA 会话验证跨包行为；实际第三方安装仍由 1.2 与整体验收跟踪。
- [ ] 8.7 在可重置夹具和真实 macOS 服务上执行验收；mock RPC 不计完成。

8.7 阶段证据：候选 Sky 客户端通过原版 macOS 服务完成应用发现、活动监视器 AX/截图和计算器操作对照；候选 Sky 服务端在隔离特权宿主中完成 `setup`/原生 `list_apps` 对照。两者尚未在同一真实候选端到端路径完成授权后 AX/动作、异常和资源清理，因此保持未完成。

第三批独立审查：构造配置保持调用方引用会改变默认 apiVersion/timeout/metadata，已补参数修改对照测试 RED→GREEN 修复；未遗留已确认阻断项。
第三批联合定向验证：21 文件 / 86 单元测试通过；sky 独立构建、sky 6 项与 cua 10 项类型断言通过；原包 baseline matches，OpenSpec strict valid。未准备 commit，不运行仓库全量测试；未提交、未修改生产接线。

## 9. macOS 上层与服务第四批

- [x] 9.1 重建获准应用输入快照、策略检查、审批与响应元数据，验证 accessor 不执行、取消/错误 telemetry、审批等待期间参数修改不影响快照。
- [x] 9.2 重建遥测事件自有逻辑，分别对照 sky/cua 两种捆绑形式；验证初始化、用户补全、ambient network/analytics 禁用与 SDK 失败吞吐，不重写第三方 SDK。
- [x] 9.3 重建应用结果、全部 macOS 操作 facade 与音频本地字节，验证重复说明、Numbers 排除、非法资源、全部参数和音频原包对照。
- [x] 9.4 重建 macOS 配置、RPC 服务与代理、默认 sky 和 ./service 导出，验证继承/accessor 调用拒绝、音频序列化与原包调用对照。
- [x] 9.5 编译期验证 Sky facade 与 CUA Session 接口可直接连接，实际执行受控跨包审批/动作/截图。
- [x] 9.6 完成 Statsig 3.32.6 的实际依赖安装、锁定与真实 SDK 适配验证，补完整独立环境验证；不以注入 SDK 代替。

第四批联合定向验证：26 文件 / 118 单元测试通过；Sky 构建、6 项 Sky 与 10 项 CUA 类型断言、跨包 facade/默认 sky→CUA 编译验证通过；原包 baseline matches、OpenSpec strict valid。未运行仓库全量测试，未提交或修改生产接线。Statsig 仅夹具验证，实际依赖安装/锁定仍未完成。

## 10. 通用工具与 browser 基础第五批

- [x] 10.1 重建通用命令执行与包内二进制定位，macOS 正常/错误、流输出/输入和 override 与原包对照；不实现 Windows 专属包装。
- [x] 10.2 重建 FunctionAgentTransport 与显示桥，验证超时 envelope、side-effects 顺序、空/非法/失败响应、字节和 JSON 输出/截断；不把第三方 schema 库纳入重写。
- [x] 10.3 重建 browser 通用对象/RegExp/error 判断和 request ID，跨 realm 与原包对照。
- [x] 10.4 重建 CUA Tab AX facade，验证所有观察/动作参数、身份保留、缺失截图、输出抑制与焦点索引合法性。
- [ ] 10.5 重建 Browser/Tab/Playwright 类、原生命令/schema、manifest 过滤与 runtime/service setup；核实剩余捆绑来源与依赖版本。

客户端入口补充对照：原始 `browser-client.js` 与实际 `browser-client.mjs` 字节不同，候选默认装配对两者分别通过 9 项 runtime 初始化和 2 项完整装配定向用例；Browser 服务端的真实特权路径及内部 bundle 来源边界仍由 10.5/53.5 跟踪，不能据此勾选整项。
- [x] 10.6 重建 CUA 浏览器选择、tab 认领与文档 lifecycle、默认工厂，完成跨包与真实浏览器对照。

第五批独立审查：transport 返回值字段规则与异步显示期间响应快照两项差异，经原包回归测试 RED→GREEN 修复。第五批联合定向验证：31 文件 / 136 单元测试通过；Sky、CUA、browser-runtime 构建及通用/跨包类型检查通过；baseline matches、OpenSpec strict valid。未运行仓库全量测试，未提交、未切换依赖；10.5、10.6、第三方实际安装锁定及真实整体验收尚未完成。

10.6 后续完成证据：CUA 浏览器选择、tab 认领、共享文档和默认候选工厂的定向 4 文件 21 测试通过；`analysis/codex-cua/real-macos-client-acceptance.md` 记录候选客户端经原版特权服务对同一本地重置页面完成输入、点击、AX 与截图对照。此项仅证明客户端跨包路径，候选浏览器**服务端**真实 nativePipe/页面验收仍属 4.2/10.5/53.5。

## 11. Browser 定位与页面接口第六批（10.5 的模块拆分，非整包完成）

- [x] 11.1 重建 Locator 的 selector 组合、文本/正则编码与同 tab 检查，FrameLocator 全部定位接口，验证正常/非法输入原包对照。
- [x] 11.2 重建 Locator 直接读取和 all() 共享读取缓存，验证空条目 fallback、失败淘汰、并发复用、相对 query 与 filter 缓存范围。
- [x] 11.3 重建 Locator evaluate/evaluateAll 与页面 evaluate 脚本序列化，验证函数、字符串、JSON/undefined/circular/BigInt 与序列化异常。
- [x] 11.4 重建全部 PlaywrightAPI 页面方法、Download 与 FileChooser，验证导航/等待默认值、事件对象、文件与坐标合法性、截图字节和错误传播。
- [ ] 11.5 完成 Locator 全部动作、缓存失效和诊断错误；Browser/Tab 全部其他接口、capabilities、schema、manifest 与 setup/service 保持 10.5 未完成。

第六批验证：33 文件 / 158 单元测试通过；browser-runtime 构建、6 项浏览器类型断言与 Sky→CUA 编译验证通过；baseline matches、OpenSpec strict valid。独立审查发现 evaluate 回调 never 类型问题，经编译断言 RED→GREEN 修复；运行时私有状态可见性经 ownKeys 回归修复。未运行仓库全量测试、未提交或切换依赖。定位器动作/诊断与 Browser/Tab 其他接口、setup/service、第三方锁定及真实验收尚未完成。

## 12. Locator 动作与平台缺口第七批

- [x] 12.1 重建 Locator 全部动作、选项规范化、waitFor 和 downloadMedia，验证默认值与错误输入原包对照。
- [x] 12.2 重建动作成功后共享缓存清理、失败 DOM 诊断和 fallback，执行两版诊断脚本验证结果与 DOM 读取顺序；脚本源码格式差异单独记录。
- [x] 12.3 按用户要求写非 macOS 平台缺口说明，列 Linux/Windows 自有模块、平台入口、资源与后续验收；通用实现不代表平台已支持。

11.5 中 Locator 动作部分已完成，由 12.1/12.2 验证；Browser/Tab 其他接口、schema、manifest、capabilities 与 setup/service 仍未完成，因此保持 11.5 和 10.5 未勾选。平台缺口文件：`docs/codex-cua-platform-gaps.md`，后续扩展平台时须更新。

第七批独立审查：选项属性读取在错误捕获外导致 null/getter 异常缺失动作诊断，经四方法原包回归测试 RED→GREEN 修复。最终联合定向验证：34 文件 / 167 单元测试通过；browser-runtime 构建、6 项 browser 类型断言与跨包集成编译检查通过；baseline matches、OpenSpec strict valid。未运行仓库全量测试、未提交、未修改生产接线。真实操作验收仍未完成。

## 13. Tab 子接口与原包备份第八批

- [x] 13.1 重建 AX、坐标 CUA、DOM CUA 全部方法，验证观察模式、截图缺失/解码、输出顺序、全部动作与非法参数原包对照。
- [x] 13.2 重建内容导出、剪贴板格式映射及日志参数规范化，验证返回值、默认值与异常。
- [x] 13.3 重建 Tab 核心导航/截图/交接控制和四种 dialog，验证可变 id、无 transport、prompt 输入和未知 dialog；内部 TabControls 基类不当作完整 Tab 导出。
- [x] 13.4 原 vendor 全部包原样复制到 packages/back，保留原目录，生成逐项哈希清单并校验；备份不参与实现 workspace 或生产接线。
- [x] 13.5 验证 AXAPI 可直接连接 CUA Tab facade，补观察/剪贴板和跨包编译断言及受控调用；非真实浏览器验收。
- [ ] 13.6 完成 Tab 构造装配及全部 capability 注册、Browser/Tabs/User/Agent/manifest/schema/setup/service；此前不声明完整 Browser/Tab 可替换。

第八批最终验证：37 文件 / 186 单元测试通过；browser-runtime 构建、11 项 browser/AX/clipboard/跨包编译断言及 Sky→CUA 集成编译检查通过；vendor 与 packages/back 备份各自 baseline matches，OpenSpec strict valid。备份全部 962 文件/链接可纳入版本管理，已添加仅针对 packages/back 的忽略例外；原 vendor 保留。未运行仓库全量测试、未提交、未切换生产接线。13.6 及真实验收继续未完成。

## 14. Browser 选择与集合核心第九批

- [x] 14.1 重建 Browsers/Documentation/Agent，验证全部选择命令、observer/factory 顺序与失败、结果身份、文档和 transport 校验。
- [x] 14.2 重建 Browser 核心 history/documentation/nameSession 内部基类，验证日期、queries、limit、空名以及 public browserId 与捕获 id 的用途差异。
- [x] 14.3 重建 Tabs 新建/选中/列表/get 与 BrowserUser openTabs/claimTab 的内部集合基类，验证工厂失败、空 id、原包对象 id 规则与忽略无关 accessor。
- [x] 14.4 补浏览器选择与异步 tab 工厂的编译断言；原包/候选受控测试，不计真实验收。
- [x] 14.5 Pin compatible Zod v3 under the 2026-09-28 explicit user ruling; record original version unknown, verify actual installed version and parameter/result/error parity; do not rewrite third-party schemas.
- [x] 14.6 完成 schema 依赖的 capability、tabs.content、user.getTabContext，再装配完整 Browser/Tab；保持 13.6/10.5 未完成。

14.5 证据：固定 `zod@3.25.76` 并在离线打包安装中读取实际版本；原包精确 Zod 版本仍未知。全部可枚举命令的参数、结果、消息与 issue 结构已有原包差分；新增逐字段缺失、`null`、数组和 `NaN` 边界，`command-schemas.test.ts` 165 测试通过，特定 capability 的结果/错误差分见 `capability-schema.test.ts`。只证明已覆盖输入的兼容性，不把未知原始补丁版本写为相同。
14.6 证据：`capability-registry.ts` 注册具体 browser/tab 能力，`tab-collections.ts` 实现 `content` 和 `getTabContext`，`composition.ts` 装配 Browser/Tab/User，`default-runtime.ts` 接入默认工厂。对应 5 个定向测试文件 24 项通过且 browser-runtime typecheck 通过。13.6/10.5 涉及更广的完整服务及实机边界，仍未勾选。

第九批（执行型，既有批准范围）：重建 Browsers/Documentation/Agent、Browser history/documentation/nameSession 内部基类、Tabs new/selected/list/get 与 BrowserUser openTabs/claimTab。新增受控原包对照；工厂/observer 顺序、结果身份、错误、可变 public id、日期和输入校验、无关 getter 均验证。独立审查指出 BrowserInfo name/type 不应可选，编译断言 RED→GREEN 修正；异步工厂返回类型发生 Promise 嵌套，编译断言确认 RED 后以 Promise<Awaited<T>> 修正，新增 async 工厂成功/拒绝的原包运行对照。Browser/Tab 完整装配与 schema-dependent 接口不宣称完成。

第九批最终定向验证：39 文件 / 198 单元测试通过；browser-runtime 独立构建、22 项 browser 编译赋值断言与 Sky→CUA 集成编译检查通过；vendor 与 packages/back 均 baseline matches，OpenSpec strict valid。未运行仓库全量测试、未提交、未切换生产依赖。browser 捆绑 schema 库可识别为 Zod 风格，但复制元数据未给出确切版本；14.5 继续未完成，不猜测版本，不重写第三方引擎。14.6、13.6、10.5、SDK 安装锁定及真实验收继续未完成。

## 15. 能力基础与 API 可见性第十批（14.6 的独立基础部分）

- [x] 15.1 重建能力集合、browser/tab 元数据与文档路由、注册描述符，验证公开引用、记录变化、继承查找、工厂覆盖与错误传播原包对照。
- [x] 15.2 重建 API 视图和支持覆盖规则内部模块，验证成员隐藏、身份缓存、方法绑定、Promise/数组返回、参数解包、属性描述符、Tab 装饰和默认支持规则。
- [x] 15.3 补能力基础与视图的编译赋值断言，记录 schema 依赖静态证据和确切版本缺口；不将特征识别当作版本确认。

14.5、14.6、13.6、10.5 保持未完成；15.1/15.2 不意味着具体能力命令、完整 Browser/Tab 或 runtime factory 已完成。

第十批（执行型）：15.1/15.2 的缺模块对照测试先确认 RED，再实现能力集合/元数据/注册描述符、API 可见性代理和默认支持覆盖。测试只追加原 bundle 内部符号 export；重建实现不引用原包。API view 抽为内部装配模块，具体能力命令/完整 factory 不标完成。schema 静态特征及版本证据缺口记录于 packages/browser-runtime/docs/dependency-evidence.md；不以 Zod 系列 API 特征推断唯一发布版本。

第十批最终定向验证：41 文件 / 213 单元测试通过；browser-runtime 构建、28 项编译赋值断言与 Sky→CUA 集成编译检查通过；vendor 和 packages/back 均 baseline matches，OpenSpec strict valid。15 项新增原包受控对照覆盖文档/元数据、记录变化、注册工厂、代理缓存与参数解包、成员可见性和支持覆盖等行为。未运行仓库全量测试、未提交、未切换依赖；未宣称真实操作验收通过。14.5/14.6/13.6/10.5 和实际 SDK 依赖锁定、真实验收继续未完成。

## 16. 运行时初始化与服务生命周期第十一批（10.5 的基础拆分）

- [x] 16.1 重建可信 Node REPL 初始化内部模块，验证 setup 默认值/字段、缺失宿主、失败、捕获 RPC、禁用成员、显示顺序、截图桥与长文本截断；不导出完整 setupBrowserRuntime。
- [x] 16.2 重建服务 setup/execute 生命周期与 own-property 分派，验证允许环境、未初始化、失败恢复、非法 setup 保留旧实例、并发调用的实例捕获和参数 accessor 边界。
- [x] 16.3 补初始化/服务边界的类型赋值断言与来源说明，明确原服务测试装配边界的替换范围和最小 Browser/Tab 测试夹具限制。

完整 Browser/Tab 工厂、schema 与实际服务后端仍由 10.5/13.6/14.6 跟踪，保持未完成。服务接受 cloud/orbit 环境标签不改变本期仅 macOS 的实现与验收范围。

第十一批（执行型）：可信 Node REPL 初始化模块与服务 RPC 生命周期的缺失模块测试先 RED 后 GREEN。新增 9 项初始化测试（8 项原 client 对照与 1 项内部装配传递），6 项原 service 状态对照。原 service 仅通过追加测试 hook 替换 SU/SN 宿主/运行时装配并重置 Xh，原 fse/JXe 函数体不改。截图链路串联候选 Agent/TabsControls/AXAPI/transport/display，对比原客户端命令与字节输出；测试 Browser/Tab 最小装配不作为生产完整工厂。默认 trusted host 错误、捕获 unbound RPC、host emitImage 动态方法、长文本截断、禁用成员、setup 失败与并发实例捕获均覆盖。

第十一批最终定向验证：43 文件 / 228 单元测试通过；browser-runtime 构建、34 项编译赋值断言及 Sky→CUA 集成编译检查通过；vendor 与 packages/back 均 baseline matches，OpenSpec strict valid。未提交、未运行仓库全量检查、未替换生产依赖。初始化/服务内部模块不导出完整 setupBrowserRuntime/handleRpc 生产入口；schema 确切版本、具体能力命令、完整 Browser/Tab/default factory、实际后端与真实验收仍未完成。原服务 environment 四个值的保留不扩大 macOS 平台/部署范围。

## 17. CUA browser 会话与 globals 边界第十二批（10.6 的拆分）

- [x] 17.1 重建注入 agent 的 browser-only 会话，覆盖全部选择、建页、认领、列表/state 和文档缓存/队列/重写行为的原包对照。
- [x] 17.2 重建 globals 启用配置和注册内部模块，验证成功、非法输入、工厂失败与异步等待；完整自动启动导出路径继续未完成。
- [x] 17.3 补 CUA browser 会话和 browser-runtime Tab/AX/collection 的类型兼容断言，修复公开成员顺序与 TabSummary 记录类型差异。
- [ ] 17.4 完成共享文档生命周期的 browser/computer 合并会话、默认 macOS 工厂、运行时配置与 globals 自动启动路径，再通过跨包运行验证与真实操作验收；不直接拼接两个单独会话代替原生命周期。

10.6、10.5、13.6、14.6 保持未完成；17.1 的 agent 已注入，不验证 browser setup 默认工厂或真实服务。

第十二批（执行型）：注入 agent 的 browser-only CUA 会话与 globals 注册边界，初始缺模块测试 RED→GREEN。浏览器选择/建页、URL 与 extensionInstanceId、id/providerId/mention/URL 匹配、认领、列表/state 和文档生命周期共 13 项原包对照；globals 配置/失败/等待共 4 项原入口对照。自身检查公开 ownKeys 顺序回归确认 RED，恢复原成员顺序后 GREEN。跨包 TabsControls→SessionBrowser 编译先 RED（TabSummary 缺记录索引），补类型后 GREEN；未改运行时 TabSummary 数据。默认工厂/combined 文档生命周期未被单独会话代替。

第十二批最终定向验证：45 文件 / 245 单元测试通过；CUA/browser-runtime 独立构建、CUA 16 项与 browser 36 项编译赋值断言、Sky→CUA 集成编译检查通过；vendor/backup 均 baseline matches，OpenSpec strict valid。原测试只替换 browser setup/import 的装配边界，不改 facade 与 globals 逻辑，不宣称真实服务验收。未提交、未运行仓库全量检查、未替换依赖；17.4、10.6、10.5、13.6、14.6 与 schema/SDK 依赖核实锁定、真实验收仍未完成。

## 18. 共享 CUA 会话与配置装配第十三批（17.4 的拆分）

- [x] 18.1 提取共同文档生命周期，browser/computer 单独与合并会话共用缓存、输出队列、requestMeta owner 和错误恢复，保留既有对照。
- [x] 18.2 重建注入后端的合并会话与共同 getState，验证初始化单份 core、公开成员顺序、双面状态、重写、并发和失败恢复，补启用面类型 overload。
- [x] 18.3 重建配置装配与并行加载内部边界，验证 CUA_REPL_BROWSER_ENV、文档排除、AX decorator、关闭面的跳过、初始化失败与本期 macOS 限制。
- [ ] 18.4 接入经过验收的具体默认 browser/macOS backend 加载器和 globals 自动启动路径，再完成默认入口跨包与真实操作验收。

17.4 与 10.6 保持未完成：共享生命周期和配置装配已实现，但具体默认加载器与自动启动路径尚未完成。

第十三批（执行型）：合并会话缺模块测试先 RED；提取共同 session-lifecycle 供 browser/computer/combined 使用，构建共同 getState 与公开成员装配后 GREEN，保留单独会话全部既有对照。6 项原共同会话对照覆盖单份 core 文档、metadata owner、重写、并发与错误队列恢复。配置加载边界另先 RED→GREEN，5 项原配置对照与 2 项 macOS/loader 控制测试通过；两个 enabled backend 并行加载，全部就绪后才共享文档/发布 agent。声明构建暴露跨模块私有类型不可命名问题，以明确 ReturnType 标注保持公开签名，重新构建通过。具体默认 loaders/自动启动 export 尚未实现，不当作完整默认入口。

第十三批最终定向验证：47 文件 / 258 单元测试通过；CUA/browser-runtime 独立构建、单独/合并/配置会话的编译断言与 browser-runtime、Sky→CUA 集成编译检查通过；vendor 和 packages/back 均 baseline matches，OpenSpec strict valid。新增 13 项测试含 11 项原包受控对照与 2 项本期 macOS/loader 控制验证。未运行仓库全量验证、未提交、未切换生产依赖；18.4、17.4、10.6、10.5、13.6、14.6 及 schema/SDK 版本锁定和真实验收仍未完成。平台缺口文档已补配置装配拒绝规则。

## 19. 依赖安装与独立产物第十四批

- [x] 19.1 四个候选包声明产物文件清单，验证构建、exports 与资源在独立解包后可加载，归档排除源码、测试和基准包。
- [x] 19.2 使用仓库指定 pnpm 12.4.1 安装并锁定 Statsig 3.32.6，验证真实 SDK/原 SDK 离线对照与 Sky 独立产物离线安装、冻结锁文件重装。
- [x] 19.3 补安装来源 browser 哈希与依赖查证结果；schema 确切版本继续由 14.5 跟踪，不能猜测版本。

第十四批（执行型）：四个产物测试先因源码/夹具被收录而 RED，添加 files 清单后 GREEN。新增三个真实 SDK 集成测试与四个产物测试；离线 SDK 禁止网络，独立产物在临时目录安装依赖，不借用工作区 SDK。此前认为多文档锁文件异常的判断修正：这是 pnpm 12 的环境/项目双文档格式；shell pnpm 6.32.11 与项目 packageManager 不匹配，改用 corepack pnpm 12.4.1。根锁文件仅添加候选 importer 和明确的 SDK 解析条目，既有解析未改。生产依赖未切换；schema、默认完整入口及真实 macOS 操作验收仍未完成。

第十四批最终定向验证：49 文件 / 265 单元测试通过；四个候选包在产物测试内独立构建并解包验证。CUA/browser-runtime 编译断言、Sky→CUA 集成编译检查全部通过；vendor 与 packages/back 均 baseline matches；OpenSpec strict valid。新增 7 项测试覆盖产物隔离、实际 SDK 固定版本、原 SDK 离线对照与无宿主路径。未运行仓库全量检查、未提交、未切换生产依赖。9.6 完成，schema 精确版本、完整默认入口与真实 macOS 验收保持未完成。

## 20. Browser API 工厂第十五批（10.5 的装配拆分）

- [x] 20.1 重建内部 API 工厂，组合支持覆盖、视图、Agent 和传输；完整 Browser/Tab 类型与构造保持明确注入边界。
- [x] 20.2 验证原工厂行为、共享引用、返回代理、Tab 装饰、错误身份与初始化跨模块 RPC，补泛型编译断言。

第十五批（执行型）：缺失 api-factory 模块测试先 RED，再实现内部 BrowserApiFactory 后 GREEN；7 项原工厂对照与 1 项可信初始化→候选工厂/Agent/BrowserControls 的跨模块对照通过。编译发现 exactOptionalPropertyTypes 下显式 undefined 选项不兼容，以条件字段传递修复；编译断言保留泛型 Browser/Agent 返回。完整默认入口与 schema/capability/Browser/Tab 完成条件不变，10.5/13.6/14.6/18.4 保持未完成。

第十五批最终定向验证：19 文件 / 136 测试通过（browser-runtime 全部及 CUA browser/config 与独立产物关联测试）；四包构建与独立产物加载由 artifact 测试确认。Browser/CUA 编译断言通过，原 vendor 与 packages/back 均 baseline matches，OpenSpec strict valid。此次未重新执行其余候选包测试；此前第十四批 49 文件 / 265 测试的结果仅作为历史记录。未运行仓库全量检查、未提交、未切换生产依赖；新增工厂保持内部注入边界，不计完整默认运行时完成。

## 21. Browser/Tab 组合第十六批（13.6/14.6 的内部装配拆分）

- [x] 21.1 重建全部现有 Tab 子接口与 Browser tabs/user 集合组合，按原公共成员顺序和初始/动态标识契约验证。
- [x] 21.2 重建显式注入能力工厂的选择装配，验证未知项、重复构造顺序、metadata 和动态配置引用；具体 capability/schema 继续未完成。
- [x] 21.3 补候选工厂→Browser→Tab→Locator 的受控跨模块原包对照，以及 Browser/Tab→CUA AX 装饰的类型断言。

第十六批（执行型）：缺 composition 模块对照先 RED，内部 ComposedBrowser/ComposedTab 实现后 GREEN。10 项新增测试中 9 项原包对照、1 项自有注册注入边界测试。加强能力断言时发现原注册工厂固定 metadata，而非传入 description；纠正测试假设，保留原工厂行为。受控命令夹具改为实际 playwright_locator_count，避免无结果比较假阳性。具体能力工厂与第三方 schema 均未复制到候选源码；测试追加 oh/im 导出仅用于组合边界。13.6/14.6/10.5/18.4 保持未完成，不将内部组合当作完整默认入口。

第十六批最终定向验证：20 文件 / 146 测试通过（browser-runtime 全部、CUA browser/config 与产物关联测试）；四个候选包构建及解包验证通过；Browser/CUA 类型断言通过，vendor/backup 均 baseline matches，OpenSpec strict valid。新增 5 项组合类型赋值覆盖 tabs.get、claimTab、locator count、AX 与 CUA 装饰。未运行仓库全量检查、未提交、未切换依赖。内部组合与显式能力注册边界不代表具体能力/schema 或真实浏览器完成。

## 22. 旧版 CUA facade 第十七批（3.2 的模块拆分）

- [x] 22.1 重建原 cua.js 单例的初始化生命周期内部工厂，保留 public slots 初始 null、逐次绑定及 state 聚合。
- [x] 22.2 原模块对照重复/并发初始化、setup 失败、getter 部分绑定、detached 调用、provider 重读和 caller 修改引用；补精确泛型编译断言。

第十七批（执行型）：legacy-facade 缺模块先 RED，实现后 GREEN；9 项原包对照。原测试只替换浏览器 setup 和 sky 两处 import 装配，原状态聚合函数体保留。候选使用已有 discovery 实现，不引用 vendor。内部 factory 与旧版默认 cua 单例接线分开，3.2/7.5/10.6/18.4 等默认入口与真实验收任务保持未完成。

第十七批最终定向验证：14 文件 / 80 测试通过（CUA 全部、Sky service/computer 与独立产物关联测试）；四包构建和解包加载验证通过，CUA 泛型/会话断言与 Sky→CUA 集成编译通过；vendor 与 packages/back 均 baseline matches，OpenSpec strict valid。新增 4 项编译赋值验证 legacy computer/provider/documentation/state 精确返回类型。未运行仓库全量检查、未提交、未切换生产依赖。未重新执行其余候选范围测试，不把历史全候选测试数量当作本批结果。

## 23. 能力数据转换第十八批（14.6 的自有逻辑拆分）

- [x] 23.1 重建公开 WebMCP 描述转换与内部已验证工具快照，验证说明、别名、重复、超时、metadata、动态 context 和异常。
- [x] 23.2 重建 browserAuth 请求投影与本 Tab Locator 解析，验证字段/选项/QR/submit 和非法或跨作用域 selector。
- [x] 23.3 补转换结果和 snapshot call 的类型断言、来源说明；明确两个模块的后续 schema 必要性，不接入完整 capability 注册。

第十八批（执行型）：两模块先缺模块 RED→自主实现 GREEN；WebMCP 动态 capability context 增补测试再次 RED→保留 context 引用后 GREEN。8 项 WebMCP 与 7 项 auth 原包对照通过。仅 toWebMcpToolDescriptor 作为已有原接口公开导出；snapshot/请求投影为内部阶段。第三方 schema 确切版本、工具列表/请求完整验证、具体能力与默认入口仍未完成，14.5/14.6/13.6/10.5 保持未完成。

第十八批最终定向验证：22 文件 / 161 测试通过（browser-runtime 全部、CUA browser/config 与独立产物关联测试）；四个候选包构建/解包加载与真实 SDK 独立离线安装通过，Browser/CUA 编译断言通过，vendor/backup 均 baseline matches，OpenSpec strict valid。新增 5 项编译赋值覆盖 descriptor/schema/snapshot/call/auth selector。未运行仓库全量检查、未提交、未切换生产依赖。工具列表 schema 和 auth 请求完整 schema 验证尚未接入，不计完整 capability 实现。

## 24. CDP send 与访问顺序第十九批（14.6 的拆分）

- [x] 24.1 重建内部 CDP send 的 toJSON 发送契约与 unknown 结果透传，验证参数/target/timeout、public scope/transport、引用与失败；完整命令类/事件 schema 保持未完成。
- [x] 24.2 对照 target 单次读取和 transport.send accessor 顺序，修正 CDP 与 WebMCP 快照的 getter 回归，并补类型断言与来源证据。
- [x] 24.3 审计其余通用 dispatch/send 调用点的 transport accessor、scope/参数读取顺序，补原包回归与必要修复；不以已有正常数据测试代替。

第十九批（执行型）：CDP 缺模块先 RED→实现 GREEN；target accessor 回归先 RED（多读 2 次）→normalizeTarget 接收单次求值 GREEN；transport.send getter 回归 RED（scope 在 getter 前捕获）→直接按原求值顺序发送 GREEN。相同 WebMCP 问题独立复现 RED→GREEN。8 项 CDP 原包对照和 1 项 WebMCP 新回归通过。其余类似 helper 调用点必须由 24.3 审计；14.5/14.6/13.6/10.5/18.4 保持未完成。

第十九批最终定向验证：23 文件 / 170 测试通过（browser-runtime 全部、CUA browser/config 与独立产物关联测试）；四个候选包构建/解包加载通过，Browser/CUA 编译断言通过，vendor/backup 均 baseline matches，OpenSpec strict valid。新增 4 项 CDP 编译赋值与 9 项测试（8 CDP、1 WebMCP）。未运行仓库全量检查、未提交、未切换生产依赖。24.3 的其余 dispatch/accessor 路径审计尚未完成；readEvents、完整命令类/schema 及实际服务验收仍未完成。

访问顺序审计：通用 dispatch/send 延迟构造参数，保留 transport.send accessor 先求值；截图、坐标校验、AX 动作、历史查询与日志预处理仍保留各自原始提前捕获步骤。41 项原包回归通过；此前31项全部RED，逐路径修复后GREEN，额外覆盖截图/序列化/AX/Clipboard/Dev/history。browser范围21文件182测试通过后补5项回归，新增41项独立审计通过；不算schema验证或完整默认入口完成。

## 25. 原生命令容器（10.5 的schema独立部分）

- [x] 25.1 自主实现 AtlasCommand 的显式 parse 与 toJSON 生命周期，原包验证可变字段、原始payload、getter与错误身份；补泛型类型检查。

25.1: missing-module RED to 8 original comparisons GREEN, build and generic type assertions pass.

## 26. macOS public types

- [x] 26.1 Reconstruct all macOS Window operation, observation and audio types plus Direction/MouseButton/Point/Client/Options; compile original bidirectional compatibility and invalid inputs. Other platforms remain deferred.

## 27. Structured schemas, concrete capabilities and default client

- [x] 27.1 Define CDP/bot/content/context schemas with upstream Zod; compare valid/invalid payloads and structured responses.
- [x] 27.2 Complete CDP readEvents, tabs.content and user.getTabContext; preserve timeout padding, empty content validation, original raw content results and document decoding.
- [x] 27.3 Implement auth/assets/WebMCP schema and concrete tab capabilities, browser management/visibility/viewport schemas and capabilities; compare result errors and proxy behavior.
- [x] 27.4 Assemble concrete default capability registrations and Browser/Tab composition, retaining explicit registry overrides.
- [x] 27.5 Inventory all 82 schema commands plus AtlasCommand, materialize declarative Zod definitions from public contracts and handwritten custom refinements; verify 83 original schema/serialization tests. Candidate runtime does not read inventory or legacy implementation.
- [x] 27.6 Implement default trusted-host setupBrowserRuntime using candidate factory and all candidate API classes; 3 setup/filtering/failure tests RED to GREEN and build pass.
- [x] 27.7 Validate independent browser artifact offline dependency installation and frozen lockfile reload; expand schema edge coverage, compile assertions, source maps and dependency evidence.

Current verification: browser 29 files/328 tests passed before 3 additional default-runtime tests, which passed separately. Type assertion surfaced WebMCP unknown input-schema optionality, corrected to match upstream parsed contract. Original node_id custom errors initially differed in 3 contract tests; recorded schema custom error messages and all83 passed. No production switching or real-service acceptance claimed; service backend reconstruction remains pending.
27.7 后续完成证据：独立浏览器包定向打包测试在外部目录离线安装并冻结重装，验证 Zod、Statsig、Sentry、classic-level、Playwright 和固定的 QR WASM；新增打包 JS/声明 source maps，内嵌自有 TS 源供定位，打包测试先 RED 后 GREEN。全部命令 schema 逐字段边界 165 测试通过，`tsconfig.type-tests.json` 的跨包编译断言通过。仓库根安装仍受既有 classic-level 构建策略影响，不将其误报为通过。

## 28. Default CUA package wiring

- [x] 28.1 Implement candidate-only macOS/browser loaders and tinysky-alt automatic global entry; preserve enabled surfaces and shared lifecycle.
- [x] 28.2 Wire original legacy cua public singleton to candidate Sky/browser initialization with portable declarations.
- [x] 28.3 Validate packed CUA plus packed Sky/browser dependencies outside workspace, offline install/frozen reinstall and automatic global/default facade initialization.

28 verification: 2 default loader tests RED to GREEN; isolated artifact missing cross-package dependency RED to GREEN. Use pnpm12 pack to normalize workspace dependencies; pnpm12 overrides configured in temporary pnpm-workspace.yaml (package.json overrides ignored by pnpm12). Temporary package dependency archives supply private packages; SDK/Zod install offline. No source workspace or vendor fallback. Not real backend acceptance.

## 29. Browser service configuration and remaining backend modules

- [x] 29.1 Reconstruct configuration snapshots, shared mutation serialization, refresh/generation/error behavior and session-id checks with original service comparisons.
- [ ] 29.2 Complete service context/native browser discovery and all command handlers, documentation gating/security/resource lifecycle; wire ./service only after concrete backend exists.

29.1 verification: Service config snapshot and shared mutation lifecycle reconstructed; 7 original comparisons including older success/failure race and write-refresh failure pass.
- [x] 29.3 Reconstruct BrowserDocumentation/API rendering/guidance filtering and required-doc gate; actual embedded default resources extracted as data, 12 browser/environment combinations and required-read errors compared.

## 30. Approved declaration-only helpers

- [x] 30.1 Implement debounce/lazy/sleep/enumerate/invariant contracts with unit and type tests; label no original runtime comparison.
- [x] 30.2 Implement typed env reader and unimplemented Error factory with normalization/cache/policy/error/help tests; label project-defined text.

30 verification: missing modules RED to 7 CUA + 9 Sky contract tests GREEN; builds pass. These are user-approved autonomous contracts with no original runtime comparison. Public type checks cover inference, readonly/awaited enumeration and illegal arguments/default values.

## 31. Native browser service foundations (29.2 split; backend wiring remains pending)

- [x] 31.1 Reconstruct browser selection and turn-ended callback lifecycle; compare aliases, URL match tiers, failure tolerance and cleanup.
- [x] 31.2 Reconstruct coalesced BrowserContext discovery, close tracking and disposal with original assembly boundary tests.
- [x] 31.3 Reconstruct bidirectional browser JSON-RPC and native framed message transport; compare ordering, errors, framing and close semantics.
- [x] 31.4 Reconstruct session browser backend API, request metadata/header lifecycle, cached expressions and committed URL fallback.
- [x] 31.5 Complete native discovery policy, profile enrichment, diagnostics and default context assembly; default factory uses concrete framed transport/session API, while full command service remains pending under29.2.

31 verification: modules missing/export absent RED to 14 selection +3 context +4 RPC +5 native-pipe +9 session +6 discovery tests GREEN. An Arc alias assumption failed an added original regression; fixed to exact original Chrome/Edge/Brave aliases. Discovery type check exposed incomplete backend boundary typing; corrected and build passes. No ./service placeholder or legacy fallback added.
- [x] 31.6 Reconstruct macOS browser profiles and instance identification with exact classic-level3.0.0; verify real database copy/read/cleanup and isolated offline install.
- [x] 31.7 Reconstruct packaged documentation readers, environment aliases/overrides and cloud AX guidance rewriting; validate baseline data and explicit resource roots, record resource provenance.

31.6/31.7 verification: 4 profile +4 resource tests pass; package artifact isolated offline install/frozen reload and actual LevelDB roundtrip pass. Some cloud/orbit documents are absent in baseline resources; tests compare original missing-doc errors, no fabricated documents supplied. Candidate improves cleanup of temporary database copies on pre-open failures; supported reads remain baseline-matched. Native service assembly/handlers/security remains pending.

## 32. Browser service permissions and global handlers

- [x] 32.1 Reconstruct strict origin/domain patterns, enterprise/network policy combination, duplicate handling and unavailable fail-closed behavior with baseline matrices.
- [x] 32.2 Reconstruct full-CDP/WebMCP/history/auto-review feature and policy access checks, preserving baseline defaults and reasons.
- [x] 32.3 Reconstruct all six global discovery/documentation handlers and browser description/capability projection.
- [x] 32.4 Reconstruct guardian origin approval cache with expiry, shared concurrent review, revocation and recovery.
- [x] 32.5 Complete persisted/conversation/turn permission decisions and prompt-result persistence; integrate full preferences with security checks.

32.5 后续完成证据：`service-permission-state.ts` 与 `service-preferences.ts` 的全局/会话/turn 决策和 prompt 持久化已接入 `BrowserBackend`、审批门及命令安全；原包差分覆盖优先级、过期、撤销、企业约束、未知资源拒绝和 reviewer 类型。定向 4 文件 35 测试通过。自动认证安全审查仍是独立的 53.4 缺口，本项权限持久化通过不开放它。

32 verification: 5 network-policy +4 access-policy +6 global-handler +4 guardian-cache tests pass. Malformed configuration handling initially differed (silently allowed); regression RED fixed to original unavailable outcome GREEN. Broader browser scope before guardian addition:43files404tests passed; latest build including guardian passes. Type checking found explicit-undefined API override compatibility; internal documentation/view input types now allow explicit undefined as baseline projects. No service entry or acceptance claim.

Expanded original registry review revealed Opera/Vivaldi in addition to Chrome/Edge/Brave. Both missing families first failed selection/profile tests, then corrected; Arc remains a literal id, not an alias. Previous abbreviated family note should not be interpreted as full registry coverage.
- [x] 32.6 Complete persisted/conversation/turn decisions and prompt-result state; preserve fresh guardian snapshots and enterprise lifetimes, compare concurrent origin review/revocation.
- [x] 32.7 Reconstruct all security reason errors, audit isolation and elicitation result validation; match precise failure/retry semantics.
- [x] 32.8 Reconstruct origin/history/file/CDP/page-asset/WebMCP permission gates and their request metadata; validate concurrent review and revocation.

32.6-32.8: 10 permission,4 error,10 gate tests pass/buildpass. Additional malformed history config and skipped cross-origin audit regressions first RED, then fixed GREEN; access-policy now5tests. Concrete command security orchestration, site-status/navigation policy and service assembly remain pending; 32.5 retains pending integration.

## 33. Browser service command security and credential lifecycle

- [x] 33.1 Reconstruct site-status request/cache/background behavior, preserving original fail-open service-unavailable behavior and explicit-block denial.
- [x] 33.2 Reconstruct command scope, navigation queue, active operation accounting and file/CDP/asset/origin command authorization.
- [x] 33.3 Reconstruct automated safety prechecks with trusted runtime snapshots, strict guardian reviewer identity and review-duration auditing.
- [x] 33.4 Reconstruct credential command orchestration, serialized handoff and document credential isolation, broker status checks and stale observation rejection.
- [x] 33.5 Reconstruct per-session tab acquisition/creation/reclaim events.
- [ ] 33.6 Integrate these concrete safety components into the full browser command backend and service entry; run real macOS acceptance after remaining command modules are complete.

33 verification: 5 site-status,4 command-policy,4 command-security,5 safety-precheck,4 credential-command,8 credential-state and2 tab-lifecycle tests pass; browser build passes. Missing modules first RED, then GREEN. Missing review-duration audit regression RED corrected to original measured-duration metadata GREEN. Site status service failures are fail-open in the original and retained; permission and credential checks fail closed. Candidate runtime does not read original service code; original comparisons replace only explicit host/state initialization boundaries. Service entry and real acceptance remain pending.

## 34. Browser CDP and download execution foundations

- [x] 34.1 Reconstruct service tabs, mouse UI and console/exception collection, preserving credential diagnostic filtering.
- [x] 34.2 Reconstruct coalesced CDP attachments, dispatch/deadlines/cached expressions and one-shot top-level debugger retry.
- [x] 34.3 Reconstruct nested frame ownership, alias mapping, initialization, event updates and target cleanup.
- [x] 34.4 Reconstruct raw event cursor/eviction/filter/long-poll, JavaScript dialogs, internal screencast isolation and concrete CDP event wiring.
- [x] 34.5 Reconstruct service-worker starts/bypass leases and backend native-credential new-target protection; include event/page-load waits and sanitized navigation errors.
- [x] 34.6 Reconstruct document response ownership/request interception, proxy site instructions and download approval/completion/timeout cleanup.
- [ ] 34.7 Integrate default diagnostics reporter and verify concrete service assembly, document/locator/action/assets handlers, plus real backend acceptance; these subsystem tests do not establish full service completion.

34 verification: Current new browser scope17files76tests passes (includes33); browser build passes. Missing modules/methods RED->GREEN. Explicit timeout diagnostic regression RED->GREEN preserves full-method redaction. Attachment-focused comparisons remove original unrelated constructor handlers to isolate the subsystem; full BrowserCdp comparison leaves original constructor initialization intact. Candidate subclasses provide concrete page/frame/dialog lifecycle; final command backend assembly remains incomplete. No production replacement.

## 35. User content and page clipboard bridge

- [x] 35.1 Reconstruct user tab context/page identity checks, trusted PDF capture, Google Workspace export fallback and YouTube selection/transcript composition.
- [x] 35.2 Reconstruct virtual navigator clipboard methods, Blob serialization, receiver checks, pending request cancellation and original object restoration.
- [x] 35.3 Reconstruct clipboard state cloning/validation/exclusive operation recovery and CDP bridge install/reinstall/binding/cleanup lifecycle.
- [ ] 35.4 Wire content and clipboard handlers into full service context; add real browser acceptance once remaining command modules are implemented.

35 verification:4 user-content +3 page-clipboard +4 bridge/state original comparison tests pass; TypeScript build passes. Page bridge tests run real serialized functions in isolated browser-like VM environments and exchange real Blob data; service bridge executes injected source and event roundtrips in those realms. This proves unit behavior, not real browser backend acceptance. Runtime imports no original first-party implementation.

## 36. Page asset discovery and download bundles

- [x] 36.1 Reconstruct DOMSnapshot/resource asset merging, SVG discovery, classification, names and stable hashes.
- [x] 36.2 Reconstruct inventories bound to page identity, approved resource fetches, inline SVG files, fallback origin approval, manifests and denial cleanup.
- [ ] 36.3 Wire default diagnostic reporting and concrete service asset handlers, then verify real browser backend behavior.

36 verification:3 asset-discovery +3 page-assets original comparison tests passed. Actual temporary files, bytes, SVG and manifests checked; explicit denied fallback removes its temporary directory. Candidate runtime does not import baseline code. Default telemetry reporter and final service wiring remain pending.

## 37. macOS keyboard, mouse and DOM CUA input

- [x] 37.1 Reconstruct mouse click/drag/scroll dispatch and cleanup, closed shadow mouse and keyboard focus guards.
- [x] 37.2 Reconstruct macOS keyboard dispatch, modifier/chord/alias mapping, Unicode, native clipboard shortcut restrictions and guarded modifier release.
- [x] 37.3 Reconstruct DOM snapshot reference ownership, isolated world caching/retry, visible point clipping, iframe input/top-level coordinate transforms and cleanup.
- [x] 37.4 Reconstruct concrete CUA input wrapper, DOM click/scroll and keypress, and verify native session/CDP/tabs/UI structural type wiring.
- [ ] 37.5 Integrate visible DOM snapshot production and complete command handlers; real browser acceptance remains required.

37 verification:4 mouse +5 input-guard +4 keyboard +3 DOM-state +2 CUA-input tests pass, including original comparisons. Keyboard tests traverse all210 keys,88 aliases and9 chords; packed browser artifact reads its own210-key data and dispatches selectAll offline. Data extraction and source hash tracked in browser-keyboard-provenance.json; runtime has no baseline imports. DOM tests execute serialized page functions in VM realms, not real browser acceptance. Structural type regression initially failed because native API tab IDs were declared strings; corrected numeric native tab results and number/string input compatibility, preserving wire behavior. Browser build and type tests pass. Linux/Windows keyboard command maps and execution are omitted; other platform dispatch explicitly rejects.

## 38. File chooser command handlers

- [x] 38.1 Reconstruct chooser event/interception lifecycle, target ownership, multiple-file validation, upload permission, input dispatch and extension access error guidance.
- [ ] 38.2 Integrate file chooser handlers into full command backend and validate real macOS upload fixtures.

38 verification:2 original comparison tests pass over normal, nested/wrong tab, empty/multiple file, denied native file access and dispatch failures. Choosers are consumed only after successful authorized dispatch and interception always disabled. Browser build passes. Full backend wiring remains pending.

## 39. Page wait and tab interaction command handlers

- [x] 39.1 Reconstruct load/DOMContentLoaded/network-idle and URL waits, including document identity, timeout, navigation denial and listener cleanup.
- [x] 39.2 Reconstruct tab create/get/list/close/mark/selected/name and back/forward/reload handlers with lifecycle recording and credential redaction.
- [x] 39.3 Reconstruct virtual clipboard read/write and JavaScript dialog command validation, close-frame matching and cancellation.
- [ ] 39.4 Integrate these handlers into complete service registry and real backend acceptance; safe navigate-to-URL restoration remains pending separately.

39 verification:3 page-wait +2 tab-command +2 interaction-command original comparison tests pass. Missing modules RED->GREEN; missing readyState declaration reproduced with compiler then corrected. Network-idle timeout tested with actual bounded timer. Full navigate_tab_url authorization/history restoration and command registry are not completed by these handlers.

## 40. Browser telemetry and SDK adapters

- [x] 40.1 Reconstruct command duration excluding approvals and locator retry outcome accounting using scoped async state.
- [x] 40.2 Reconstruct performance spans/command descriptors, primitive attribute filtering, result character counts, error status and trusted telemetry delegation.
- [x] 40.3 Pin embedded browser Statsig3.33.1, reconstruct initialization/identity/backend/events/gates and fail-closed request-header checks; validate actual SDK offline in packed artifact.
- [x] 40.4 Pin embedded Sentry/node10.48.0 and reconstruct captured trusted fetch transport, privacy defaults, user/tag/error facade and ambient-network-disabled initialization.
- [x] 40.5 Integrate default reporter and Statsig lifecycle into trusted runtime/service/discovery; validate packed Sentry API and runtime cleanup before acceptance.

40.5 后续证据：可信 host 捕获并连接 reporter、Statsig 和安全审计，`service.ts` 在释放旧实例前启动新 invocation 遥测，runtime 对一次性标记去重并在 dispose 时清理服务钩子。原包时序/字段与 SDK 适配定向 4 文件 15 测试通过；浏览器打包测试已在独立离线安装中验证 Sentry 实际 envelope/flush/close 和固定 Statsig SDK。真实宿主的完整页面调用仍由 43.3/4.2 验收，不作为 40.5 的伪证据。

40 verification:2 timing+2 span+3 Statsig+2 reporter tests pass/browser build passes; browser artifact offline/frozen install and realStatsig3.33.1 offline initialization/identity/shutdown passed. Original SDK leaves alone replaced only at explicit test SDK boundaries; no SDK implementation rewritten. Original source explicitly states3.33.1 and10.48.0. pnpm initially flagged ignored ClassicLevel builds, completed with --ignore-scripts; packed real ClassicLevel roundtrip remains covered. Default trusted runtime assembly and shutdown still pending.

## 41. Caller identity and native context defaults

- [x] 41.1 Reconstruct verified Aura caller identity caching, ambient-network disable, backend/user SDK metadata and identity barrier for controlled request headers.
- [x] 41.2 Complete discovery default profile enrichment/Statsig AX gates/host diagnostics and failure phase/count metadata.
- [x] 41.3 Assemble concrete native context with captured privileged socket bridge, framed transport, SessionBrowserApi, turn metadata/tracker and identity-guarded header policy.
- [x] 41.4 Wire trusted runtime initialization and command backend; native socket fixtures are not real browser acceptance.

41.4 后续证据：`service-host-initialization.ts`、`service-native-runtime.ts`、`service-command-dispatch.ts` 与真实 `BrowserBackend` 默认装配已接线，默认服务测试穿过命令注册/文档/凭据与安全门并验证资源释放；定向 4 文件 23 测试通过。隔离 macOS 宿主只证明 browser 候选服务加载，缺真实 turn metadata 的 nativePipe 页面路径仍由 4.2/43.3/53.5 跟踪。

41 verification:2 telemetry+9 discovery+3 native context tests pass/build passes; earlier3 context+4 profile+3 Statsig comparisons also pass. Diagnostics pre-filter count regression first RED then GREEN. Native context fixture executes actual frame encoding/decoding and real session API, verifies reuse/dispose/turn-end and denies missing identity before command wire dispatch. No production ./service export yet.

## 42. Native authentication broker protocol

- [x] 42.1 Reconstruct broker challenge registration, submission field/delivery validation, completion statuses, QR publishing, failure and idempotent cleanup.
- [x] 42.2 Reconstruct native credential observation status protocol, exact response shape, single-response1024-byte frame limit and bounded timeout.
- [ ] 42.3 Integrate broker into trusted GAAS host initialization and full authentication handlers; actual secure authentication acceptance remains pending.

42 verification:5 broker tests pass (4 original comparisons plus actual default framed connector fixture); browser build and5 native pipe comparisons pass. Pipe sendMessage input type broadened to unknown to reflect original generic JSON transport and permit non-JSON-RPC broker messages; wire encoding unchanged. Server-close/default connector cleanup is asynchronous and verified after settling, not mistaken for synchronous completion.

40 packed follow-up: actual Sentry10.48.0 capture generates SDK envelope through captured test host fetch, flushes and closes. Offline/frozen artifact succeeds. SDK transitive Node types were resolving '*' against newer cached registry metadata; artifact fixture now uses repository's pinned24.10.1 type toolchain, documented explicitly. pnpm-generated invalid ClassicLevel allowBuilds placeholder removed; scripts remain ignored and production approval policy unchanged.

## 43. Trusted host initialization

- [x] 43.1 Reconstruct privileged host capture, live request metadata, bound elicitation metadata normalization, GAAS config and broker callbacks/session binding.
- [x] 43.2 Assemble macOS configuration/preferences, native context, error reporting, timing, spans and filesystem; validate WASM paths and release safety/context on disposal.
- [ ] 43.3 Complete command backend integration, initialize telemetry at original service lifecycle point and validate actual privileged macOS host.

43 verification:5 host tests pass,2 original comparisons plus fail-closed binding/platform/WASM/disposal and captured reporter identity-error routing. Related7files29tests pass. Browser build passed after correcting explicit undefined metadata types for live getters, preserving original returned fields. Trusted native context is assembled; complete command service entry and real browser acceptance remain pending. Production loader unchanged.

## 44. Authorized URL navigation and history restoration

- [x] 44.1 Reconstruct navigation event matching, concurrent approval, tab/session/document race guards, redacted errors and guarded credential document permits.
- [x] 44.2 Reconstruct bounded authorized history restoration and auth-owned document coordination/cleanup.
- [ ] 44.3 Wire URL navigation and authentication-owned documents into complete backend and validate actual macOS browser restoration.

44 verification:3 navigation tests pass (2 original comparison scenarios across7 navigation modes and real bounded timeout plus auth document coordination); related3files8tests and browser build pass. Original errors compared after correct security reason fixture. No production switch or real browser claim.

## 45. Visible DOM snapshot production

- [x] 45.1 Reconstruct serialized visible DOM traversal, stable local refs, form credential redaction, reviewer mode, open shadows, attributes, viewport and output limits.
- [x] 45.2 Reconstruct cross-frame snapshot assembly, stable public refs shared with CUA input, bounded child traversal, privileged frame priority, clipping, target fallback and isolated-world object cleanup.
- [ ] 45.3 Wire visible DOM and reviewer capture into complete backend/auth handlers and validate real macOS DOM fixtures.

45 verification:2 page-program comparisons execute in independent JSDOM realms;2 frame assembly comparisons cover8 reviewer/child-failure/priority combinations and invalid/main evaluation errors. Related4files9tests and browser build pass. Fixture originally failed because original module retains isolated-world caches across separate simulations; now uses actual registered tab cleanup between cases rather than discarding trace differences. Serialized code executes without source imports; JSDOM is not real browser acceptance.

## 46. Screenshot capture

- [x] 46.1 Reconstruct CSS/device scale, crop/full-page capture, actual fresh screencast selection, stale frame acknowledgments, capture fallback and credential observation wrapper.
- [ ] 46.2 Wire screenshot command and response metadata into complete backend and validate real macOS captures.

46 verification:2 original comparisons across32 crop/full-page/scaling/fallback/invalid combinations plus2 stale-frame success/failure modes. Related3files16tests and browser build pass. Capture options, screenshot errors, screencast stop/ack and credential gate trace compared. SDK/DOM/native mocks are not real image acceptance.

## 47. Response metadata and security audit telemetry

- [x] 47.1 Reconstruct browser/tool response metadata field selection, URL sanitation, controlled-tab/screenshot collection and credential observation suppression.
- [x] 47.2 Reconstruct security audit decision/source/permission fields, cached/cancelled overrides and background/builtin success suppression.
- [ ] 47.3 Wire response metadata and security audit into full service command lifecycle and actual macOS acceptance.

47 verification:2 response metadata+1 audit original comparisons pass (8 tab/backend/failure/credential combinations; audit matrix covers13 checks,7 outcomes,16 sources,5 overrides). Related host/metadata/audit3files8tests and browser build pass. Original telemetry SDK leaf replaced while both own/original metadata managers run; candidate calls its real BrowserTelemetry adapter in fixture. Reporter receiver regression first RED then fixed by bound callback. Runtime/source metadata sanitation does not replace secure authentication integration.

## 48. Playwright dependency and execution foundations

- [x] 48.1 Identify exact upstream injected helper by whole-source comparison, pin Playwright-core1.59.0, isolate own sensitive-value patch and verify original selector/ARIA behavior.
- [x] 48.2 Reconstruct selector deadlines, retry timing/outcomes, strict/missing/context errors and frame/target helper functions.
- [x] 48.3 Reconstruct helper installation, bounded frame-world cache, target/frame invalidation, deadline guard and one-time missing-helper/context recovery.
- [x] 48.4 Reconstruct same-origin/OOPIF selector routing, node binding, reads and pointer/input operations, then integrate full Playwright service handlers.

48 verification: verify-playwright-injected-provenance.mjs confirms Playwright1.59.0 normalized with esbuild0.28.2 equals full original injected source after removing only521-character own credential redaction insertion; JSON records source hashes.2 injected/helper tests execute actual pinned upstream and original helper in DOM realms,2 policy +3 world tests pass/build pass. Third-party code is loaded from fixed dependency, own patch fails on missing/ambiguous point. World comparisons traverse8 recovery modes and cache limits. JSDOM lacks pseudo-style support; fixture queries ordinary computed style because it contains no generated pseudo-content. No real browser acceptance claim.

48 packed follow-up: browser private artifact offline installation/frozen lockfile and actual patched injected helper export pass. Selector policy coverage expanded to3 tests; same-origin scope helpers2 original comparisons cover4 visibility/strict modes plus invalid/inaccessible frame errors and geometry transforms. Full selectors/OOPIF/actions remain pending48.4.

48.4 后续完成证据：`service-playwright-selectors.ts`、`service-playwright-input.ts` 和完整 `service-playwright-commands.ts` 已经接到 75 项命令注册表；同源/OOPIF 路由、节点绑定、真实 DOM 读取和指针输入的定向 4 文件 22 项通过。49.4/50.4/4.2 仍要求完整服务/真实 macOS 页面验收，本项的受控 DOM 测试不替代实机。

## 49. Playwright selector and node service layer

- [x] 49.1 Reconstruct same-origin serialized selector scopes, strict/visible fallback, frame capture and pointer geometry.
- [x] 49.2 Reconstruct cross-process frame routing/attachment, unique URL/name fallback, isolated-world routing and bounded handle cleanup.
- [x] 49.3 Reconstruct node resolution/binding, bound-selector evaluation, page/single/all reads, distinct selectors, readonly selector preparation and frame identities.
- [ ] 49.4 Complete pointer/focus/fill/sequential/select/checked operations and full command backend integration; real macOS acceptance remains required.

49 verification:2 scope +4 selector original comparisons pass; selectors cover8 OOPIF/missing-frame-ID/isolated combinations, bound callback failure, actual serialized page/all/readonly/node reads and actual IAB frame metadata program. Related5files14tests pass. Fixture route detection originally incorrectly recognized helper declarations as route requests; corrected specific route parse marker while preserving all CDP call traces. Type build and compile checks run; no full-project tests or commit. macOS 真实 Chromium 页面层的复制版/候选版 count、enabled、click、fill 与一次 DOM input 事件对照通过，见 `analysis/codex-cua/real-macos-playwright-acceptance.md`；仍未通过 App 特权 nativePipe/完整服务，因此 49.4 保持未完成。

## 50. Playwright 页面输入与指针动作

- [x] 50.1 还原选择器及无障碍节点聚焦、填充准备、连续输入令牌和 checked/element 状态读取。
- [x] 50.2 还原稳定边界等待、滚动对齐、遮挡重试、force、macOS 修饰键和原生点击目标传递。
- [x] 50.3 还原 OOPIF 坐标重算、frame owner 命中检查和遮挡元素描述，并执行原包对照。
- [ ] 50.4 完成连续输入、虚拟剪贴板填充/按键、下载和只读命令处理器，再接入完整服务及 macOS 实机验证。

50 验证：5 项原包对照测试通过；实际页面函数验证焦点/选区/日期填充/令牌/状态，8 种点击组合与12 种 OOPIF 坐标和遮挡组合。补充无障碍节点句柄释放及禁用填充错误路径。属性函数误命名导致遮挡描述失败，测试先失败再修正；导出 FrameLink 保证声明生成。JSDOM 与 CDP 边界 fixture 不等于实机验收。

## 51. Playwright 命令处理器与虚拟剪贴板

- [x] 51.1 还原点击/双击、计数、可见与可用、文本/属性/相对读取、选择、勾选和等待命令。
- [x] 51.2 还原连续输入逐字符焦点令牌校验、Unicode 原生派发及所有退出路径清理。
- [x] 51.3 还原粘贴页面函数、CDP 运行包装、fill 对日期/文本的区分以及下载路径、等待、媒体下载命令。
- [x] 51.4 还原普通按键及虚拟剪贴板快捷键、copy/cut 延迟提交、同进程与 OOPIF 焦点目标路由。
- [x] 51.5 实现只读求值及全部命令接入完整服务；实机 macOS 验收未完成。

51 补充：ARIA 快照递归/根页面与 iframe 真实序列化测试、普通按键/虚拟快捷键和焦点 frame 路由、copy/cut 选择区与凭据防护通过。6 个相关测试文件共 27 项通过，browser-runtime 构建通过。

51 验证：命令处理器 6 项原包对照，覆盖 13 个基础定位器命令、连续输入四种退出路径、fill 的输入类型/replace 组合、下载超时和媒体 iframe 范围；粘贴页面与 CDP 包装 2 项原包对照。补上成功路径断言，避免双方共同失败造成虚假通过。媒体下载毫秒级剩余时间仅比较范围与调用顺序。命令仍未在完整服务入口注册。

51.5 后续完成证据：只读求值、全部 Playwright 命令注册与默认 native runtime/dispatcher 的受控装配已实现；只读求值、Playwright 命令、75 项注册和默认运行时定向 4 文件 24 项通过。真实 macOS 候选浏览器服务页操作仍未通过，继续由 4.2/49.4/50.4/52.3/53.5 跟踪。

## 52. 只读 Playwright 求值与 DOM 防护

- [x] 52.1 将原包一方可读的只读 DOM 防护层恢复为独立自有源码，保留不可变包装、凭据值隐藏、异步返回值边界和动态导入拦截。
- [x] 52.2 实现页面、单节点和全部匹配节点的隔离世界求值，辅助程序安装、绑定与清理，并与原包在实际页面环境对照。
- [ ] 52.3 补齐上下文失效重试、严格选择器失败和异常对象释放差异用例；将只读求值加入完整命令服务与 macOS 实机验收。

52 验证：防护层3项、求值命令6项定向测试通过；覆盖凭据属性、DOM 写入阻止、选择器多元素、动态导入、序列化限制、严格选择器立即失败、上下文销毁后重建与异常对象释放。完整防护层为原包自有 JS 的可读源码复原，运行时代码不导入 vendor/backup；保护字段判断和第三方 Playwright 注入由自有适配器与固定依赖提供。52.3 的真实 macOS 候选服务验收仍未通过。

## 53. 服务命令覆盖与调度装配

- [x] 53.1 接入只读求值、页面等待与文件选择器命令，原包对照上下文失效、临时对象清理、等待错误与文件选择器授权顺序。
- [x] 53.2 重建 BrowserUser/历史/开发日志/页面资源命令、WebMCP 页面发现与调用、完整 CDP 命令、内容导出及导航/截图/交接/机器人报告命令的独立处理器，并运行对应定向差异测试。
- [x] 53.3 组合具体命令注册表，核对原 vf 的 75 个命令、拒绝重复与非原包命令；未实现项保持可见。
- [ ] 53.4 还原 `cua_type`、`dom_cua_type` 的富文本路径和完整 `tab_browser_auth_handoff` 主处理器，补原包对照并达到 75/75 具体命令覆盖。
- [ ] 53.5 将所有已实现处理器接入可信服务运行时，验证文档、凭据观察门、安全审批、WebMCP 注册名预检、关闭/重置和响应元数据的完整原包差异与 macOS 实机路径。

可信宿主补证：隔离 Rust/Node REPL 下将 browser 分别映射到字节等同复制版的 App `@oai/cua` 服务及候选服务，完整 setup manifest/禁用成员数组相等；两者浏览器发现均在真实 turn metadata 缺失处拒绝。脚本 `analysis/codex-cua/verify-macos-browser-service-boundary.py` 可复现且清理暂存。此证据不含 nativePipe/页面操作，53.5 仍未完成；当前插件正式映射的 `@oai/browser-desktop/service` 与复制版服务不是同一 bundle。

53 阶段证据：候选注册表已有 75/75 个原始命令名；两个 type 命令的纯文本和富文本路径已对照。`markdown-it@14.1.1` 由原 bundle 的 linkify 逐字符回退指纹与 14.1.x 渲染边界确定；14 个富文本样本、剪贴板 payload/flag、可编辑 DOM HTML 插入及离线打包实测通过。认证主处理器现接入普通表单、ordinary v10、private v8 HMAC 文档 permit 和隔离表单提交、native 凭据交付、OTP 分段/自动提交检测、`press_enter`、无字段 selector 选项以及 native+manual 混合保护顺序；GK/KK/jy/Uy 与其他请求/绑定/broker 边界有原包差分。跨域可信 iframe 的 d_/XK 信任规则、嵌套 frame 链和提示元数据已做原包差分并接线，未知/不可信链继续拒绝。QR 路径已固定 `zxing-wasm@3.1.2`，npm reader WASM 与原包内置文件 SHA-256 完全相同；真实 QR 图片对原包 zV 差分通过，并接在 BarcodeDetector fallback 前。复制版 tk 在四种环境读取缺失的内置安全说明时均 fail-closed，候选现对齐错误类型、原因、消息及底层原因，并保证先于截图/reviewer/凭据提示；对应定向 3 文件/19 测试及 browser 类型检查通过。53.4 仍未完成：自动安全审查 tk checkpoint 的可运行路径与真实 native pipe 认证端到端尚缺，未证明的认证条件保持拒绝。App 随附 `@oai/cua` 的服务 bundle 与复制版字节相同；当前受信服务却指向独立 `@oai/browser-desktop/service`，其 bundle 不同，不能据此推断复制版的资源路径。App 的 cloud/orbit 文档目录有同哈希的 `browserAuthSafetyPrecheck.md`，codex-app 目录没有；复制版内置的 training 文档是它无显式 root 时的读取结果，资源扩围及安全路径仍待裁决。候选 `./service` 子路径存在且可打包，生产加载器未切换；受控 setup、重复及并发 setup 清理、telemetry started 顺序、BrowserBackend 与响应元数据/通知生命周期定向测试通过。真实 macOS 上候选客户端调用原版特权服务完成本地页面交互及截图对照，候选服务端未在真实 native pipe 位置运行，不能把客户端或子模块通过视作 53.5 完成。

安全说明后续边界：原包对空白 `browserAuthSafetyPrecheck` 说明先 `trim()` 再拒绝，候选也按原错误形状拒绝。新增原包差分测试后，认证安全相关 3 文件/20 测试通过；该结果仍只覆盖说明缺失或空白时的拒绝路径。

`tk` 内部调度补证：以隔离合成安全说明和相同可见 DOM 夹具测试复制版与候选版，十一种成功/失败模式的审查 payload、调用顺序、返回值与错误一致，含同步审查创建失败和双路同时失败的优先顺序。候选主处理器仍不因测试注入资源而启用审查；实际缺失文档仍 fail-closed。53.4 保持未完成，待明确资源范围、完整接线和真实认证验收。

默认服务调度补证：`service-native-runtime.test.ts` 不传自定义 handlers，使用候选 75 项注册表、真实 `PlaywrightInput` 与 DOM 夹具；`playwright_locator_count` 从运行时入口穿过文档/凭据/安全边界后返回 2，非法 `playwright_locator_fill` 抛错后仍完成凭据命令收尾。该证据只覆盖受控后端与 DOM，不等于 App 特权 nativePipe 或完整安全策略实机验收，53.5 继续未完成。

默认后端进一步补证：同一测试文件使用真实候选 `BrowserBackend` 自行附着到模拟 CDP 宿主，默认注册表执行 `playwright_locator_count`、`playwright_locator_select_option` 与 `playwright_locator_fill`，验证 DOM 状态及剪贴板桥接绑定/脚本在释放时清理；8 项定向测试及 browser-runtime 类型检查通过。夹具模拟 CDP 注入与事件，不是 Codex App 的真实 nativePipe 或安全审批，53.5 仍未完成。

## 54. REPL 命令行入口

- [x] 54.1 根据原包元数据声明的 `cua-repl` bin 路径，为候选包增加只委托 `launch()` 的 macOS 可执行入口，并验证错误退出、打包文件和已实现的启动逻辑。
- [x] 54.2 在真实特权 Node REPL 宿主上验证入口、环境覆盖与服务重置；原复制包缺失 `bin/cua-repl.mjs`，完整原 CLI 行为只可标为未知，不据此宣称原包逐项等价。

54.2 资源核对修正：原复制包实际包含 `plugin/.mcp.template.json` 与 `plugin/.codex-plugin/plugin.json`，候选现逐字节复制并列入 `files`；`bin.test.ts` 依次因缺少模板、插件清单失败，补齐后 2 项通过，`package-artifact.test.ts` 的 cua-repl 实际打包用例通过。此证据只证明资源内容和归档，未验证插件在 Codex App 中的加载行为。

54 定向证据：启动及 bin 共 13 项测试、候选私有产物含显式 CUA 依赖的离线安装/冻结锁重装通过；App 自带 Rust/Node REPL 隔离进程的原版与候选版均完成 MCP 初始化、computer-only 首次 `getState()`、`js_reset` 与第二次 `getState()`，所有步骤无工具错误。候选仅在子进程覆盖 banner、module dirs 与 surface，服务映射仍为原版 Sky；不宣称候选 browser service 的原生管道验收。原 `@oai/cua-repl/package.json` 虽声明 `bin/cua-repl.mjs`，复制的 vendor 并无该文件。包装是自主补全，原包保留原样。

可维护性补充：四个候选包的私有产物现均包含 JS/source map、声明/source map 和内嵌候选 TS 源码；打包测试先在 CUA 缺图时失败，再对四包离线打包/冻结锁重装全部通过。此产物仅用于候选调试，不读取原 vendor 源码。

## 55. 独立 browser-desktop 基准与候选包

- [x] 55.1 将本机 `@oai/browser-desktop@0.1.1` 全部 106 个文件复制至 `packages/back/browser-desktop/@oai/browser-desktop`；记录源路径、版本、逐文件哈希/大小/权限和无符号链接事实，以来源变化和备份篡改的定向测试证明漂移明确失败，不覆盖现有 vendor/back。

55.1 证据：独立基准共 106 个文件、124 个目录/文件条目，源与备份逐项漂移为零；版本为 0.1.1，原包无符号链接。`desktop-baseline.test.ts` 先因模块缺失失败，补实现后 3 项通过，覆盖字节、权限、删减与元数据漂移；`@actiondriver/cua-parity` 定向构建通过。只读复制与校验未启动或连接 App 服务。
- [x] 55.2 清点 desktop client/service、四套环境文档、两个 WASM 的自有/第三方/资源归属与接口；核对客户端与内嵌 browser 的字节重复、服务差异及第三方确切版本，交付单独来源映射和证据缺口。

55.2 证据：`analysis/codex-cua/desktop-inventory.json` 对 106 个文件逐项归属并核对 SHA-256；client 和两个 WASM 与内嵌版相同，service 哈希不同（1905434 vs 1372505 字节）；四套文档共 101 项，manifest 仅显式依赖 `classic-level@3.0.0`。`desktop-source-map.md` 写明共享/独立模块与未明的 bundle 内第三方归属，不能将不同服务等同，也未以清单宣称完整还原。
- [ ] 55.3 建立 `@actiondriver/browser-desktop` 独立构建、显式 ActionDriver 宿主接口及非 Codex 默认入口；为客户端复用、服务差异、资源选择、失败与清理添加正常/边界/错误测试，不从 `packages/back` 或 vendor 导入产品代码。
- [ ] 55.4 按 desktop 服务差异清单逐模块还原自有逻辑与资源，必要时复用已验证的 `browser-runtime` 自有模块；逐模块补离线原包差异和单元测试，未知行为保持未完成，不用候选调用 Codex 私有服务取证。

55.3/55.4 增量证据：修正候选对 `codex-app` 的过早整体拒绝，普通浏览器发现与标签 UI 操作可经 ActionDriver 自有宿主执行；认证交接仍因该环境缺少安全预检文档，在客户端和服务入口下发命令前拒绝。客户端包装显式转发宿主方法，保留原型方法宿主兼容性。3 个 desktop 定向测试文件共 7 项通过，desktop typecheck 与构建通过。本机独立 Chrome/profile 加 127.0.0.1 离线页面验证候选 desktop 客户端创建标签、导航、截图、点击输入及按钮提交，页面标题变为 `ActionDriver desktop UI`，关闭后 profile 为空。完整 desktop 服务差异和其余 UI 路径未验收，55.3/55.4 仍未完成。

## 56. 全包 Codex 服务隔离与自有宿主

- [ ] 56.1 为五个候选包和验收脚本建立禁止 Codex 私有服务连接的静态边界测试；区分允许的 ActionDriver 自有 helper/socket 与禁止的 Codex App `nodeRepl.rpc`、私有 native pipe、App 安装路径、turn metadata/认证 broker，验证绕过与误报用例。
- [ ] 56.2 将 `sky` 原生连接及服务启动迁到 ActionDriver 自有 Computer Use Swift helper/协议适配，定向验证授权失败、断连/超时、取消、资源释放和重连；不得把原 Sky 私有 pipe 直接指向自有 helper 并假设协议兼容。
- [ ] 56.3 为 `browser-runtime` 与 desktop 建立 ActionDriver 自有 macOS 浏览器宿主和明确的能力/生命周期接口，接入默认客户端与服务装配；拒绝缺失宿主能力，覆盖 CDP/页面/截图/关闭/重置和安全门的定向测试。
- [ ] 56.4 将 `cua` 默认工厂和 `cua-repl` launcher 改为仅装配自有 browser/computer 宿主，验证 browser-only、computer-only、合并会话、重置、取消及故障恢复，不加载 Codex App 的 Rust/Node REPL 或原私有服务映射。

56 阶段证据：Sky 默认导入已改为无宿主时显式拒绝，不再因导入触发旧 RPC setup；CUA 显式传入 browser/computer 自有 port 的 11 项相关定向测试通过。Chrome 本地宿主增加标签发现及 CUA 点击、双击、拖动、移动、滚动、单键和文本输入，3 项宿主定向测试及 browser-runtime 类型检查通过。旧 `sky-proxy`、native connection、CUA 其余默认入口及 REPL launcher 仍有私有宿主路径，隔离扫描未通过；56.1–56.4 不标完成。

统一 JS 接线补充（2026-09-28）：生产 CUA 子进程与默认 `createTinyskyAlt` 的 Sky 加载已改用 `@actiondriver/sky/actiondriver` 窄入口，生产 bundle 无旧 native pipe、Codex App 路径或 `@oai/sky` 别名。独立 `cua-repl` launcher 现在要求宿主明确传入绝对路径的自有 browser/computer service module map，拒绝旧候选 service specifier 和 Codex App 路径；13 项 launcher 测试及类型检查通过。launcher 尚无可直接使用的 ActionDriver service module 适配，不能据此标记 56.4 完成。候选 Sky/browser-runtime 服务源码的 17 项私有宿主引用仍待迁移。

## 57. 自有宿主真实验收与统一替换门槛

- [ ] 57.1 在可重置 macOS 本地夹具上用 ActionDriver 自有 helper 执行 computer 成功/拒绝/取消路径，记录状态、截图和释放；历史 Codex 服务结果不得计入。
- [ ] 57.2 在可重置 macOS 本地网页上用 ActionDriver 自有 browser 宿主执行五包相关浏览器页面操作、截图、下载/上传、异常和清理；认证安全说明只按环境来源启用，未证实的认证条件继续拒绝。
- [ ] 57.3 复核五包源码/接口/资源/第三方依赖、离线包安装与服务隔离测试，明确未覆盖路径；只有 1.x、3.x、4.1–4.4、55–57 全部通过且无阻断差异后才能更新 5.1 切换计划，未通过时不得替换生产 loader。

57.2 增量证据：独立本机 Chrome/profile 与 127.0.0.1 离线页面真实执行点击、文本输入和按钮提交，CDP 读回 `Owned input`；在主仓库 `main` 最新运行生成 PNG 10465 字节、SHA-256 `7343ed508ac79ae421d7801857de9770c710c004558300aa73b731225ceb9a92`，profile 清理后为空。记录见 `analysis/codex-cua/owned-macos-acceptance.md`。上传/下载、异常恢复、desktop 差异及其余三包真实路径仍阻断 57.2。

此前 54.2 的 Codex Rust/Node REPL 验证已经发生，作为历史研究保留，但不能充当 56.4 或 57.x 的完成证据。用户裁决禁止五个候选包及验收测试连接 Codex 私有服务；原始复制件原样保存，仅作静态或隔离离线对照。实施路径见 `docs/superpowers/plans/2026-09-28-cua-owned-hosts.md`。

## 58. 用户裁决：提前合并未完成候选

- [x] 58.1 审计当前工作树，只纳入本次还原文件，标记候选未完成；准备提交时按 AGENTS.md 一次性运行适用全量检查，记录通过/失败数量和既有无关失败；将当前候选提交并快进合并到**本地** `main`，不推送远端。
- [ ] 58.2 合并后继续 55–57 和原未完成任务；在独立自有 macOS 宿主验收和全包 Codex 服务隔离通过前，不执行 5.1–5.2 的生产依赖切换。

Battle 记录：推荐先完成隔离再合并，避免主线暂存仍有私有宿主接线的候选代码；用户明确选择现在合并未完成候选，接受此暂时风险。合并不代表模块完成、整体验收或生产替换授权。

58.1 提交前验证记录：`pnpm typecheck` 首次因隔离工作区缺 `@actiondriver/plugin-contracts/dist` 停止，定向构建该既有包后 26 个 workspace 项目全过；`pnpm lint` 首次误扫完整原件和迁移期候选规则而失败，原件/分析资料与候选目录分开处理后通过。`pnpm test` 仍失败（18 个文件、70/2329 项失败）；限 4 worker 复核 66/2329 项失败，包含旧应用/observability 测试，未归因的失败不宣称无关。五候选包定向 192 文件、1111/1111 项通过，生产接线边界定向 6/6 项通过。提前合并是用户选择的 WIP 集成，绝非完整测试/验收通过；本地 main 合并后继续追查全量失败、移除迁移期 lint 例外和完成自有宿主。

58.1 实际集成：WIP 提交 `3f94f0bd240765bfc65aacb09d0e173ad5a0c78a`，本地 `main` 从 `e2755cc67c0af3fe6abb3ca5f0b786fdb158bd7c` 快进至该提交；未推送远端，生产 loader 未改。

58.2 工作区修正：用户明确要求主仓库而非隔离 worktree 检出 `main`。现 `/Users/jiangtao/coding/action-driver` 位于 `main` 并承载后续 148 个本任务改动；原隔离 worktree 回到 `codex/cua-reconstruction`，改动另存为可恢复 stash。主仓库原有未跟踪 `.env.local` 未触碰。迁移后四个相关定向测试文件 14/14 项通过；完整验收与生产替换仍未完成。

## 59. Browser Use 联合交付与 vendor 移除

Battle 裁决：用户要求完全移除 `apps/agent-runtime/vendor`，同时保持 Computer Use 可用，并与 `integrate-browser-use-desktop` 一起交付；`packages/back` 不在删除范围，只用于离线对照。直接删除会破坏当前生产加载和构建；先自有宿主验收、再统一切换和删除。联合设计：`docs/superpowers/specs/2026-09-28-browser-and-vendor-cutover-design.md`。

- [ ] 59.1 完成 55–57、自有 Computer Use helper、CUA/REPL 和 browser 宿主的生产必需路径与真实 macOS 验收，记录未覆盖路径；不以 mock 或原件备份代替。
- [x] 59.2 将 `apps/agent-runtime` 生产 REPL、Sky 服务、CUA 会话及打包切到 `@actiondriver/*`，保留授权、取消、沙箱、截图、重置和清理；用定向集成测试和真实 Computer Use 夹具验证。
- [ ] 59.3 将离线对照测试迁到 `packages/back`，清除生产、构建和脚本的 vendor 路径及同步入口；验证产品包不含原件后删除 `apps/agent-runtime/vendor` 全目录。
- [ ] 59.4 与 `integrate-browser-use-desktop` 的内置/外部 Chrome 真实验收共同检查，准备提交时一次性运行仓库治理要求的全量检查；任何阻断失败均不得标记联合交付完成。

59.2 证据：生产 `repl-server.mjs` 动态加载自有 `owned-cua.mjs`，Runtime 通过 `owned-sky-session.ts` 使用 ActionDriver helper 协议；审批与租约由 Runtime 校验。`cua-runtime.test.ts` 16/16、应用审批与自有宿主定向测试 37/37；真实 Electron + fake helper 的应用授权端到端用例通过，点击“仅本次”后产生 `app-state` 请求。原 `codex-service-host.mjs`、模块 loader 和 native-client 已删除。

59.3 进展：`apps/agent-runtime/vendor` 已删除，离线对照测试改读 `packages/back/codex-cua`；Runtime 构建输出无 `dist/vendor`、原服务脚本或备份路径引用。相关候选包定向测试 1126/1129 项首轮通过，另 3 项打包测试因自有宿主与离线安装规则修正后 4/4 通过。macOS 正式打包产物检查和全量提交验证未完成，因此保持未勾选。

59.1 隔离复核：生产 Computer Use 和 Browser Use 均通过 ActionDriver 宿主。候选包源码静态扫描仍报告 17 个原 `nodeRepl`/私有 pipe/turn metadata 形态的引用，见 `analysis/codex-cua/service-isolation-cutover.json`；这对应 55–57 尚未完成的完整源码服务层还原，不能据生产路径成功勾选 59.1、56.1 或 57.3。

59.4 提交门槛首次运行记录（2026-09-28）：`pnpm typecheck` 各包完成；`pnpm lint` 首次报 3 个本次改动问题，定向 ESLint 修复后通过；`pnpm test` 首次 2366 项中 147 项失败，其中大量为工作树安装时跳过脚本导致的 `better-sqlite3` 绑定缺失，重建原生模块后数据库、仓储及应用授权定向测试通过。REPL 入口和文案测试已按自有宿主更新，定向 16/16 通过。剩余旧 UI mock、OTel、MCP 信号与超时等失败尚未消除。`pnpm test:e2e:local` 6/9 通过，Computer Use 授权通过；预加载 API 新增 `browserSession` 导致的断言已修复，另有设置和图片预览 2 项失败待查。`pnpm test:e2e:packaged:macos` 首次在 `classic-level` 构建策略处停止；加入 `allowBuilds` 后 Desktop 与 Runtime 两项生产依赖部署定向检查均通过。以上全量命令不在同一提交上重复运行，59.4 保持未完成。

主仓库同步验收：`/Users/jiangtao/coding/action-driver` 已同步本轮源码，`apps/agent-runtime/vendor` 和旧 `dist/vendor` 均不存在，`packages/back` 保留。主仓库完成 Sky、CUA、Agent Runtime、Desktop 构建；`dist/js-repl/owned-cua.mjs` 存在；Computer Use/REPL/Renderer 投影定向 38/38 通过；浏览器与 Computer Use 真实 Electron 定向端到端 3/3 通过。全量门槛和候选源码服务隔离仍未通过，不据此声明联合交付完成。

启动故障修复（2026-09-28）：用户现有 `command` 插件的 `installed/command/1.2.0` 仍是旧的点号工具名，而同版本内置清单已改为下划线工具名；仓库曾跳过已存在的同版本安装目录，却更新 `current.json`，导致 Runtime 报 `PROTOCOL_ERROR: Undeclared contribution tools.local.command.shell.run` 并退出。现从独立内置源重新暂存和替换同版本包，保留插件私有数据；RuntimeSupervisor 传递 `runtime.failed` 原因，Desktop 捕获启动异常并显示错误。使用真实数据库和插件目录的只读副本启动 Electron UtilityProcess，观察 `runtime.ready` 与正常退出；插件仓库和 Supervisor 定向测试 13/13、四包离线产物测试 4/4、Runtime/Desktop 定向 typecheck、相关 ESLint 和两个构建均通过。未直接修改用户数据；全量门槛和联合交付仍未完成。
