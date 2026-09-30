# Action-Driver 对齐 Codex 的能力与机制评估

- 评估日期：2026-09-27。
- 状态：待裁决，仅供讨论；不是已批准的设计或实施计划。
- 保存授权：用户要求将评估写入文档，后续再裁决。
- 已确认意图：工具在名称与功能上对齐 Codex；评估 Local、Worktree、Web，以及工具、插件和相关机制的完整建设范围。
- 尚未裁决：运行核心、项目与环境模型、审批政策、云端数据所有权、阶段顺序及全部实施范围。
- 本轮范围：只保存评估，不修改产品代码、既有路线图或 OpenSpec 规划；用户于本轮明确授权将已有工作区改动按主题本地提交。

## 1. 结论与评估边界

这是平台级升级，超出补齐通用工具的范围。Action-Driver 可以复用现有桌面、模型连接、事件流、文件卡片和 Computer Use，但需要建立项目与执行环境模型，并新增 Worktree、云端执行、插件运行时和多 Agent 等子系统。

本评估依据当前源码、OpenSpec、Codex 官方文档与当前 Codex 会话暴露的工具。源码存在不代表能力已经验收通过；工作区仍有 Computer Use 相关未提交修改，本次没有运行测试。OpenSpec 中有尚未完成的旧 change，任务勾选情况不能直接当作当前代码能力的准确清单。

Codex 的工具集合随版本、客户端、运行模式、插件和账户能力变化。本会话可调用工具、官方公开协议和桌面宿主能力应分别标注，不能当作所有版本的固定全集。

本次讨论没有完成架构 Battle；下面的推荐、阶段顺序和内部对象均为待裁决方案。文档保存不意味着同意实施，也不改变既有约束。

## 2. 对齐目标与成功标准

| 层次 | 对齐内容 | 可行性与限制 |
| --- | --- | --- |
| 工具契约 | 名称、命名空间、参数、返回值、错误和生命周期 | 可以逐项实现、验证 |
| 运行机制 | 会话、环境、权限、配置、插件、Hooks、子 Agent | 可以建设，但需要架构改造 |
| 产品行为 | Local、Worktree、Web、预览、Review、自动化 | 可以分阶段实现 |
| 服务与生态 | 官方插件目录、托管连接器、账户授权、云服务和模型专有能力 | 依赖服务、协议和授权，不能仅靠复制代码获得 |

“对齐”不只要求名称相同，还应验证输入形式、schema、默认值、结果内容、错误行为、可用条件、取消、超时、后台执行、恢复与界面交互。内部实现可不同，但差异不能被隐藏为完整兼容。

需要先固定带版本的兼容基线，并记录每项能力的来源、客户端、模式、环境、证据、差异与未验证项。成功标准是兼容矩阵内的承诺均有可重复的行为证据，而不是工具名称数量一致。

### 客户端与执行环境是两个维度

- 客户端：桌面、网页；CLI 和 IDE 是需另行列入范围的客户端。
- 执行环境：本地项目、Git worktree、远程机器、云端沙箱。

Web 是客户端，不必然等于 Cloud。Codex Local 和 Worktree 都可在用户电脑运行，Cloud 在远程环境运行。网页控制远程本机，与在云沙箱执行是不同能力。

## 3. 运行核心路线比较

| 路线 | 工作内容 | 收益 | 主要代价 |
| --- | --- | --- | --- |
| A：接入 Codex app-server | 保留 Action-Driver 产品界面，接入 Codex 核心会话和运行机制 | 核心行为容易保持一致，减少重复实现 | 验证模型连接、认证、打包和自定义能力；仍需建设 Web、云调度与宿主能力 |
| B：继续 LangGraph，实现兼容机制 | 保留现有核心，逐项实现 Codex 工具和运行语义 | 多模型和产品控制权较强 | 实现量最大，长期承担兼容追踪、差异处理与测试成本 |
| C：同时提供两个核心 | 两个运行核心通过同一产品入口使用 | 保留现有能力，逐步迁移 | 双核心的事件、权限、恢复和工具行为容易分裂 |

**待裁决推荐：** 如果“所有机制对齐”是硬目标，先验证 A。如果现有 OpenAI-compatible／Anthropic 模型连接必须完整保留，而 Codex 核心无法满足，再选择 B，并明确为经过验证的兼容实现。C 只适合作为有退出条件的迁移方案。

