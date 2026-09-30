## MODIFIED Requirements

### Requirement: 通过原生服务操作 macOS 界面
系统 SHALL 通过签名内置、由 LaunchServices 启动的独立原生 helper 执行 macOS 界面观察与动作，Electron Main SHALL 经私有 Unix domain socket 与其通信；系统 SHALL 仅支持 macOS 14 及以上。
Agent SHALL 只通过持久 JavaScript 入口使用 Computer Use：模型可见工具为 `js` 与 `js_reset`，入口内提供 `cua` 对象接口（`getState`、`getApp`、`listApps`、`rewriteDocumentation`，以及应用对象上的 `getAXState`、`getScreenshot`、`getAXStateAndScreenshot`、`click`、`drag`、`scroll`、`selectText`、`setValue`、`performSecondaryAction`、`paste`、`pressKey`、`typeText`）。系统 MUST NOT 向模型暴露其他 Computer Use 工具，MUST NOT 让模型代码绕过 `cua` 直接访问系统 API 或 helper。
每个会话首次调用 `js` 时系统 SHALL 输出 Computer Use 核心文档与确认策略；观察与发现方法 SHALL 默认自动输出结果，并在传入 `{ emit: false }` 时不输出。

#### Scenario: 观察当前界面
- **WHEN** Agent 请求观察当前界面
- **THEN** 原生服务返回结构化元素（角色、名称、层级、可执行动作）与稳定引用

#### Scenario: 执行界面动作
- **WHEN** Agent 请求点击、输入、按键或滚动
- **THEN** 原生服务在目标位置执行动作并返回可观察结果

#### Scenario: 首次调用
- **WHEN** Agent 在一个会话中第一次调用 `js`
- **THEN** 工具结果包含核心文档与确认策略，以及该次调用的结果

#### Scenario: 获取应用
- **WHEN** Agent 执行 `await cua.getApp("备忘录")`
- **THEN** 系统返回应用对象，并在工具结果中输出该应用的完整可访问性状态，其中元素带有序号

#### Scenario: 一次调用多个动作
- **WHEN** Agent 在一次 `js` 调用中依次点击、输入并读取状态
- **THEN** 已获授权应用上的动作依次执行，调用返回最新状态，不因动作数量被拒绝

#### Scenario: 非 macOS 环境
- **WHEN** 应用运行在非 macOS 平台
- **THEN** Computer Use 能力返回不可用状态，应用其余能力正常工作

### Requirement: 治理系统权限
系统 SHALL 在执行前检查当前动作所需的辅助功能或屏幕录制权限，并在缺失时返回可诊断状态与授权引导；MUST NOT 在无权限时静默失败或伪造成功。系统 SHALL 展示系统设置路径、实际需授权的进程名称与重新检测入口。

系统 SHALL 在 Computer Use 被调起时检查权限，并在权限缺失时自动打开独立的授权指引窗口；窗口 SHALL 逐项展示权限名称、用途、当前状态与操作按钮，未授权项的 `允许` SHALL 触发对应系统授权请求，使应用出现在“系统设置 → 隐私与安全性”列表中。系统 MUST NOT 提供手动打开指引的入口，MUST NOT 持久化“不再提示”，且同一任务 MUST NOT 重复自动打开。指引窗口 SHALL 不带关闭按钮，只能通过窗口内的返回动作离开并回到主窗口；指引窗口与主窗口 SHALL 可以同时存在。系统 MUST NOT 自动触发系统授权提示之外的打扰；授权状态变化后 SHALL 支持重新检测。

指引 SHALL 只包含本应用当前真正需要且能够完成的授权项，MUST NOT 展示当前应用不支持的能力（例如 Chrome 扩展安装）。

设置中的 Computer Use 页面 SHALL 包含控制项 `任意应用`（以开关反映当前系统授权状态，并提供逐项状态与重新检测）以及“始终允许的应用”列表（展示已持久授权的应用并可逐个移除）；MUST NOT 展示浏览器扩展或第三方加载项。授权缺失时页面 SHALL 提供打开授权指引的操作，授权完整时该操作不出现。

#### Scenario: 查看与刷新授权
- **WHEN** 用户打开设置中的 Computer Use 页面
- **THEN** 页面显示 `任意应用` 及其当前授权状态，用户可重新检测刷新该状态

#### Scenario: 缺少授权时的入口
- **WHEN** 辅助功能或屏幕录制尚未授权
- **THEN** 页面出现打开授权指引的操作，点击后唤起授权指引窗口

