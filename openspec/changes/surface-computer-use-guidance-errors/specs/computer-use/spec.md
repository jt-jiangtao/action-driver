## ADDED Requirements

### Requirement: 门禁错误的可诊断性
系统 SHALL 把静态、不含屏幕内容、JavaScript 代码与用户文本的 Computer Use 指引错误原样回给模型与用户界面，使失败可诊断、可恢复。这类错误至少包含 Skill 前置条件未满足（`SKILL_NOT_LOADED`）、引擎不可用、执行上下文缺失、待执行代码不可用、工具参数无效与应用授权结果（`APP_DENIED`、`APP_FORBIDDEN`、`APP_BUSY`）。系统 MUST 继续对可能含隐私的内容脱敏：Computer Use 的执行输出、JavaScript 代码、用户输入文本以及未列入该范围的错误消息在历史、事件、交互日志与模型可见结果中 MUST 仅保留脱敏占位。

#### Scenario: 未读 Skill 就调用 js
- **WHEN** 模型在一个会话中未先读取 `computer-use` Skill 就调用 `js`
- **THEN** 工具失败结果与用户界面显示 `SKILL_NOT_LOADED` 及其“先用 `skill_read` 读取 `computer-use`”指引，而不是 `[redacted N characters]` 占位

#### Scenario: 应用授权被拒绝
- **WHEN** 用户拒绝或禁止某个应用的授权请求
- **THEN** 失败结果原样显示 `APP_DENIED` 或 `APP_FORBIDDEN`，模型可据此向用户解释下一步

#### Scenario: 含隐私的错误消息
- **WHEN** 失败消息可能包含屏幕内容、JavaScript 代码或用户输入文本
- **THEN** 历史、事件、交互日志与模型可见结果只保留脱敏占位，不出现上述原文

### Requirement: js 工具说明声明 Skill 前置条件
系统 SHALL 在模型可见的 `js` 工具说明中声明：同一会话中首次调用 `js` 前必须先用 `skill_read` 读取 `computer-use` Skill，否则调用失败并返回 `SKILL_NOT_LOADED`。

#### Scenario: 模型读取工具说明
- **WHEN** 模型查看 `js` 工具的定义与说明
- **THEN** 说明文本包含先读取 `computer-use` Skill 的前置条件与失败码 `SKILL_NOT_LOADED`

### Requirement: 受信宿主的运行前提
系统 SHALL 在启动 Agent Runtime 进程时启用 Node 的 vm 模块支持，使 Computer Use 的受信宿主能够加载随包的 `@oai/sky` 源码；启用方式 MUST 在 Electron 的 utility process 下真实生效，MUST NOT 依赖该环境会忽略的启动参数。系统 MUST 保留调用方已有的 `NODE_OPTIONS` 取值。模型代码直接导入随包的 `@oai/sky` 时，系统 SHALL 以与受信宿主一致的合成遥测模块替换其遥测依赖，使该导入不因缺少 `@statsig/js-client` 失败。该前提缺失时，`js` 调用 SHALL 以 `ENGINE_UNAVAILABLE` 失败，MUST NOT 静默失败或伪造成功。

#### Scenario: 应用内首次真实执行 Computer Use
- **WHEN** 用户在使用已启用 vm 模块支持的 Runtime 进程的应用里调用 `js`
- **THEN** 受信宿主初始化成功，`js` 代码进入真实执行而不是在初始化阶段失败

#### Scenario: 运行前提缺失
- **WHEN** Runtime 进程没有 vm 模块支持
- **THEN** `js` 调用返回可诊断的 `ENGINE_UNAVAILABLE` 错误，供模型与用户定位

#### Scenario: 模型直接导入随包 sky
- **WHEN** 模型在 `js` 单元中执行 `await import("@oai/sky")`
- **THEN** 导入成功，不因缺少 `@statsig/js-client` 报错

