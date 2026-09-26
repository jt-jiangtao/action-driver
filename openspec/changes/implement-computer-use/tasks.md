## 1. 原生服务骨架

- [x] 1.1 建立签名内置的 Swift helper 目标与构建脚本，设置最低 macOS 14，验证可在 macOS arm64/x64 构建产物，并与正式应用使用稳定身份。
- [x] 1.2 定义服务与 Main 的消息契约（观察、动作、采集、权限、错误），用契约测试验证请求/响应可序列化。
- [x] 1.3 实现私有 stdio 消息通道与生命周期（启动、就绪、退出、崩溃重启），验证单实例、无监听端口与受控关闭。
- [x] 1.4 实现权限探测与状态返回（辅助功能、屏幕录制），验证缺失时返回可诊断状态并给出授权引导。

## 2. 观察能力

- [x] 2.1 实现窗口与元素遍历（AXUIElement），验证返回角色、名称、层级与可执行动作。
- [x] 2.2 实现元素引用指纹与校验，验证界面变化后引用失效并返回 `STALE_REFERENCE`。
- [x] 2.3 实现观察结果裁剪（深度与数量上限），验证大数据界面不产生超大载荷。
- [x] 2.4 增加观察单元测试（使用注入的元素替身），覆盖空窗口、嵌套层级与失效引用。
- [x] 2.5 验证跨应用及窗口、显示器切换后重新观察，旧元素引用和坐标不得继续执行；系统授权后不增加应用白名单。

## 3. 动作能力

- [ ] 3.1 实现点击（元素中心与坐标）与验证返回可观察结果。
- [ ] 3.2 实现文本输入与按键注入（CGEvent），验证中文与快捷键输入。
- [ ] 3.3 实现滚动与等待动作，验证边界（无可滚动区域、等待超时）。
- [ ] 3.4 实现动作截止时间与取消，验证超时返回可诊断结果且迟到效果被记录。
- [ ] 3.5 增加动作集成测试（在可预测的系统窗口中执行），验证点击与输入结果。
- [x] 3.6 对每次点击、元素点击、输入和按键在 Runtime 提出具体动作确认，批准绑定单次调用；验证拒绝确认时 helper 不执行动作，屏幕与 AX 文本不得授予执行权限。

## 4. 屏幕采集

- [x] 4.1 实现按需单帧采集（ScreenCaptureKit），验证返回图像与尺寸上限。
- [x] 4.2 实现区域与分辨率约束，验证超限请求被拒绝或裁剪。
- [x] 4.3 验证采集结果不写入历史与日志（内存处理守卫测试）。
- [x] 4.4 建立经鉴权、分块、有大小与 TTL 上限的内存图像通道；Skill 输出与 LangGraph 状态只传短期句柄，模型请求只在当次推理解析图像，完成、取消、超时和断线时清理。
- [x] 4.5 验证原始图像字节不出现在 Skill 数据库、检查点、事件、日志或可恢复历史；句柄过期返回重新观察状态。

## 5. Provider 与 Runtime 接线

- [x] 5.0 通过现有多轮 Tool/Policy Gate 注册类型化 Computer Tools，委托独立 Computer Skill Provider，实现观察、动作、再观察循环；不得走只调用一次便结束的旧 Skill 分支。
- [x] 5.1 以独立 Provider 标识注册 Computer Use，验证与 Browser Use 互不影响。
- [x] 5.2 通过既有反向调用通道执行观察与动作，验证请求标识、截止时间与取消语义。
- [x] 5.3 实现能力错误映射（权限缺失、引擎不可用、引用失效、超时），验证任务状态可诊断。
- [ ] 5.4 验证非 macOS 平台返回不可用且不影响其他能力。

## 6. 页面投影与控制

- [x] 6.1 时间线展示桌面步骤与结果，验证与 Browser Use 相同的状态语义。
- [x] 6.2 将暂停/继续/接管接线到 Runtime、Main 与 helper 的实际门禁，修正当前硬编码 Browser Skill 的控制事件，验证接管期间阻止 Agent 动作。
- [x] 6.3 展示分项权限引导、系统设置路径、实际需授权进程名、重新检测与失败状态，并说明远端模型可能接收观察内容。