官方将 app-server 定位为产品深度集成接口，包含认证、历史、审批和流式事件，但部分传输仍处于实验状态。不能把它直接视为已经完成的生产云服务，也不能据此承诺整个桌面产品或全部插件生态已经可复用。

选型验证至少需要覆盖：现有模型协议、视觉与生图、自定义工具、Computer Use、Skill 与插件、事件映射、历史迁移、离线启动和打包。未完成验证前不应替换现有核心。

## 4. 当前基础与差距总表

“调整”表示已有基础可继续用；“新建”表示本次检查未发现完整子系统。规模是相对复杂度，不是工期承诺。

| 子系统 | 当前基础 | 需要调整 | 需要新建 | 规模 |
| --- | --- | --- | --- | --- |
| 项目与目录 | 会话独立目录 | cwd 不再固定由 session 推导 | 项目注册、多根目录、环境绑定 | 大 |
| 会话模型 | task/session/thread、消息 | 明确 Thread／Turn／Item | fork、归档、元数据与协调关系 | 大 |
| Local | macOS 会话沙箱 | 用户项目与共享工作文件 | 项目信任、目录授权 | 大 |
| Worktree | 未发现完整实现 | 接入环境与文件接口 | 创建、setup、handoff、归档、恢复 | 很大 |
| 云端执行 | 本地 HTTP／WS | 独立启动和执行适配 | 调度、沙箱、账户、远程存储 | 很大 |
| Web | React renderer | 去除桌面桥接依赖 | 登录、连接、下载和预览 | 大 |
| 文件与图片 | 上传、输出登记、图片资产 | 统一目录、环境路径 | patch、看图、文件观察 | 中到大 |
| 命令进程 | 执行至结束或超时 | 接口和生命周期 | PTY、会话、续读与输入 | 大 |
| 工具系统 | 静态 Registry、JSON 参数 | 命名空间、内容类型和可用条件 | 延迟发现、代码编排、续等 | 大 |
| 配置与权限 | 主提示词、grants、应用审批 | 分层配置和政策计算 | 规则、审批协调、受管约束 | 大 |
| Skills | 发现、读取、安装、编辑 | 来源、作用域、显式调用 | 项目发现与兼容导入 | 中 |
| 插件与 MCP | Skill 管理基础 | 整合能力发现 | 安装、认证、进程、资源、更新 | 很大 |
| Hooks | 未发现完整实现 | 接入生命周期 | 事件、匹配、信任、执行 | 大 |
| 子 Agent | 单主 Agent Loop | 多上下文和预算 | 派生、消息、等待、取消、汇总 | 很大 |
| 计划与提问 | 时间线、等待用户 | 与运行状态分离 | 结构化计划、同步／异步提问 | 中 |
| 自动化与目标 | 普通任务 | 后台调度边界 | cron、heartbeat、Goals、通知 | 大 |
| 上下文与记忆 | 历史、checkpoint | 长上下文管理 | compact、记忆提取与控制 | 大 |
| Git／Review／PR | 未发现完整产品实现 | 文件变更事件和 UI | diff、stage、commit、PR、评论 | 大 |
| Browser／Computer | Computer Use 已有对齐基础 | 环境、权限、版本一致性 | Browser 表面与远程适配 | 大 |
| 运维与兼容验证 | 测试、日志、恢复 | 多环境与版本治理 | 契约测试集、云审计和配额 | 大 |

### 当前代码锚点

- `packages/runtime-contracts/src/tool-protocol.ts`：扁平模型工具名、JSON object 输入、文本／图片／JSON 输出、session workspace 类型。
- `apps/local-runtime/src/execution/session-workspace.ts`：会话目录及 input/output 路径解析。
- `apps/local-runtime/src/execution/session-execution-context.ts`：从任务会话推导工作目录。
- `apps/local-runtime/src/execution/session-sandbox.ts`：macOS 沙箱与 output 写入范围。
- `apps/local-runtime/src/execution/tools.ts`、`process-runner.ts`：脚本及进程执行。
- `apps/local-runtime/src/runtime-entry.ts`：强制要求 Electron parentPort 的启动入口。
- `apps/local-runtime/src/runtime-process.ts`：本地运行装配和静态工具注册。
- `packages/agent-runtime/src/agent-graph.ts`：Agent Loop、逐个工具执行及图片上下文。
- `packages/agent-runtime/src/tool-policy.ts`：基于 grants 的允许／拒绝。
- `packages/agent-runtime/src/stream-session-service.ts`：宿主无关的流会话编排。
- `packages/model-connections/src/index.ts`：模型连接契约；`packages/model-provider-runtime/src/provider-adapters.ts`：供应商协议实现。
- `apps/local-runtime/src/agent-files/agent-file-store.ts`：个人与内置 Skill 管理。
- `apps/local-runtime/src/media/session-input-file-store.ts`、`session-output-store.ts`：输入材料和交付快照。
- `apps/desktop/src/renderer/src/services/task-output-open.ts`：依赖桌面桥接打开交付文件。
- `docs/roadmap.md`、`openspec/specs/agent-tool-runtime/spec.md`：现有方向和自动执行政策。

