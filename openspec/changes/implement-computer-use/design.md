## Context

参见 `proposal.md` 的 Why。既有：`agent-skill-boundary`（两个 Skill 独立注册、统一生命周期）、`replace-agentd-with-local-langgraph-runtime`（Provider 由 Main 持有、Runtime 反向调用）、`implement-browser-use`（控制/接管语义与投影方式）。

## Goals / Non-Goals

**Goals**

- 原生服务提供观察、动作、采集三域能力，权限与失败可诊断。
- 屏幕与界面数据最小化，不进入历史。
- 与 Browser Use 高层语义一致、底层独立。

**Non-Goals**

- 不实现 Windows/Linux 支持。
- 不实现 macOS 13 及更早版本兼容。
- 不实现应用级自动化脚本、录制回放或工作流编排。
- 不实现无障碍替代方案（VoiceOver 等）。

## Decisions

### 1. 原生服务独立进程与通信
Swift helper 作为签名内置的独立进程，由 **LaunchServices 启动**（不是 Electron 的子进程），Main 通过 **Unix domain socket** 传输版本化、类型化的请求与响应：socket 位于用户数据目录下的私有运行目录（目录 0700、socket 0600），首个握手帧校验一次性 token（token 由 Main 写入同目录的 0600 文件，helper 读完即删）。没有任何 TCP 监听端口。Main 与 helper 均校验消息大小、动作参数、截止时间和取消状态；helper 只执行固定动作集合，不运行模型生成的任意代码。

改动理由（Battle 结论）：TCC 按「发起进程链」归属授权。实测同一二进制直接由 shell 启动时读到 `accessibility=true`（继承终端授权），经 `open -a` 由 LaunchServices 启动时读到 `false`（自己的身份）。只有后者能让用户在系统设置里给 `ActionDriver Computer Use` 的授权真正生效，也才能让引导文案里的进程名成立。

生命周期：Main 启动前先尝试连接既有 socket，连不上才通过 `open -n -a <helper> --args <socket> <tokenFile>` 拉起；就绪以「socket 可连接」为准（带超时）。helper 不是 Main 的子进程，崩溃通过 socket 断开来感知，下次请求时重新拉起。退出走 `shutdown` 请求，Main 兜底清理 socket 文件并终止残留进程。**不留 stdio 回退通道**（用户裁决）：要么 socket 方案成立，要么重新 Battle。

硬门禁：打包构建必须验证嵌套在 `ActionDriver.app/Contents/Helpers` 里的 helper 仍能被 LaunchServices 拉起并完成握手；不成立就必须重新 Battle，而不是退回旧通道。

### 2. 观察模型与引用
元素引用由 `AXUIElement` 的稳定属性（角色、标题、标识、层级路径）构造指纹；动作前校验，失效返回 `STALE_REFERENCE`。与浏览器引用策略一致，便于 Agent 侧复用。

### 3. 动作注入
只允许受约束动作集合（点击坐标/元素中心、输入文本、按键、滚动、等待），每次动作后返回可观察结果；坐标动作要求先有观察依据，避免盲点。

### 4. 屏幕采集
默认按需单帧采集，限定区域与分辨率上限；持续帧流仅在后续需要时引入。原始图像通过经鉴权的分块传输进入 Runtime 内存缓存，设大小、数量与存活时间上限；持久化 Skill 输出和 LangGraph 状态只持有短期句柄及安全摘要。模型请求在当次推理前从内存解析句柄，完成、取消、超时或进程断线后清除图像；句柄过期须重新观察，不从历史恢复图像。若使用远端模型，界面明确说明截图和界面文字可能发送到所选模型提供方；“不写入本地历史”不等于“只留在本机”。

### 5. 权限治理与操作范围
启动时探测权限，任务需要时再次校验；只在实际需要截图时要求录屏权限，缺失时返回可诊断状态并给出授权引导；权限被撤销时停止后续动作。系统权限开启后默认允许跨所有应用操作，不提供任务级应用白名单。此范围是用户明确裁决的结果。高后果动作仍在执行前要求用户确认，屏幕内容与 AX 文本不能授予新权限或改变策略。