## 7. 验证

- [x] 7.1 增加端到端集成测试（Mock 原生替身）：请求观察 → 动作 → 结果 → 接管。
- [ ] 7.2 增加签名打包冒烟：helper 随应用启动、权限归属、授权后重检或重启、权限撤销、单次观察与动作；记录实际系统设置显示名称。
- [x] 7.3 提交前运行 `pnpm typecheck`、`pnpm lint`、`pnpm test`，以及与界面、运行时、打包变更相关的 `pnpm test:e2e:local`、`pnpm test:e2e:packaged:macos`，记录通过和失败数量。

## 8. 授权指引窗口

- [x] 8.1 协议与 helper 支持 `permissions` 的 `prompt` 与 `target`：按单项触发辅助功能、屏幕录制与输入事件的系统授权请求；只读预检不登记应用。
- [x] 8.2 实现独立授权指引窗口：无标题栏边框、固定尺寸、无关闭按钮、`Esc` 返回主窗口，两窗口可同时存在。
- [x] 8.3 按参考形态实现窗口内容：参考图同款图标、中文标题与说明、逐项卡片（`允许`/`已完成`/“在系统设置中完成”），且不提供底部按钮。
- [x] 8.4 Computer Use 被调起且缺权限时自动打开指引窗口；无手动入口、无“不再提示”持久化、同一任务只打开一次。
- [x] 8.5 记录系统设置中的实际显示名称并区分开发构建与签名打包构建。
- [x] 8.6 运行定向测试与全量验证并记录结果，包含两个窗口同时存在时的样式检查。
- [x] 8.7 串行化 Main 侧 helper 请求，消除两个窗口并发探测导致的 `ENGINE_UNAVAILABLE: Computer Use is busy`。
- [x] 8.8 设置页 Computer Use 收敛为单一 `任意应用` 控制项：开关反映授权、逐项状态、`重新检测`，缺授权时提供 `打开授权指引`，且不含范围外内容。
- [x] 8.9 授权指引窗口改为 helper 内的原生 Swift 窗口：真实 SF Symbols 图标、无标题栏、只保留关闭按钮，`Esc` 同样关闭；协议新增 `guidance` 操作，Electron 侧删除原 React 指引界面与对应契约。
- [x] 8.10 「飞走—飞回」动效：`允许` 后窗口缩至屏幕右上角并淡出，轮询到授权落地后飞回显示 `已完成`，两项完成自动关闭；状态机由 `GuidanceState` 承载并有单测覆盖。
- [x] 8.11 确认并记录系统限制：把应用拖入授权列表只能由用户完成，应用无法代劳。
- [x] 8.12 授权流程改为双窗口：指引窗口不动，待授权卡变虚线卡，第二个浮动面板从卡片位置飞出、内含可拖拽应用图标，返回或授权落地时飞回并交还焦点。
- [x] 8.13 权限状态一律按 macOS 真实返回，移除全部预览/占位状态。

## 9. helper 进程归属与通信通道（Battle 后）

## 10. 能力面对齐 Codex（Battle 后裁决）