#### Scenario: 缺少辅助功能权限
- **WHEN** 用户首次请求桌面操作而没有辅助功能权限
- **THEN** 系统展示可诊断提示与逐项授权指引，不执行动作

#### Scenario: 用户点击某一项的允许
- **WHEN** 用户在授权引导中点击尚未授权项的“允许”
- **THEN** 系统触发该项的系统授权请求并展示“将应用拖入列表”的引导，随后可按重新检测刷新状态

#### Scenario: 某项已授权
- **WHEN** 某项权限已授权
- **THEN** 该项显示完成状态而不是“允许”，且不重复弹出系统提示

#### Scenario: 调起 Computer Use 时缺少权限
- **WHEN** 任务开始使用 Computer Use 而所需权限尚未授予
- **THEN** 系统自动打开指引窗口，主窗口保持可用，用户无需寻找入口

#### Scenario: 从指引窗口返回
- **WHEN** 用户使用指引窗口内的返回动作
- **THEN** 指引窗口关闭并把主窗口带到前台，指引窗口本身不提供关闭按钮

#### Scenario: 缺少屏幕录制权限
- **WHEN** 任务需要屏幕采集而未授权录屏
- **THEN** 系统返回可诊断状态并说明影响，任务可按裁决降级或失败

#### Scenario: 权限被撤销
- **WHEN** 任务运行中系统权限被撤销
- **THEN** 后续调用返回可诊断错误，任务停止发起新动作

#### Scenario: 移除始终允许的应用
- **WHEN** 用户在“始终允许的应用”列表中移除某个应用
- **THEN** 此后首次使用该应用时重新请求授权

### Requirement: 最小化界面数据
系统 SHALL 只把屏幕截图写入会话临时目录，并在 Computer Use 会话结束（闲置超时、被回收、重置、Esc 取消或 runtime 退出）时删除；MUST NOT 把原始截图、窗口图像或完整元素树写入会话历史、生成资产或 LangGraph 检查点。JavaScript 入口发出的图片 SHALL 进入短期内存存储，过期后 MUST 要求重新观察。Computer Use JS 代码 SHALL 仅在受信宿主内存中保留，MUST NOT 写入历史、事件、交互日志或检查点；持久化输入 SHALL 仅记录代码长度及 helper 明确确认执行成功的输入、粘贴与设值文本长度。进程重启后丢失的待执行代码 MUST 明确失败，MUST NOT 猜测或自动重发。若观察内容会发送到远端模型，系统 SHALL 在授权引导中向用户说明这一数据流。

#### Scenario: 屏幕采集
- **WHEN** 系统采集屏幕用于观察
- **THEN** 截图只存在于会话临时目录与短期内存存储，会话结束后被删除

#### Scenario: 检查历史数据
- **WHEN** 开发者检查本地历史与事件
- **THEN** 不包含原始屏幕内容、完整元素树与实际输入的文本

### Requirement: 支持用户控制与接管
系统 SHALL 提供与 Browser Use 语义一致的暂停、继续与人工接管，控制命令 MUST 作用于实际执行门禁，并在暂停或接管期间阻止 Agent 继续发起桌面动作。
Computer Use 会话进行时系统 SHALL 在屏幕上显示不抢焦点的覆盖提示，说明 Action-Driver 正在使用电脑且可按 Esc 取消。用户按 Esc 时系统 SHALL 结束该会话，后续调用 MUST 返回 `USER_STOPPED_SESSION` 且任务停止；动作执行期间检测到用户自己的鼠标或键盘输入时，系统 SHALL 中断当前动作并返回 `USER_INTERVENED`。
敏感动作 SHALL 按确认策略处理：需要确认时，Agent 在回复中说明具体动作与风险，然后结束本轮，MUST NOT 在同一轮内执行该动作；用户在同一会话中回复后，下一轮继续执行。

#### Scenario: 接管桌面操作
- **WHEN** 用户接管桌面操作
- **THEN** Agent 停止发起新动作，用户可直接操作系统，交还后恢复

#### Scenario: 中断任务
- **WHEN** 用户中断正在执行的桌面任务
- **THEN** 进行中的动作被取消或到达终态后停止调度，等待中的授权与确认以取消结束

#### Scenario: 按 Esc 取消
- **WHEN** 用户在 Computer Use 会话中按下 Esc
- **THEN** 覆盖提示消失，当前与后续桌面调用返回 `USER_STOPPED_SESSION`，任务停止

#### Scenario: 用户介入
- **WHEN** 动作执行期间用户移动鼠标或敲击键盘
- **THEN** 当前动作被中断并返回 `USER_INTERVENED`，会话保留