动作后果无法从一次点击或按键可靠推断。用户已裁决每次修改性动作（点击、元素点击、输入、按键）均在 Runtime 执行前展示具体动作并等待明确批准；等待与滚动无须此确认。确认绑定单次调用，不得复用或由模型、屏幕内容代填。替代方案是仅确认坐标点击和疑似高后果语义，交互较快但可能漏掉无标签提交按钮；只依赖模型主动标记风险更易绕过。选择保守门禁的代价是高频确认和任务速度下降，用户已接受。

### 6. 真实用户控制
暂停、取消和人工接管必须从 Runtime 传播到 Main 的执行门禁，并阻止 helper 接受后续动作；进行中的动作返回确定结果或可诊断的迟到效果。现有 `skill.control` 只投影状态且硬编码 Browser Skill，实施时须修正为按 invocation 与 Skill 标识控制真实执行。

Agent 使用现有多轮 Tool/Policy Gate 发出类型化 Computer Tool 调用，Tool executor 委托独立的 Computer Skill Provider，并将安全摘要返回模型以继续观察、动作、再观察循环。旧 Skill 分支目前只调用一次 Provider 即结束，不作为 Computer Use 的循环入口。Tool 授权状态与 macOS 系统权限是两个独立门禁：系统授权开启后默认可操作所有应用，但本轮 Tool 仍须明确授予。

### 7. 打包与权限身份
开发构建先验证原生 API 与协议；正式发布门禁使用稳定 Bundle ID、签名的 app/helper 和打包后冒烟，分别确认辅助功能与录屏权限显示的进程、授权后重检、系统要求重启时的恢复，以及撤销权限后的阻断。权限 UI 展示用户在系统设置中实际需要开启的进程名称。

### 8. 授权指引窗口与真实授权触发
授权引导是 helper 内的**原生 Swift 窗口**（AppKit + SwiftUI），不再由 Electron 渲染：窗口只有关闭按钮、没有标题栏，固定尺寸、不可缩放、内容铺满窗口。选择原生的原因是需要真实 SF Symbols 图标（`figure.stand`、`camera.viewfinder`）与原生材质、原生动效，这是 Chromium 渲染给不了的。代价是 UI 分成两套、原生窗口无法被 Playwright 驱动，因此窗口行为由 Swift 单测 + 打包冒烟覆盖，Electron 侧只保留“请求 helper 弹出窗口”的通道。

内容按参考形态组织为“应用图标 + 标题 + 说明 + 逐项权限卡片”，每张卡片给出权限名称、一行用途、当前状态与操作：未授权显示 `允许`，已授权显示 `已完成`。系统提示正处于待办状态时，该权限项**被**“在系统设置中完成”虚线卡**替换**（不是额外加一块），并附带动画与“把 ActionDriver Computer Use 拖入上方列表”的浮动提示；授权落地后虚线卡动画切回 `已完成`。

「飞出—飞入」动效作用在**第二个窗口**上，指引窗口本身始终不动：点 `允许` 后，待授权卡变成虚线卡，**拖动提示窗口从该卡片的位置飞出**（0.34s 放大淡入）到屏幕下方，面板里带可拖拽的应用图标、向上箭头与“把 ActionDriver Computer Use 拖入上方列表”；授权落地或点面板的返回按钮时，面板**飞回卡片位置**并淡出，焦点交还指引窗口。窗口按 1.2s 轮询 helper 的权限状态，两项都完成且用户确实发起过授权时指引窗口自动关闭。

权限状态一律取 macOS 的真实返回（`AXIsProcessTrusted` / `CGPreflightScreenCaptureAccess` 或它们的 prompt 版本），不做任何预览或假设：被授权环境继承时如实显示“已完成”，未授权时显示“允许”并进入待授权流程。