- [x] 10.1 协议与 helper 新增 `list_apps`：返回应用 id／显示名／是否运行／路径。
- [x] 10.2 `get_app_state`：按 app（名/路径/bundle id）取 AX 文本 + 截图；未运行则经 LaunchServices 透明启动；动作后自动等待（约 1s，加载中最多再等 5s）；输出相对上次的 diff，`disableDiff` 关闭。
- [x] 10.3 动作补齐：`set_value`、`paste`（系统剪贴板，写入后恢复原内容，支持 text/md/html）、`select_text`（含 prefix/suffix/selection_type）、`drag`、`perform_secondary_action`（仅限元素实际暴露的 action）。
- [x] 10.4 模型入口：提供 `node_repl` 式有状态 JS 入口（状态跨调用保留、可 emit 图像），在 JS 中 `import` Computer Use 库调用上述 11 个 API；除用户明确要求外不使用 AppleScript/osascript/JXA/System Events/CGEvent 合成。
  - [x] 10.4.1 单次调用 = 一个 ES module：`vm.SourceTextModule` + 持久 `vm` 上下文，天然支持顶层 `await`、跨调用重声明 `const`/`let`、`globalThis` 持久。
  - [x] 10.4.2 顶层绑定跨调用保留：`resources/js-repl/bindings.mjs` 用自研 tokenizer 取顶层绑定名，prelude 从合成模块 `@prev` 重新声明未被本单元覆盖的名字，再把合并后的名字 `export` 给下一单元；引擎语法错误会回退重试（冲突就取消 carry、导出不存在就删名），最终兜底是原样运行代码。
  - [x] 10.4.3 `@oai/sky`：动态 import 解析为合成模块（`const { sky } = await import("@oai/sky")`，同时预置同名全局）；`node:*` 走真实动态 import，`node:process` 与顶层静态 import 按 Codex 文案拒绝。
  - [x] 10.4.4 `nodeRepl`：`write`／`emitImage({bytes, mimeType})`／`cwd`／`homeDir`／`tmpDir`；`emitImage` 用 `ArrayBuffer.isView` 判定，兼容子 realm 的 `Uint8Array`。
  - [x] 10.4.5 工具面：`js`（`code` / `timeout_ms` / `title`，单次默认 30s、上限 300s）与 `js_reset`；模型侧名字与 Codex 的 `node_repl` 工具一致。
- [x] 10.5 门禁与前置条件：调用 Computer Use 前必须先加载 `computer-use` skill；11 个 API 全部接入既有 Tool/Policy 门禁，确认分级遵循 skill 里的 Confirmations Policy。
  - [x] 10.5.1 JS 入口的确认按**单元**落在工具调用边界（Battle 结论选 A）：分类器用与子进程同一份 tokenizer 找 `click`/`drag`/`paste`/`press_key`/`select_text`/`set_value`/`type_text`/`perform_secondary_action` 的方法名，命中才在执行前弹确认卡（显示模型 `title`、命中动作与代码摘要），纯观察单元不打断；确认卡复用既有的 `COMPUTER_ACTION_APPROVAL` 通道，但投影改为 action｜cell 两种形态。
  - [x] 10.5.2 分类只是"要不要提前问"，不是许可：sky 层要求有副作用的方法必须带本单元授权，否则回 `APPROVAL_REQUIRED`（运行时拼名字绕开分类的情形因此不会静默执行，模型换一个单元重试即会走确认）。
  - [x] 10.5.3 拒绝时该单元不执行，工具结果回 `USER_DENIED`；把需要确认的单元与其它工具调用放在同一轮仍按 `COMPUTER_ACTION_BATCH_UNSUPPORTED` 拒绝。

### 10.7 逐动作确认（Battle 第二轮，裁决 B2：挂起 + 续接）

- [x] 10.7.1 子进程协议与宿主 API：出现有副作用的 sky 调用时，宿主不再直接执行，而是给子进程回 `approvalRequired` 并让该 promise 保持 pending；宿主把这轮以"待审批动作（序号 + 方法 + 参数）"结束。续接时宿主把决定交回同一挂起单元（`continueRun`），批准则先执行动作再把结果写入，拒绝则写入 `USER_DENIED`，然后继续等到单元完成或下一个待审批动作。等待审批的时间不计入单元超时。
- [x] 10.7.2 工具调用续跑：`ToolInvocationService` 把 `continuation.decisions` 通过执行上下文交给工具，`ToolApprovalRequired` 原样上抛（不写成 `tool.failed`、不重复写终态事件，`commitToolInvocationWithEvent` 按 `eventKey` 幂等）。`js` 执行器在第一次执行时把待审批动作记进任务级表并上抛，续接时按"决策序号与等待中的动作比对"逐个投递，已投递过的（小于当前等待序号）跳过，大于则 `APPROVAL_STALE`。
  - 10.7.6 排查笔记（下次接手按此顺序）：① 先把 `js-tools` 的 `callSky` 恢复成 `throw new ApprovalRequiredError(...)`（当前是直接拒绝的两行）再跑 `pnpm vitest run apps/agent-runtime/tests/js-tools.test.ts`；② 首次挂起后立刻打印 `session.suspended.action.index` 与工具侧 `pendingApprovals` 的 `index` 比对。最象的解释是**动作序号被抬高**：续接时 `continueRun` 把 `suspended` 作为 `run` 传给 `runCell`，于是 `active.actions = suspended.actions = 上一个序号 + 1`；若子进程在续接后仍报告同一个动作，`suspend()` 会把它记成"序号 +1"，工具侧于是看到"决定序号 < 等待序号"→ 跳过 → 循环结束 → 重抛 `TOOL_APPROVAL_REQUIRED`，正好是无 `act` 请求、以该错误结束的现象。修法：序号只由 `suspend()` 递增，续接时不把 `suspended.actions` 当作新一轮的起始值（或让 `continueRun` 显式携带"正在回答的序号"并让它优先于计数器）。③ 修好后跑 typecheck / lint / `pnpm test` / `pnpm test:e2e:packaged:macos`，再启用挂起路径并勾掉本项。
  - [ ] 10.7.6 **待补**：`js-tools` 里"把已有决策真正投递回宿主并完成单元"这一段尚未通过测试（`js-tools.test.ts` 目前只验证到挂起与动作未被提前执行）；宿主层的挂起→续接→完成已由 `tests/js-entry.test.ts` 用真实子进程覆盖。修复方向：续接时 `host.continueRun` 的 `perform` 需要与宿主悬挂调用对齐（疑似首轮被放弃的 tool 生成器让宿主会话状态与执行器视图不一致）。