## 5. 项目、聊天与环境模型

当前从任务所属会话创建目录，适合独立文件任务，但不能自然表达多个聊天共享项目、聊天切换 worktree、同项目在不同机器执行，以及不关联 Git 的文档任务。

建议职责分离如下；这些是内部设计候选，不代表必须复制 Codex 私有数据库表。

| 对象 | 职责 |
| --- | --- |
| Project | 用户目录／仓库、Git 信息、项目配置 |
| Thread | 对话历史、模型、计划、关联关系 |
| Turn | 一轮请求、运行状态、取消、审批 |
| Environment | 执行位置、cwd、平台、能力 |
| Host | 本机、远程机器、云服务连接与健康 |
| Artifact／Attachment | 文件引用、来源、归属、交付记录 |

输入输出统一应落在 Environment 的工作目录：Local 共享项目文件，Worktree 使用独立 checkout，无项目聊天使用管理目录。聊天记录独立存储。共享目录与会话隔离的权限策略须分别定义，不能无条件沿用旧的“会话拥有全部文件”假设。

## 6. 工具协议与工具清单

### 协议调整

当前协议的直接限制是扁平名称、强制 JSON object 输入，以及缺少通用资源与多媒体结果。需要按兼容基线记录命名空间、输入形式、schema、默认值、内容类型、错误、模式、取消、超时和恢复。

| 工具／工具组 | 所需行为 |
| --- | --- |
| `exec_command`／`write_stdin` | cwd、PTY、输出预算、提前返回、进程 ID、输入、续读、退出与进程树取消 |
| `apply_patch` | 固定补丁语法、路径处理、增删改、冲突和失败反馈 |
| `view_image` | 本地图片、视觉上下文、分辨率策略、模型真实错误 |
| `update_plan` | 步骤、状态更新、历史恢复、界面投影 |
| `request_user_input`／`request_user_input_async` | 问题 ID、选项、回答关联、等待及异步回答 |
| `functions.exec`／`functions.wait` | 受限代码调用工具、结果组合、并行、续等 |
| 子 Agent 工具组 | `spawn_agent`、`followup_task`、`send_message`、`wait_agent`、`interrupt_agent`、`list_agents`；派生上下文与状态关联 |
| MCP 资源工具 | `list_mcp_resources`、`list_mcp_resource_templates`、`read_mcp_resource`；资源发现、模板、读取 |
| 工具发现 | 按需检索和加载工具；准确名称与 schema 尚需按选定基线核实 |
| Goals | `create_goal`、`get_goal`、`update_goal`；持续目标、预算、状态 |
| 时间 | `clock.curr_time`、`clock.sleep`；获取时间、可打断等待 |
| Web 工具组 | 搜索、读取、跟随链接、查找、PDF 截图；天气、金融、体育等结构化查询需相应后端 |
| 媒体与依赖 | 生图、工作区依赖，以及音视频等结果按基线表面核实 |

上述名称部分来自当前会话工具，而非全部来自公开固定协议。具体命名空间、参数与可用条件需在阶段 0 固定，不可将此表直接当作已完整确认的 schema。

读取和搜索可复用 Shell 中的 `cat`、`sed`、`rg`、`rg --files`，无需为数量对齐另造读取／搜索工具。现有 `shell_run` 与进程会话功能存在实质差距；Computer JS 的持久环境也不等于通用 `functions.exec`，权限与可调用对象不同。

已有 `load_workspace_dependencies`、生图、网页搜索与读取、Skill 读取／安装、Computer `js/js_reset` 应复用并核实差异。同名不同语义的工具不得标记为已兼容。

## 7. Skills、插件、MCP 与 Hooks

保留现有 Skill 管理基础，但插件运行时需要独立建设。