参考形态里的 `Chrome Extension`/`Install` 一行**不复制**：当前应用不支持 Chrome 插件，指引只列出本应用真正需要的 辅助功能、屏幕录制、输入事件 三项，MUST NOT 出现安装扩展一类当前无法兑现的操作。

窗口内不提供底部按钮（参考窗口没有）：用户点 `允许` 触发系统授权，切到系统设置完成授权；关闭按钮与 `Esc` 都能关闭窗口，关闭时停止轮询。

关于系统面板：把应用拖入列表只能由用户完成。应用没有公开 API 可以自行授权，`tccutil` 只能重置，合成事件会被同意界面忽略；只有 MDM/PPPC 配置描述符能在管理设备上按 Team ID + bundle ID 预授权。窗口能做的是触发面板、让出屏幕、轮询结果、给出可执行的指引。

设置里的 Computer Use 页面按参考形态收敛为一个「控制」分组：只有一行 `任意应用`（图标、名称、一行说明、右侧开关），开关反映辅助功能与屏幕录制是否都已授权。卡片底部一行给出逐项授权状态、`重新检测` 与仅在缺授权时出现的 `打开授权指引`。MUST NOT 出现当前范围没有的内容（例如应用白名单、`始终允许的应用`、Chrome 扩展、其它应用的加载项）。已授权时点开关会打开系统设置，因为只有 macOS 能撤销授权。

窗口没有关闭按钮：`closable: false`，用户通过 `Esc` 离开，返回时销毁指引窗口并把主窗口带到前台。重复触发只聚焦已存在的指引窗口，不叠加多个实例；两个窗口可以同时存在，互不影响。

Main 侧对 helper 的请求串行化：helper 单实例、同时刻只处理一条请求并拒绝并发，主窗口与指引窗口若同时探测权限会拿到 `ENGINE_UNAVAILABLE: Computer Use is busy`。`ComputerUseClient` 因此排队而不是并发投递，空闲时仍然同步派发以保持既有语义。

入口只有自动触发一条：Computer Use 被调起（任务出现 `computer.*` 工具调用）时检查权限，缺权限即自动打开指引窗口；不提供“打开授权指引”手动入口，也不持久化“不再提示”。同一任务在一次会话内只自动打开一次，避免反复抢夺焦点。

只读预检不会让应用出现在系统设置里：`AXIsProcessTrusted()`、`CGPreflightScreenCaptureAccess()`、`CGPreflightPostEventAccess()` 只报告状态，不登记进程，所以旧引导让用户去列表里找一个永远不存在的条目。`允许` 必须走带提示的请求 API：

- 辅助功能：`AXIsProcessTrustedWithOptions` 配合 `kAXTrustedCheckOptionPrompt`，系统会显示“将应用拖入列表”的引导。
- 屏幕录制：`CGRequestScreenCaptureAccess()`。
- 输入事件：`CGRequestPostEventAccess()`。

协议上 `permissions` 增加可选 `prompt: true`，由 Main 经既有 IPC 通道转发；页面只在用户点击 `允许` 时按单项触发，MUST NOT 自动弹出系统提示。系统提示对每个应用每次授权状态通常只出现一次，之后按钮改为把用户带到系统设置并提示重新检测。

系统设置里显示的名称由运行方式决定：打包签名包归属 helper 自身，开发构建在 ad-hoc 签名与父进程归属下会显示成别的名字（本机实测为 `Codex Computer Use`，且该项默认关闭）。引导按运行时实际值展示该名称，并说明可能需要在授权后重启应用。

## Risks / Trade-offs

### 10. Computer Use 能力面对齐 Codex（Battle 后裁决）

结论（2026-09-26，用户裁决“全部纳入，而且都按照 codex 来”）：把 Codex 的 Computer Use skill 逐字纳入仓库并**要求先加载**，同时按 Codex 的能力面实现，不再只保留我们原先的 4 个工具：