- [x] 10.7.7 临时可用性回退（用户裁决"先保住可用性"）：`js` 入口只做观察与脚本，`sky.click`/`set_value`/`type_text`/`press_key`/`drag`/`paste`/`select_text`/`perform_secondary_action` 一律拒绝并提示改用 `computer_act`（先用 `computer_observe` 取 `observationId` 与 `elementRef`，逐动作确认）；B2 的挂起协议、图循环与 `jsAction` 卡片代码保留但不启用，等 10.7.6 修好并按需恢复。
- [x] 10.7.3 图节点循环：`executeTools` 用"执行 → 工具上抛待审批动作 → `interrupt()` → 恢复 → 用已给出的决策列表继续同一 `callId`"的循环，`js` 不再发单元级确认；决策列表按 callId 记在运行时，恢复时整体重放（工具按序号跳过已投递的决策），并在调用结束时清空。
  - 实测发现：同一轮里连续第二次 `interrupt()` 在真实节点里会拿到和第一次相同的恢复值（与最小 spike 的结论不一致），因此**一次 `js` 调用只允许一个桌面动作**：同一单元出现第二个待审批动作时，工具结果返回 `COMPUTER_ACTION_SPLIT_REQUIRED`，要求模型拆成两次调用。多动作单元留待对 LangGraph 的多次中断语义再做一次 spike 后评估。
- [ ] 10.7.4 提示词与工具描述改为"每个动作各自确认、可以在一个单元里连续写多个动作"。
- [ ] 10.7.5 验证：定向测试（挂起/续接协议、多动作逐个确认、拒绝只影响该动作、单元不重跑）、`pnpm typecheck`/`lint`/`test`、打包冒烟；真实应用冒烟由用户侧完成。
- [x] 10.6 验证：定向测试（协议/helper/工具面/JS 入口）、真实 helper 二进制冒烟、打包冒烟（见 `design.md` 的「10.x 实施记录」）。

- [x] 9.1 helper 提供 Unix domain socket 服务：私有运行目录（0700）、socket 0600、token 握手、单连接串行、无 TCP 监听。
- [x] 9.2 Main 通过 LaunchServices 启动 helper 并连接 socket：既有 socket 复用、就绪超时、崩溃感知与重启、shutdown 与残留清理；删除 stdio 通道与相关回退开关。
- [x] 9.3 开发与打包都用稳定签名身份（自签名 `ActionDriver Dev Signing` 或 Developer ID），保证授权条目不随重建失效。
- [x] 9.4 验证 helper 作为发起进程能被授权：直连 socket 探针与应用内判定都反映 helper 自身身份。
- [ ] 9.5 发布/安装场景验证：安装后的 `ActionDriver.app` 能通过 LaunchServices 拉起 `Contents/Helpers` 内的 helper 并完成 socket 握手。（**未自动化的原因**：暂存目录冒烟里 `open -a` 按 bundle id 解析，可能拉起构建树里的另一份注册副本；实测在暂存环境无法稳定断言，已把该断言挪到安装后验证。）

