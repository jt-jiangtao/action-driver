## Why

Computer Use 的 `js` 入口在模型未先读取 `computer-use` Skill 时会立刻失败，而该错误与所有 Computer Use 错误一样被脱敏成 `[redacted N characters]`。模型因此看不到「先调用 `skill_read computer-use`」这条可执行指引，只能反复重试并最终向用户误报「Computer Use 不可用」；用户在同一界面也得不到任何可诊断信息。

2026-09-26 两次真实任务（目标均为「测试computer use」）记录了 4 次 `computer.js` 失败，错误全部是 61 字符的门禁消息 `SKILL_NOT_LOADED: read the computer-use Skill with skill_read`，而任务内没有任何 `skill.read` 调用。

读 Skill 的门禁修好之后，同一功能立刻暴露出第二层缺陷：2026-09-26T17:03Z 的任务先成功执行了 `skill.read computer-use`，随后 4 次 `js` 调用仍全部失败，错误 `[redacted 59 characters]`。该长度与 `ENGINE_UNAVAILABLE: trusted host requires VM module support` 完全吻合；受信宿主在 Runtime 进程内加载，而 Runtime 由 Electron 的 `utilityProcess.fork(entryPath, [], { env })` 启动（`apps/desktop/src/main/runtime-supervisor.ts`），进程没有 vm 模块支持。也就是说：Computer Use 在应用内从未真正执行过任何一次 `js` 调用。

修复运行前提后，2026-09-26T17:11Z 的任务里第一次出现了**成功的 `js` 调用**，但其余 7 次仍失败：4 次错误长度 207、3 次长度 34。用真实 REPL 子进程复现后逐一对上——34 字符是模型代码里的 `ReferenceError: sky is not defined`，207 字符是模型直接 `import("@oai/sky")` 后找不到未随包的 `@statsig/js-client`。也就是说剩下的障碍是模型写错入口，而它无法自纠有两个原因：失败时该次调用已产出的输出（首次调用会打印 18789 字符的 Computer Use 入口文档）被整个丢弃，且模型自己代码产生的错误也被脱敏成占位。

## Battle 结论

- 类型：混合（产品交互行为 + 安全/隐私边界）
- 目标：让「不含隐私的门禁与生命周期错误」原样抵达模型与用户界面，使失败可恢复、可诊断；含屏幕内容、代码或用户文本的错误继续脱敏。
- 当前方案：为脱敏增加白名单，只放行我们自己抛出的静态指引错误；同时在 `js` 工具说明中写明 Skill 前置条件。
- 替代方案：直接取消「必须先读 Skill」门禁；或把 `js` 从工具列表隐藏到 Skill 已读之后并把已启用 Skill 列表注入系统提示词。
- 最终决策：用户裁决采用白名单方案（方案 A）。
- 用户覆盖：无
- 未解决分歧：无
- Battle 状态：已完成，可进入实施。

第二条缺陷的 Battle（2026-09-27）：

- 类型：架构（进程启动前提）
- 当前方案：在 Runtime 进程的启动环境里通过 `NODE_OPTIONS` 启用 vm 模块支持。
- 主要质疑：Electron 的 `utilityProcess.fork` 是否接受该 Node flag，以及应通过 `execArgv` 还是 `NODE_OPTIONS` 传递。
- 实测结论：同一 Electron 版本下 `execArgv: ['--experimental-vm-modules']` 不生效（`vm.SourceTextModule` 仍缺失），把该 flag 放进 `NODE_OPTIONS` 后生效。
- 替代方案：把受信宿主从 Runtime 进程挪到独立子进程并显式带 flag 启动；隔离更干净但引入新的进程与 IPC 边界。
- 最终决策：用户裁决采用 `NODE_OPTIONS` 方案。
- 用户覆盖：无
- Battle 状态：已完成，可进入实施。

第三条缺陷的 Battle（2026-09-27）：