### Requirement: 模型入口所需操作必须可达
系统 SHALL 让 Computer Use 的 JavaScript 入口能够请求该入口实际使用的全部桌面操作，至少包括应用策略查询、会话监督开始与结束、应用状态与应用列表；MUST NOT 以「不支持的命令」拒绝这些操作。桌面专用的权限查询与授权指引 MUST NOT 因该入口而对外开放，已废弃的观察式命令 MUST 继续被拒绝。

#### Scenario: 入口查询应用策略
- **WHEN** 模型执行 `await cua.getApp("Calculator")`，入口向桌面请求该应用的策略
- **THEN** 请求被接受并返回策略，而不是 `SKILL_PROVIDER_FAILED: INVALID_REQUEST: Unsupported Computer Use command`

#### Scenario: 入口开始与结束会话监督
- **WHEN** 入口在一个回合开始或结束时请求会话监督
- **THEN** 请求被接受，覆盖提示与 Esc 监听按既有行为工作

### Requirement: 审批请求必须可持久化
系统 SHALL 只把审批请求的冻结字段（请求标识、任务、会话、目标应用与是否允许持久授权）写入运行时事件负载；MUST NOT 把 AbortSignal、DOM、Electron 句柄等运行时对象带进持久化内容。审批请求写入失败时 SHALL 以可诊断错误结束，而不是让审批流程静默卡住。

#### Scenario: 入口带中止信号请求审批
- **WHEN** 入口携带 AbortSignal 请求应用授权
- **THEN** 持久化的审批事件只包含冻结字段，等待与裁决流程照常进行

### Requirement: 失败调用的可恢复性
`js` 调用失败时，系统 SHALL 把该次调用的原始错误与失败前已产出的输出一并回给模型，使模型能据此修正自己的代码；对首次调用，这些输出包含 Computer Use 入口文档。该失败结果 SHALL 与历史、事件、交互日志和用户界面保持一致（同一份原文，不再有脱敏占位），使用户事后复盘时看到的内容与模型当时看到的一致。`js` 工具说明 SHALL 声明受支持的入口是宿主提供的全局 `cua`，并明确不要直接 `import("@oai/sky")`。

#### Scenario: 失败前已打印入口文档
- **WHEN** 模型的一次 `js` 调用先输出了入口文档、随后因代码错误失败
- **THEN** 下一次模型请求能看到该文档与该次调用的原始错误，历史与界面保留同一份内容

#### Scenario: 模型使用错误入口
- **WHEN** 模型查看 `js` 工具说明
- **THEN** 说明指明入口是全局 `cua` 并禁止直接导入 `@oai/sky`

## MODIFIED Requirements

### Requirement: 最小化界面数据
系统 SHALL 只把屏幕截图写入会话临时目录，并在 Computer Use 会话结束（闲置超时、被回收、重置、Esc 取消或 runtime 退出）时删除；MUST NOT 把原始截图、窗口图像或完整元素树写入会话历史、生成资产或 LangGraph 检查点。JavaScript 入口发出的图片 SHALL 进入短期内存存储，过期后 MUST 要求重新观察。Computer Use 每次调用的 Javascript 代码、实际输出与失败原因 SHALL 持久化，以便模型自我纠正、用户事后诊断，并在重新打开任务或重启 Runtime 后仍然可见；系统 MUST NOT 因此把屏幕截图或完整元素树一并写入历史。若观察内容会发送到远端模型，系统 SHALL 在授权引导中向用户说明这一数据流。

#### Scenario: 屏幕采集
- **WHEN** 系统采集屏幕用于观察
- **THEN** 截图只存在于会话临时目录与短期内存存储，会话结束后被删除

#### Scenario: 检查历史数据
- **WHEN** 开发者检查本地历史与事件
- **THEN** 不包含原始屏幕内容、完整元素树与实际输入的文本

#### Scenario: 界面展示当前代码
- **WHEN** 用户展开一次 Computer Use 工具调用，或在重启 Runtime 后重新打开该任务
- **THEN** 卡片始终按 JavaScript 展示该次调用的源码，并展示该次调用实际打印的文本与原始错误（如有）