### 9.x 实施记录

- 实测：`open -n -a <helper> --args --socket … --token-file …` 后，helper 进程 `ppid=1`（由 launchd 托管），socket 权限 `srw-------`，握手 + `permissions` 请求返回结构化结果，`AXIsProcessTrusted()` 反映的是 helper 自身身份（同证书的探针应用未授权时为 `false`，授权后为 `true`）。
- 对照证据：同一二进制直接由 shell 启动读到 `accessibility=true`（继承终端授权），经 LaunchServices 启动读到 `false`（自己的身份）——这正是本次架构改动的依据。
- 开发签名：本机无 Apple 签名身份，改为独立钥匙串 `~/Library/Keychains/actiondriver-dev.keychain-db` 中的自签名 `ActionDriver Dev Signing`；构建用 `ACTIONDRIVER_CODESIGN_IDENTITY` + `ACTIONDRIVER_CODESIGN_KEYCHAIN` 传入，脚本会先解锁该钥匙串。
- 路径长度坑：Unix domain socket 路径上限约 104 字节，e2e 的临时 userData 路径会超限导致 bind 失败；socket 因此改放到 `os.tmpdir()`（`actiondriver-computer-use.sock`）。helper 在 socket 创建失败时直接退出，避免每次重试都残留一个空转进程。
- 构建脚本现在**默认**使用本机开发签名身份（存在 `actiondriver-dev.keychain-db` 时），否则才退回 ad-hoc；这样 `pnpm dev`、e2e、打包冒烟的重建都不会再把授权条目弄失效。
- 打包冒烟（`pnpm test:e2e:packaged:macos`）在启动路径改为 LaunchServices + socket 之后重跑通过：打包应用启动内置 Runtime 并完成 Renderer 鉴权（1 项通过，18.7s）。
- `pnpm test:e2e:local` 在该版本为 7 通过 / 1 失败，失败项是既有的 Token Plan 生图接口下拉框用例（与本次改动无关）。

## 验证记录

2026-09-26，本机 macOS arm64：

- `swift test`（`apps/native-computer-use-helper`）：5 项通过。
- `pnpm typecheck`、`pnpm lint`：通过；交互契约校验 138 项声明。
- `pnpm test`：150 个文件通过、2 跳过；935 个用例通过、2 跳过。
- `pnpm test:e2e:local`：7 项中 6 项通过，1 项失败——既有 `persists the selected Token Plan image API and default model in settings` 用例仍在查找当前设置界面已移除的“生图接口”下拉框，与本次改动无关（同一失败已记录在 `openspec/changes/archive/2026-09-26-add-office-document-system-skills/tasks.md`）。本次另修正该文件中过期的 preload 桥接键断言（补齐 `computerUse` 与既有 `taskOutput`）。
- `pnpm test:e2e:packaged:macos`：通过。打包脚本把 helper 放入 `Contents/Helpers/ActionDriver Computer Use.app`，校验可执行位、arm64 架构与 `codesign --verify --strict`，随后打包应用启动并通过 `packaged-runtime.spec.ts`。
- 真实 helper 二进制 stdio 冒烟（`dist/arm64/actiondriver-computer-use`）：`permissions` 返回 `{accessibility, screenRecording, eventPosting, permissionTarget: "ActionDriver Computer Use"}`；`observe` 返回当前前台应用的结构化元素树与 `observationId`；`maxElements: 1, maxDepth: 1` 时返回树仅 1 个节点；失效 `observationId` / `elementRef` 的 `act` 返回 `STALE_REFERENCE`；`shutdown` 返回 `{accepted: true}` 并退出。
- 真实 helper 单会话串行冒烟：逐条请求/响应可用；`wait` 请求超过自身截止时间时返回 `{"code":"TIMED_OUT","message":"Request deadline elapsed"}`；随后 `shutdown` 返回 `{accepted: true}` 并退出。
- 同一时刻并发投递的第二个请求返回 `ENGINE_UNAVAILABLE: Computer Use is busy`：单实例 helper 选择拒绝而不是排队，Main 侧每条任务的动作轮次本身串行；多任务同时操作桌面会被拒绝而非静默交错。