#### Scenario: 敏感动作确认
- **WHEN** Agent 即将代用户发送消息，而首轮指令未预先许可
- **THEN** Agent 在回复中说明要发送的内容与对象，然后结束本轮；消息在用户回复同意之前不被发送

## REMOVED Requirements

### Requirement: 系统授权后可跨所有应用操作
**Reason**: 改为与 Codex 一致的逐应用授权；默认允许所有应用、且按动作逐次确认的组合被推翻。
**Migration**: 由新增的“按应用授权”与“以指定应用为目标并支持后台操作”两项要求取代，失效引用与旧坐标的约束并入后者。

## ADDED Requirements

### Requirement: 隔离模型 JavaScript 进程
系统 SHALL 将模型 JavaScript 子进程视为不可信，以操作系统沙箱及受信宿主作为权限边界；MUST NOT 将 node:vm 或模块导入拦截视为权限隔离证明。JS 子进程 SHALL 使用不含宿主凭据的环境，MUST NOT 创建额外子进程；普通脚本工具 SHALL 保留既有进程能力。宿主 SHALL 仅接受存活单元的合法能力请求并拒绝重复请求 ID，所有能力调用 SHALL 经过受信门禁。授权等待的计时暂停及恢复 SHALL 由宿主控制。

#### Scenario: 模型访问子进程运行时
- **WHEN** 模型代码获得 JavaScript 子进程的 process 对象并尝试启动 osascript 或另一个 Node 进程
- **THEN** 操作系统拒绝创建额外进程，宿主权限不因该访问而授予

#### Scenario: 子进程伪造重复请求
- **WHEN** 子进程在单元结束后发出能力请求或重复使用请求 ID
- **THEN** 宿主不执行该请求


### Requirement: 固定范围内的 Codex 兼容
系统 SHALL 以 vendor 来源记录中的固定版本为基线，验证明确支持的 macOS computer 方法的参数、输出、审批、动作效果、错误及生命周期。兼容矩阵 SHALL 标明环境、证据、未验证项及本项目差异；MUST NOT 仅凭源码复用宣称完整行为一致。

#### Scenario: 未验证能力
- **WHEN** 某方法或应用行为尚未通过兼容验证
- **THEN** 矩阵明确标为未验证，不列为已确认兼容

#### Scenario: 动作超时结果未知
- **WHEN** 动作可能已投递但调用超时
- **THEN** 系统提示结果未知和重新观察，不自动重发动作


### Requirement: 按应用授权
系统 SHALL 在每次桌面调用前按目标应用判定策略：`forbidden`（终端类应用、Action-Driver 自身、系统认证与隐私授权界面、钥匙串访问）与 `denied`（组织策略）MUST 被拒绝且不可由用户放行；其余应用在本会话未获授权且未被始终允许时，系统 SHALL 在该次调用内阻塞询问用户“允许 Action-Driver 使用「应用名」？”，选项为仅本次、本会话、始终允许（仅限允许持久授权的应用）与拒绝。等待期间 MUST NOT 计入调用超时，MUST NOT 执行该调用。获批后系统 SHALL 冻结调用参数并以解析出的应用路径执行，MUST NOT 让调用中途更换目标应用。点击、输入、按键等单个动作 MUST NOT 再逐次请求确认。高风险应用 SHALL 在授权请求中显示警告说明，且 MUST NOT 提供始终允许。

#### Scenario: 首次使用应用
- **WHEN** Agent 在会话中第一次对“备忘录”调用 `getApp`
- **THEN** 调用暂停并弹出应用授权；用户选择本会话后调用继续，之后对备忘录的调用不再询问

#### Scenario: 仅本次
- **WHEN** 用户对某应用选择仅本次
- **THEN** 只有这一次调用被放行，下一次对该应用的调用再次询问

#### Scenario: 拒绝授权
- **WHEN** 用户拒绝某应用
- **THEN** 该次调用失败并返回未获授权，桌面不发生变化

#### Scenario: 禁区应用
- **WHEN** Agent 请求使用终端
- **THEN** 调用直接失败并返回 `APP_FORBIDDEN`，不弹出授权

#### Scenario: 始终允许
- **WHEN** 用户对允许持久授权的应用选择始终允许
- **THEN** 此后的任务使用该应用不再询问，直到用户在设置中移除