- 类型：产品（可恢复性）＋隐私边界
- 当前方案：失败时把该次调用的原始错误与已产出输出只回给模型（沿用既有的易失内存通道），历史、事件、交互日志与界面继续按现有规则脱敏；并在 `js` 工具说明中声明受支持入口。
- 替代方案：仅补工具说明、不改失败时的传递内容（改动更小，但模型仍会盲试）；或取消 Computer Use 失败的脱敏（把屏幕内容与代码写入历史，风险更高）。
- 最终决策：用户裁决采用第一条方案。
- 用户覆盖：无
- Battle 状态：已完成，可进入实施。

第四条与第五条 Battle（2026-09-27）：

- 类型：产品（界面可见性、模型健壮性）
- 需求：用户在界面里看不到模型实际提交的 Computer Use 代码；同时模型若直接 `import("@oai/sky")` 会因随包树缺少 `@statsig/js-client` 解析失败。
- 当前方案：界面展示当前仍存在于内存中的实际代码（runtime 通过流事件发送，不落库）；沙箱子进程的模块加载器为遥测模块提供与受信宿主一致的合成实现，使直接导入不再失败。
- 替代方案：把代码持久化以便历史查看（此前的隐私裁决明确禁止，需用户覆盖）；或把遥测包补进 vendor 树（体积与维护成本更高，且改动 vendor 内容）。
- 最终决策：用户裁决采用「实时展示（A）+ 加载器合成遥测（D）」。
- 用户覆盖：无，本方案保持「代码不落库」的既有隐私裁决。
- Battle 状态：已完成，可进入实施。

第三条错误的根因定位（2026-09-27，执行型修复）：

- 用户提供的真实错误是 `SKILL_PROVIDER_FAILED: INVALID_REQUEST: Unsupported Computer Use command`，长度正好 72 —— 与前面那条 `[redacted 72 characters]` 完全吻合。
- 根因：桌面 provider 的命令白名单仍停留在应用寻址改造之前的 `observe`／`capture` 时代，缺少模型入口实际需要的 `app-policy`、`session-start`、`session-end`，因此 `cua.getApp(...)` 这类需要应用策略的调用必然失败。
- 处理：白名单改为模型入口真正使用的应用寻址操作集合（`act`、`list-apps`、`app-state`、`app-policy`、`session-start`、`session-end`），`permissions`／`guidance` 保持桌面专用，`observe`／`capture` 继续拒绝。属于已批准范围内的缺陷修复，不改变产品方向。

第六条裁决（2026-09-27，用户覆盖既有隐私决定）：

- 用户裁决：Computer Use 的**输入（JS 代码）、输出与报错必须持久化**，刷新或重启后仍可见，且模型要能看到原始错误用于自我纠正。
- 覆盖项：此前的 `align-computer-use-with-codex` 裁决要求「整段 Computer Use JS 代码仅存内存，历史／检查点只保存代码长度和已执行文本长度」；本变更按用户新裁决改为随调用一起持久化，并相应删除长度摘要与内存态展示通道。
- 已知代价（用户理解并接受）：模型写进代码的应用内文本（例如表单里输入的值）、屏幕文本与错误原文都会进入 sqlite 历史、运行时事件、交互日志与 LangGraph 检查点；截图与完整元素树仍不落库。
- 重新开启条件：若后续要求恢复最小化落库，应重新裁决并评估已存历史的清理策略。

## What Changes