- **API 面**（11 个，与 `@oai/sky` 同名同义）：`list_apps`、`get_app_state`、`click`、`drag`、`paste`、`press_key`、`scroll`、`select_text`、`set_value`、`type_text`、`perform_secondary_action`。
- **调用形态**：提供 `node_repl` 式的**有状态 JS 入口**（对齐 Codex 的 `js`/`js_reset` 语义：状态跨调用保留、可 emit 图像），模型在 JS 里 `import` 我们的 Computer Use 库后调用上述 API；`node_repl` 之外的技术（AppleScript/osascript/JXA/System Events/CGEvent 合成）一律不用，除非用户明确要求。
- **行为细节**：`get_app_state` 返回 AX 文本 + 截图，默认输出**相对上一次的 diff**（`disableDiff` 可关）；动作后**自动等待**（约 1s，检测到加载状态时最多再等 5s）；目标应用未运行则**透明启动**（经 LaunchServices，不经过 shell）；`app` 参数接受显示名、路径或 bundle id；显示名失败时先用 `list_apps()` 取 bundle id 重试。
- **确认策略**：沿用 skill 里那份 Confirmations Policy（Hand-off / Always confirm / Pre-approval / No confirmation 四档 + Hygiene），由 Runtime 的 Tool/Policy 门禁与动作确认实现。
- **禁止项**（WPS 事故的根因）：不得用 shell 启动 GUI 应用，不得直接执行 `.app` 包内二进制，不得用 `xattr` 绕过隔离；打开应用走 LaunchServices。

实施分三阶段（tasks 第 10 节）：

1. 协议与 helper：新增 `list_apps`、`get_app_state`、`set_value`、`paste`、`select_text`、`drag`、`perform_secondary_action`，并把 `get_app_state` 的自动启动/自动等待/diff 做进 helper。
2. Runtime 工具与 JS 入口：把这 11 个 API 暴露给模型（类型化工具 + 有状态 JS 入口），接入既有 Tool/Policy 与动作确认门禁，并让 `computer-use` skill 的加载成为调用前置条件。
3. 验证：单元/集成测试（helper 状态机 + 协议 + 工具面）、真实应用冒烟（WPS 类应用不再被 shell 启动、观察/动作/粘贴/取值可用）、打包冒烟。

风险：JS 入口扩大运行边界（需要受限的 JS 运行时与库桥接）；能力面变大后确认门禁必须逐动作覆盖；diff 输出与自动等待会影响 token 与延迟。

- [权限弹窗与用户预期不一致] → 只在实际需要时请求，并在界面给出解释与系统设置路径。
- [动作误伤用户数据] → 受约束动作集合 + 每次修改性动作单独确认；代价是高频打断。
- [屏幕采集隐私风险] → 内存处理、分辨率上限、不落盘；日志不记录屏幕内容。
- [现有 Skill 输出与 LangGraph 检查点会持久化截图] → 原始字节走独立分块内存通道，只把句柄送入可持久化路径；存储守卫测试检索数据库、检查点与日志。
- [原生服务与 Electron 版本/架构耦合] → 打包时校验架构与最小系统版本，缺失即构建失败。
- [默认可操作所有应用可能误触无关应用] → 用户已选择该范围；动作前校验当前界面，短步骤后核验结果，并保留随时暂停、接管与高后果动作确认。
- [stdio 不具备 XPC 的沙箱和生命周期管理] → 无网络监听，双侧严格校验协议与动作，Main 监督进程；若签名包验证暴露权限或隔离问题，重新 Battle 评估 XPC。

## Migration Plan

1. 原生服务骨架与权限探测（可独立运行与冒烟）。
2. 观察与动作能力 + 引用校验。
3. Provider 注册与 Runtime 接线。
4. 页面投影与控制接线。
5. 打包与权限冒烟验证。

回滚：把 Computer Skill 绑定回 Mock Provider，原生服务不随应用启动。

## 10.x 实施记录：有状态 JS 入口（2026-09-26）