### Requirement: 以指定应用为目标并支持后台操作
系统 SHALL 以调用中指定的应用为目标执行观察与动作，MUST NOT 以当前前台应用代替；未运行的应用 SHALL 在后台启动，MUST NOT 为观察而抢占前台。元素序号 SHALL 由 helper 按会话与应用维护，同一元素在后续观察中保持同一序号。每次动作前系统 MUST 用该应用的最近状态核对元素仍存在且属性未变，坐标 MUST 落在该应用窗口内；不符时 MUST 返回 `STALE_REFERENCE`，MUST NOT 自动改用新状态重试。动作后序号 SHALL 继续可用，同一次调用中可连续执行多个基于序号的动作，每个动作前仍按上述规则逐个核对；读取失败后在重新读取成功前，基于序号的动作 MUST 返回 `STALE_REFERENCE`。按键与输入 SHALL 投递到目标应用，MUST NOT 触发全局快捷键。目标不在前台时，按键与输入的结果 SHALL 标记为已投递但未确认，系统 SHALL 提示 Agent 以截图或重新读取状态核实，MUST NOT 将其计为已执行的输入。后台元素动作 SHALL 仅使用可用的 AX 动作；坐标点击、拖拽、滚动 SHALL 仅在目标应用已处于前台时执行。目标在后台或缺少所需 AX 动作时系统 SHALL 在投递事件前返回 `BACKGROUND_INPUT_UNSUPPORTED`，MUST NOT 试投后台坐标鼠标事件或静默切换前台。动作前 MUST 再次核对目标前台状态。同一应用同一时间 SHALL 只被一个任务操作，其他任务的调用 MUST 返回应用占用错误。

#### Scenario: 后台操作
- **WHEN** 用户在前台使用浏览器，Agent 对支持后台 AX 操作的应用执行 AX 点击与可用的后台输入
- **THEN** 目标应用在后台完成操作，浏览器保持在前台且未收到输入

#### Scenario: 后台坐标鼠标请求
- **WHEN** Agent 请求对后台应用执行坐标点击、拖拽或滚动
- **THEN** 系统在投递前返回 `BACKGROUND_INPUT_UNSUPPORTED`，不发送事件且不激活该应用

#### Scenario: 连续动作
- **WHEN** Agent 在同一次调用中依次点击最近状态中的两个元素，两次点击之间未重新读取
- **THEN** 两个元素均通过核对时两个动作依次执行；任一元素已被移除或属性改变时，该动作返回 `STALE_REFERENCE` 且不执行

#### Scenario: 界面在动作前改变
- **WHEN** 元素在读取状态之后被移除或改变
- **THEN** 动作返回 `STALE_REFERENCE` 且不执行，Agent 须重新读取状态

#### Scenario: 已执行动作不重复
- **WHEN** 动作已发出而 helper 连接随后断开
- **THEN** 系统返回错误并提示重新读取状态，不再次发出该动作

#### Scenario: 应用被占用
- **WHEN** 两个任务同时请求操作同一应用
- **THEN** 后到的任务得到应用占用错误，先到的任务不受影响

### Requirement: 应用专属说明
helper 为某应用提供操作说明时，系统 SHALL 在该应用状态文本前注入说明，每个会话每个应用只注入一次；`cua.rewriteDocumentation()` SHALL 重新输出核心文档与确认策略。

#### Scenario: 首次读取带说明的应用
- **WHEN** Agent 在会话中首次读取带有专属说明的应用状态
- **THEN** 结果先包含该应用的专属说明，再包含状态文本；同一会话再次读取时不重复

### Requirement: Computer Use 会话跨轮保留
Computer Use 会话 SHALL 以对话会话（sessionId）为单位：JavaScript 入口的绑定、已读的 `computer-use` Skill、本会话应用授权与已注入的应用专属说明 SHALL 在同一会话的后续轮次中保留。每轮结束时系统 SHALL 隐藏覆盖提示、释放该轮持有的应用租约并取消等待中的授权，MUST NOT 清除上述会话状态。会话闲置超时、被回收、执行 `js_reset`、用户按 Esc 或 runtime 退出时，系统 SHALL 结束会话并清除其状态与截图。

#### Scenario: 追问后继续
- **WHEN** Agent 在上一轮取得备忘录应用对象并请求用户确认，用户在同一会话中回复同意
- **THEN** 下一轮 Agent 可直接使用上一轮的绑定继续操作备忘录，不再请求应用授权，也无需重新读取 Skill

#### Scenario: 新会话
- **WHEN** 用户开始一个新会话
- **THEN** 该会话从空的 JavaScript 绑定开始，首次调用重新输出文档，本会话授权为空