| 部分 | 建设范围 |
| --- | --- |
| 包格式 | manifest、身份、版本、来源、依赖、资源路径 |
| 安装 | 本地／仓库／目录、启停、更新、卸载、失败回滚 |
| Skills | 项目／用户／插件来源、冲突、元数据发现、按需读取、显式调用 |
| MCP | STDIO／HTTP、工具与资源、认证、超时、重连、进程生命周期 |
| 认证 | 凭据隔离、OAuth、撤销、过期、重新授权 |
| Hooks | 事件、匹配、结果、超时、信任及定义变化 |
| 能力发现 | 启用注册、禁用撤销、延迟加载 |
| 多环境 | 按环境准备插件、脚本与依赖；本地安装不表示云端可执行 |
| 可选 UI | 受控资源展示、宿主通信、权限边界 |

当前官方同时支持 portable `plugin.json` 和 `.codex-plugin/plugin.json` 兼容格式，应分别解析，不能仅重命名文件。插件 Hooks 需要独立信任机制。

兼容插件包不意味着官方连接器自动可用。第三方 OAuth 应用、API 权限和服务端必须满足接入条件；依赖 OpenAI 专有连接器的能力应列为外部依赖。

## 8. 配置、权限与审批

现有工具政策主要是本轮有 grant 即允许，OpenSpec 还规定新调用不进入人工审批。完整对齐需要支持：

- 全局、项目、运行时覆盖与受管配置的优先级。
- 项目信任及不可信项目配置的跳过。
- 沙箱与审批分离；可读／可写根目录和网络策略。
- 命令规则、MCP 工具策略、应用授权。
- 审批请求、拒绝、过期、取消、断线恢复。
- 父子 Agent 和不同环境的权限传播。
- Hooks、插件启用与脚本执行的独立信任。

现有自动运行可成为一个政策选项，但不能作为唯一机制。运行时政策与本仓库开发 Agent 的治理规范是两件事；引入产品审批不应混淆开发工作流。

## 9. Local、Worktree、Web、Cloud 与 Remote

| 模式 | 建设范围 |
| --- | --- |
| Local | 项目注册、目录选择、可信 cwd、多根授权、共享并发、文件观察、配置与 Git 信息 |
| Worktree | 仓库检测、起始 ref、异步创建、setup、进度、分支约束、handoff、未提交内容保护、归档快照、恢复 |
| Web 客户端 | 独立启动、登录、连接、上传／下载／预览、审批、运行控制；去除 Electron 依赖 |
| Cloud 执行 | 模板、仓库检出、setup／maintenance、依赖、网络、凭据、生命周期、调度、配额、存储、恢复 |
| Remote Host | 注册、认证、重连、能力发现、远程路径和进程；与云沙箱区分 |

Worktree 不能只封装 `git worktree add`；需要处理分支占用、未提交修改、忽略文件、正在运行的进程、handoff 冲突和失败恢复。归档必须先保存可恢复内容。

Cloud 不是把本地 HTTP 监听地址改成公网。当前 Electron parentPort 启动、macOS 沙箱和运行时路径需要拆为核心 Runtime、桌面启动适配器与远程／云端执行适配器。现有 loopback token 不是多用户云端身份系统。

网页打开文件使用预览和下载；不能依赖桌面桥接。云端不操作用户本机 GUI 的既有裁决仍有效，除非后续明确重开该决策；远程连接本机也不能自动赋予云任务本机 GUI 权限。

## 10. 文件、状态与迁移

建议保留 SQLite 作为本地状态基础，先调整领域模型，不为了相似立即将全部记录改为 JSONL。

需要明确：

- 对话历史与可变工作文件分离。
- Thread／Turn／Environment／Project 的关联。
- 附件在环境切换后的引用解析。
- fork 的上下文复制与文件共享语义。
- 本地与远程路径的独立解析。
- 文件字节、元数据、事件和交付副本的生命周期。
- 导出、归档、恢复、删除和失败迁移。
- 云端租户隔离、对象存储和状态存储。
- 重启后的未知副作用调用不自动重复。

Codex 恢复聊天保留工作目录记录，读取当前工作树；不应将恢复聊天等同于恢复旧文件版本。上传原件快照和历史成品版本可作为 Action-Driver 扩展能力，但不是已核实的 Codex 通用约定。

此前提出通过最终回复引用识别交付文件，也只是候选 Action-Driver 方案，不是已确认的 Codex 内部机制。它应与自动扫描、显式交付等方案独立比较后裁决。