### Decisions

**1. 单次调用 = 一个 ES module，绑定靠合成模块 `@prev` 传递（而不是解析改写用户代码）。**
Codex 的 `node_repl` 内核同样以 module 为单位执行，因为只有 module 才能同时给出顶层 `await`、“下一个单元可以重新声明同名 `const`/`let`”和共享的 `globalThis`。绑定保留由此拆成两步：`resources/js-repl/bindings.mjs` 只负责找出本单元**顶层**声明了哪些名字，未被子单元覆盖的旧名字从 `@prev` 合成模块用 `let` 重新声明，合并后的名字集合再 `export` 给下一个单元。

- 名字发现用仓库自研 tokenizer（跳过字符串、模板、注释、正则、嵌套块），**不引入第三方解析器**，避免为了一个入口把 meriyah 之类的解析器连同许可证 vendored 进仓库。
- 自研扫描一定会有边界情况：因此每次组装后的源码都要先交给引擎编译，冲突（`Identifier 'x' has already been declared`）就把该名字从 carry 里摘掉、导出不存在（`Export 'x' is not defined`）就删名重试，最多 8 轮；仍然编译不过时退回“原样运行这个单元的代码”。失败单元不更新 carry 基线，所以上一步的值不会被半初始化的绑定污染。
- 由此形成一个可接受的最坏情况：扫描漏掉某个名字，效果是“这个名字不会被带到下一次调用”，而不是执行到不同的代码。

**2. 输出只走 `nodeRepl.write`。** module 没有 completion value，这与 Codex 工具说明里“要读整个对象就自己 `JSON.stringify` 后用 `nodeRepl.write` 输出”一致；`emitImage({bytes, mimeType})` 用 `ArrayBuffer.isView` 判定，兼容执行上下文（另一个 realm）里创建的 `Uint8Array`。

**3. `get_app_state` 在 JS 入口里返回**完整**索引文本，不做 diff。** Codex 的 `@oai/sky` 是索引寻址（`element_index`），而 diff 只会列出变化的行：模型若沿用一份旧索引，适配层可能把它解析成另一个真实存在的元素，形成**静默误点**。因此入口一律请求 `disableDiff: true`，由 `sky-session.ts` 自行渲染 `[index] role "title" actions=[...]`，并把索引→`elementRef` 的映射留在 Runtime（模型看不到 `ref`）。helper 的 diff 能力保留给既有的 `computer_app_state`/工具面。

**4. 动作前的状态与自动恢复。** 动作需要 observation：入口先复用该 app 最近一次 `get_app_state` 的 observation，没有就先读一次（顺带完成“未运行经 LaunchServices 透明启动 + 激活”）；`act` 遇到 `STALE_REFERENCE` 或 `ENGINE_UNAVAILABLE`（前台窗口已换、helper 窗口在最前）时自动重读并重试一次，仍失败才把错误交给模型。

**5. 子进程跑在既有会话沙箱里。** `js` 用与脚本工具相同的 `sandbox-exec` 配置启动随包 Node（`--experimental-vm-modules --no-warnings`）：只读会话工作区与运行时资源，可写 `output/` 与沙箱临时目录；截图写进沙箱临时目录，以 `file://` URL 交给模型，模型用 `await import("node:fs/promises")` 读回再 `emitImage`。每任务一个子进程（最多 4 个，超出淘汰最旧），`js_reset` 只换 `vm` 上下文不换进程，Runtime 关闭或子进程退出时释放沙箱目录。

**6. 工具名与 Codex 对齐**：模型侧是 `js` 与 `js_reset`（对应 `computer.js@1` / `computer.js_reset@1`），同样受 `computer-use` Skill 前置门禁；`computer.*` 原工具保留。

### Risks / Trade-offs