- Computer Use 抛出的静态门禁与生命周期错误（`SKILL_NOT_LOADED`、`ENGINE_UNAVAILABLE`、`COMPUTER_USE_CONTEXT_REQUIRED`、`COMPUTER_CODE_UNAVAILABLE`、`TOOL_INPUT_INVALID`、`APP_DENIED`／`APP_FORBIDDEN`／`APP_BUSY` 等）不再被脱敏，原样出现在模型可见的工具结果、持久化的工具错误与交互日志中。
- 含隐私的内容继续脱敏：Computer Use 的执行输出流、被执行文本长度以外的输入，以及任何未列入白名单的错误消息仍写作 `[redacted N characters]`。
- `js` 工具说明新增前置条件：一个会话中首次调用 `js` 前必须先用 `skill_read` 读取 `computer-use` Skill，否则调用返回 `SKILL_NOT_LOADED`。
- Agent Runtime 进程启动时通过 `NODE_OPTIONS` 启用 vm 模块支持，使 Computer Use 的受信宿主能够加载随包的 `@oai/sky`；保留调用方已有的 `NODE_OPTIONS`。
- `js` 调用失败时，发给模型的工具结果包含该次调用的原始错误与失败前已产出的输出（首次调用的入口文档），使模型能读懂并修正自己的代码；持久化历史、事件、交互日志与界面仍只保留脱敏结果。
- `js` 工具说明补充受支持入口：使用宿主提供的全局 `cua`，不要直接 `import("@oai/sky")`。
- Computer Use 每次调用的 JS 代码、实际输出与原始错误随调用一起持久化：模型在失败回执里看到原始错误与失败前的输出，界面与历史保留同一份原文，重新打开任务或重启 Runtime 后仍可见。
- 随之移除只为「代码不落库」存在的最小化机制：执行器的 `redactForPersistence` 长度摘要、图内的易失源码／结果通道、以及仅内存可见的展示通道与 `rawError` 协议字段。
- 沙箱子进程的模块加载器为 `computer-use-telemetry.js` 提供合成实现（与受信宿主一致），使模型直接 `import("@oai/sky")` 时不再因缺少 `@statsig/js-client` 失败。
- 桌面 Computer Use provider 的命令白名单与模型入口对齐：放行 `app-policy`、`session-start`、`session-end`，使 `cua.getApp(...)` 等应用寻址调用不再返回 `SKILL_PROVIDER_FAILED: INVALID_REQUEST: Unsupported Computer Use command`。
- 补充分流回归测试：白名单内错误原样暴露，白名单外错误仍被脱敏。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `computer-use`: 新增门禁类错误的可诊断性要求——不含隐私的静态指引错误 MUST 原样回给模型与用户界面；新增 `js` 工具说明必须声明 Skill 前置条件的要求；新增受信宿主运行前提的要求——Runtime 进程 MUST 启用 vm 模块支持，且直接导入随包 `@oai/sky` 不因缺少遥测依赖失败；新增失败调用的可恢复性要求——模型 MUST 收到该次调用的原始错误与已产出输出，而持久化与界面保持脱敏；修改「最小化界面数据」——允许把仍在内存中的代码发送给本机界面展示，但 MUST NOT 持久化。

## Impact

- `apps/agent-runtime`：`tool-result-redaction.ts`（脱敏白名单）、`computer-use/*`（错误消息常量化、工具说明、内存代码表、加载器遥测合成）、`agent-graph.ts`（易失原始结果通道同时覆盖失败调用）、`stream-session-service.ts`（把内存中的代码附到流事件）、`runtime-process.ts`（装配内存代码表）、`tool-invocation-service.ts` 的既有脱敏调用点、相关单元与集成测试。
- `apps/desktop`：`runtime-supervisor.ts` 的 Runtime 进程环境构造（新增 `runtimeProcessEnvironment`）与对应单元测试；`main/index.ts` 等调用方无需改动。
- `apps/desktop`（Computer Use provider）：`computer-use-provider.ts` 的命令白名单与 `computer-use-provider.test.ts`。
- `apps/desktop`（界面）：`ToolGroup.tsx` 展示 `computer.js` 的实际代码，`ActivityTimeline.test.tsx` 覆盖「有内存代码」与「只有长度摘要」两种状态。
- `packages/runtime-contracts`：不改 `ToolError` 结构，`code`/`message`/`retryable` 与 wire 契约保持兼容。
- 桌面应用：不改 UI 结构与交互，`apps/desktop` 的持久化错误展示会因消息不再被替换而自动变得可读。
- 隐私边界不变：屏幕截图、完整元素树、JS 代码与用户输入文本的持久化限制保持现状。