旧 input/output 迁移应保护同名文件和历史引用，支持中断恢复。不能在项目与环境模型未确定前进行破坏性搬迁。

## 11. 桌面宿主与持续运行能力

| 类别 | 范围 |
| --- | --- |
| 聊天管理 | 创建、读取、fork、消息、等待、重命名、归档、已读 |
| 侧栏与项目 | 项目列表、分组、置顶、排序、导航 |
| 面板 | 文件、预览、终端、浏览器、Review |
| Git／PR | 分块 diff、stage／revert、提交、分支、PR、附件 |
| 自动化 | 独立任务、原聊天 heartbeat、并发、漏跑、通知 |
| 记忆 | 使用／贡献开关、后台提取、合并、来源、删除 |
| 长任务 | 目标预算、compact、运行中输入、暂停、恢复 |
| Browser／Computer | 版本、授权、接管、截图、环境可用条件 |
| 编辑器能力 | LaTeX 编译及其他预览器，按支持范围接入 |
| 辅助功能 | 更新、用量、分享、语音、庆祝等，独立列低优先级清单 |

宿主工具应以选定基线中真实的名称、参数和行为对齐，如 `open_in_codex`、聊天管理、worktree、自动化和插件管理；不能根据功能描述自行发明接口。

记忆、Hooks、自动化是持久子系统，不能仅新增同名函数。已有 Computer Use 入口对齐不证明 Browser、远程环境或所有应用方法兼容。

## 12. 建议阶段与验收门槛

以下是候选拆分顺序，尚未批准。每批独立进行 Battle、OpenSpec 规划和验收，不建议一个巨大 change 覆盖全部。

| 阶段 | 工作 | 验收门槛 |
| --- | --- | --- |
| 0：基线与核心选型 | 固定版本／表面、契约清单；验证 app-server 与模型及桌面接入 | 核心路线、外部依赖和未支持项明确 |
| 1：项目与环境 | 领域模型、统一目录、迁移、独立启动 | 同项目共享正确，不同环境路径和权限正确 |
| 2：核心工具 | patch、看图、进程、计划、提问、事件类型 | 正常、失败、取消、冲突、重启契约测试 |
| 3：配置与扩展 | 配置、信任、审批、Skills、MCP、插件、Hooks | 代表性插件运行，禁用撤销，凭据隔离 |
| 4：Worktree 与开发交互 | setup、handoff、归档／恢复、终端、Git／Review | 未提交内容、冲突、崩溃可恢复，不丢工作 |
| 5：编排与持续任务 | 子 Agent、代码编排、compact、Goals、记忆、自动化 | 预算、取消、恢复正确，不重复副作用 |
| 6：Web 与 Cloud | 网页、身份、调度、沙箱、文件服务、远程存储 | 浏览器独立完成任务，多用户隔离，重启恢复 |
| 7：宿主与生态 | 远程设备、预览器、插件 UI、分享、辅助工具 | 按表面与环境给出行为证据 |

Browser 与 Computer 可在环境底座稳定后独立推进，不应阻塞所有文件与插件建设。CLI／IDE 等新增客户端需明确裁决，不能由“Web”默认为已授权实施。

工期目前无法可靠承诺。先完成阶段 0，再根据接入证据和核心选择估算。阶段规模不是投入百分比，也不是完成度。

## 13. 验证方案与主要风险

### 兼容验证

- 参数、默认值、命名空间、输出、错误和可用条件。
- 长进程续读、输入、取消、主机断线。
- 共享目录编辑冲突和外部文件变化。
- Worktree 未提交、忽略文件、分支冲突和 handoff。
- MCP 认证过期、插件更新、Hook 定义变化。
- 子 Agent 权限、预算、取消、消息和结果归属。
- 云端重启、重试、租户文件访问和凭据隔离。
- 大历史恢复与压缩后的必要约束保留。
- Local／Worktree／Cloud 的同一契约测试与明确差异。

迭代期按仓库规范只运行相关定向测试，必要时补类型检查；准备提交时才运行一次全量验证。本次文档整理不需要启动产品测试。

### 风险与限制