- **扫描器的边界**：正则字面量与 `/` 除法的歧义、`for (const … of …)` 之外的非典型顶层声明都可能漏判；代价被限制为“该名字不跨调用保留”，且引擎校验会兜住过度判定。若将来出现真实漏判案例，再评估是否引入解析器。
- **无 diff 的 token 成本**：每次 `get_app_state` 返回完整树；换来的是索引不会静默指向别的元素。需要用真实应用对比 token 与步数后再决定是否引入“带稳定索引的 diff”。
- **JS 入口内的逐动作确认缺失**（tasks 10.5.1）：入口是中转层，动作发生在一次工具调用内部，现有中断式确认只在工具调用边界生效（`computer_act`）。当前依赖 skill 的 Confirmations Policy 由模型主动确认；若用户要求更硬的约束，需要把确认通道下沉到工具调用内部（新的架构决策）。
- **helper 能力边界如实暴露**：`press_key` 只支持 helper 键表（`return`/`tab`/`space`/`escape`/`delete`/方向键/`a,c,v,x,z,s`）；`scroll` 只能落在当前指针位置（helper 无按元素滚动）；`click` 只支持左键单击，右键语义走 `perform_secondary_action`。这些都以明确报错结束，不做静默降级。

### 验证记录

2026-09-26，本机 macOS arm64：

- 定向测试：`apps/agent-runtime/src/computer-use/{bindings,js-repl,sky-session,control-gate,skill-gate,tools,approval,graph-capture,volatile-images}.test.ts`、`apps/agent-runtime/tests/{js-entry,js-tools,computer-use-integration,runtime-process,package-build}.test.ts`、`apps/desktop/src/main/computer-use-provider.test.ts` 全部通过（53 项）。
- `js-entry.test.ts` 用真实子进程验证：文档里的 `globalThis.sky = (await import("@oai/sky")).sky` 引导、`get_app_state` 文本回传、`const` 跨调用保留与重声明、单元抛错后旧绑定仍在、`emitImage` 字节到达宿主、顶层静态 import 按 Codex 文案被拒、`js_reset` 后绑定清空，以及 `element_index` → `elementRef` 的解析（文本里不出现 `ref`）。
- `js-tools.test.ts` 在真实沙箱里验证：单元可读写会话 `output/`、`nodeRepl.cwd` 是会话根、`sky.list_apps` 请求到达 provider、图像变成 asset 事件、未加载 skill 时 `SKILL_NOT_LOADED`、读取会话工作区之外的临时文件被沙箱拒绝（EPERM）、参数校验（空 `code`、越界 `timeout_ms`）生效。
- 打包：`apps/agent-runtime` 构建新增 `scripts/copy-js-entry.mjs`，把 `resources/js-repl` 复制到 `dist/js-repl`；`scripts/test-packaged-macos.mjs` 同步复制该目录，并用打包后的 Node 跑一次真实单元（断言输出 `2`），缺失即打包冒烟失败。
- Desktop provider：`list-apps` 与 `app-state` 从“不支持的指令”改为放行（原先只有 `permissions/observe/capture/act`，JS 入口的 `list_apps`/`get_app_state` 会被拒）。
- 提交前一次性验证：`pnpm typecheck` 通过；`pnpm lint` 通过（交互契约 139 项）；`pnpm test` 158 个文件通过、2 跳过，996 个用例通过、2 跳过；`pnpm test:e2e:packaged:macos` 通过（含新的入口探针）；`pnpm test:e2e:local` 7 项通过、1 项失败（既有 `persists the selected Token Plan image API and default model in settings`）。
- 环境问题（非本次改动）：一次 `pnpm test:e2e:local` 里 `opens the native guidance window only when a permission is missing` 报 `ENGINE_UNAVAILABLE: helper client closed`，原因是本机残留了 13:20 启动的旧 `actiondriver-computer-use` 进程占着 `/var/folders/…/actiondriver-computer-use.sock`；终止该残留进程后该用例单独重跑通过，整组回到 7 通过 / 1 既有失败。开发期重跑 e2e 前建议先确认没有遗留 helper 进程。