2026-09-26，授权指引窗口（本轮追加）：

- 实测本机“系统设置 → 隐私与安全性 → 设备控制和数据访问”列表：`ChatGPT` 开启，`Codex Computer Use` 关闭，没有 `ActionDriver Computer Use` 条目。开发构建下 helper 由宿主进程启动、ad-hoc 签名无 Team ID，读回的三项权限都继承宿主授权，所以窗口直接显示 `Done`，系统不会出现“拖入列表”的指引。
- 指引窗口按 Codex 参考形态 1:1 实现：无窗口标题文本（清空文档标题，避免共用 `index.html` 的 `ActionDriver` 标题泄漏到标题栏）、应用图标、`Enable Codex Computer Use` 标题与说明、`Accessibility` 与 `Screenshots` 两张卡片。参考图里的 `Chrome Extension` 一行不复制；输入事件随辅助功能生效，也不单列。
- `pnpm test:e2e:local`：8 项中 7 项通过。新增用例验证：`ensureGuidance` 打开第二个窗口、两窗口同时存在、指引窗口 `closable=false`/`resizable=false`、窗口标题不含 `ActionDriver`、点 `Back` 后只剩一个窗口。唯一失败仍是既有的 `persists the selected Token Plan image API and default model in settings`。
- `pnpm typecheck`、`pnpm lint` 通过（交互契约 145 项）；`pnpm test`：153 个文件通过、2 跳过，951 个用例通过、2 跳过。
- 样式检查：用真实应用同时打开主窗口与指引窗口截图核对，指引窗口在独立表面下自适应、无设置页侧栏残留。
- 待确认：窗口文案里的产品名当前取 `Codex`（与本机系统设置条目一致），如需改回其它名称，只需改 `ComputerUseGuidance.tsx` 的 `PRODUCT_NAME` 常量。

2026-09-26，指引窗口视觉与并发收尾：

- 参考图 1:1 复刻：辅助功能改为蓝色圆环 + 蓝色人形，屏幕录制改为取景框四角 + 灰色填充相机，与参考图字形一致；文案改为中文；窗口顶部不再有标题栏边框（`hiddenInset` + 内容自带拖拽区）。
- 去掉底部三个按钮：授权后切回窗口自动重新检测（`focus`），`Esc` 返回主窗口，`Esc` 销毁窗口会打断 Playwright 的按键调用，因此 E2E 断言改看窗口数量结果。
- 修掉同屏并发缺陷：`ComputerUseClient` 现在串行派发请求；新增用例证明第二条请求在第一条应答前不会写入 helper，从而不再出现 `ENGINE_UNAVAILABLE: Computer Use is busy`（该错误出现在用户截图中）。
- 验证：`swift test` 8 项通过；`pnpm typecheck`、`pnpm lint` 通过（142 项交互契约）；`pnpm test` 153 个文件通过、2 跳过，952 个用例通过、2 跳过；`pnpm test:e2e:local` 8 项中 7 项通过，唯一失败仍是既有的 “生图接口” 下拉框用例。

- 指引窗口触发收紧（2026-09-26 用户裁决）：只有辅助功能或屏幕录制至少一项未授权时才调起指引窗口；开发构建不再“始终打开”（helper 已改由 LaunchServices 启动，读回的是它自身的授权），权限状态读取失败时也不打开。

仍未完成的验证：

- 3.1–3.5 需要把真实点击、中文／快捷键输入与滚动注入到可预测的系统窗口，会改动本机桌面焦点与内容，未在本次自动执行；本次只验证了等待超时、失效引用与权限缺失等无副作用路径。3.4 中“迟到效果被记录”同样依赖真实越界动作。
- 5.4 需要在非 macOS 主机上运行；本机只能验证注册被平台开关关闭的代码路径。
- 7.2 的 helper 随应用启动、TCC 权限归属、授权后重检／重启、权限撤销与系统设置中的实际进程名需要用户在“系统设置 → 隐私与安全性”交互授权后确认；本次只验证了打包、签名、启动与直接调用 helper 的能力域行为。带正式 Developer ID 的发布签名（`ACTIONDRIVER_CODESIGN_IDENTITY`）同样未在本机执行。