- 不固定基线会不断追随工具和插件格式变化，无法宣称稳定兼容。
- 双核心会提高故障定位、权限审计和恢复成本。
- 共享 cwd 改变旧的会话文件隔离假设。
- 多用户云端改变数据、身份和凭据边界，不能沿用本地令牌模型。
- 插件安装、脚本执行和 OAuth 连接涉及不同信任，不能互相替代。
- 多 Agent 与自动化提高 token、运行资源和副作用并发成本。
- 恢复逻辑若重复执行命令、发送或外部写操作，会产生真实重复副作用。
- 官方托管能力、账户权限与专有服务不是开源核心保证提供的能力。
- 现有未提交修改与未完成 change 必须先明确归属，不能被新架构工作覆盖。

## 14. 现有规范冲突与待裁决项

| 现有方向 | 新目标带来的变化 |
| --- | --- |
| 每会话独立目录 | Local 可让多个聊天共享项目文件 |
| MCP 暂不考虑 | 插件和 MCP 成为核心范围 |
| 只支持 macOS | 本地可仍 macOS，云端需独立执行平台 |
| 已授予工具自动运行 | 增加可配置审批与规则 |
| 未来可迁云 | 需要落实独立入口、环境适配和身份边界 |
| 记忆与 Action Graph 重放关联 | 通用对话记忆与浏览器流程重放分开 |

优先裁决以下事项：

1. 接入 Codex app-server，还是继续自研兼容；现有多模型支持的硬约束是什么。
2. 对齐基线的版本、客户端、运行模式，以及哪些官方服务列为外部依赖。
3. Local 共享目录与无项目独立目录是否并存，如何授权。
4. 上传原件和成品历史是否保存快照，以及交付如何识别。
5. 审批、命令规则、插件和 Hook 信任政策。
6. 云端身份、文件、会话、凭据的所有权与本地迁移方式。
7. Web 控制云端与 Remote 控制本机的范围。
8. 阶段顺序、CLI／IDE 与辅助能力是否纳入首轮建设。

**Battle 状态：未完成。** 当前已公开核心替代方案与风险，但没有用户最终裁决；无已记录的覆盖项。后续裁决后，再更新路线图并创建／更新对应 OpenSpec。本文不会自动替代已有决策。

## 15. 来源

以下来源在评估时已检索并读取；内容可能随版本变化，实施前需按兼容基线复核。

- [Codex environments](https://learn.chatgpt.com/docs/environments/modes)：Local、Worktree、Cloud。
- [Codex App Server](https://learn.chatgpt.com/docs/app-server)：产品集成、协议、线程、历史和事件。
- [Projects and chats](https://learn.chatgpt.com/docs/projects)：工作目录、共享文件与聊天历史。
- [Model guidance](https://developers.openai.com/api/docs/guides/latest-model?model=gpt-5.3-codex)：工具指导、apply_patch、view_image、update_plan；与当前会话工具集区分。
- [Apply Patch](https://developers.openai.com/api/docs/guides/tools-apply-patch)：补丁行为。
- [Async tool calling](https://developers.openai.com/api/docs/guides/async-tool-calling)：应用实现的异步提问机制。
- [Config basics](https://learn.chatgpt.com/docs/config-file/config-basic)：配置层次和项目信任。
- [Agent approvals & security](https://learn.chatgpt.com/docs/agent-approvals-security)：沙箱、审批与网络。
- [Package your plugin](https://developers.openai.com/plugins/build/plugins)：portable 与兼容 manifest、插件 MCP 和 Hooks。
- [Build skills](https://learn.chatgpt.com/docs/build-skills)：Skill 发现和渐进加载。
- [Model Context Protocol](https://learn.chatgpt.com/docs/extend/mcp)：MCP 传输、认证与配置。
- [Hooks](https://learn.chatgpt.com/docs/hooks)：事件、匹配、信任。
- [Worktrees](https://learn.chatgpt.com/docs/environments/git-worktrees)：setup、handoff 与管理。
- [Cloud environments](https://learn.chatgpt.com/docs/environments/cloud-environment)：检出、准备、缓存、网络和秘密。
- [Remote connections](https://learn.chatgpt.com/docs/remote-connections)：远程本机的能力与资源。
- [Memories](https://learn.chatgpt.com/docs/customization/memories)：本地记忆与 Web 记忆边界。
- [Scheduled tasks](https://learn.chatgpt.com/docs/automations)：独立任务与原聊天持续工作。
- [Work with files](https://learn.chatgpt.com/docs/artifacts-viewer)：文件生成、预览和客户端差异。

上述链接用于支持公开行为，不证明本项目已经兼容。准确工具 schema、宿主工具集合、官方连接器接入条件和未公开的附件内部生命周期仍需补充验证。
