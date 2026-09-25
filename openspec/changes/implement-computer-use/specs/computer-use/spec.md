## Purpose

定义 macOS 桌面操作的观察、动作与权限行为，使 Agent 能在用户授权下操作全系统界面，并把过程投影到界面，同时保持与 Browser Use 的独立边界。

## ADDED Requirements

### Requirement: 通过原生服务操作 macOS 界面
系统 SHALL 通过签名内置的独立原生 helper 执行 macOS 界面观察与动作，Electron Main SHALL 使用私有 stdio 与其通信；Agent MUST 通过 Computer Skill 契约调用，MUST NOT 直接访问系统 API；系统 SHALL 仅支持 macOS 14 及以上。
Agent SHALL 通过现有多轮 Tool/Policy Gate 调用类型化 Computer Tools，由独立 Computer Skill Provider 执行，系统 MUST NOT 因启用 Skill 文本或取得 macOS 系统权限而绕过本轮 Tool 授权。

#### Scenario: 观察当前界面
- **WHEN** Agent 请求观察当前界面
- **THEN** 原生服务返回结构化元素（角色、名称、层级、可执行动作）与稳定引用

#### Scenario: 执行界面动作
- **WHEN** Agent 请求点击、输入、按键或滚动
- **THEN** 原生服务在目标位置执行动作并返回可观察结果

#### Scenario: 非 macOS 环境
- **WHEN** 应用运行在非 macOS 平台
- **THEN** Computer Use 能力返回不可用状态，应用其余能力正常工作

### Requirement: 系统授权后可跨所有应用操作
系统 SHALL 在用户授予所需 macOS 系统权限后默认允许 Computer Use 操作所有应用，不以任务级应用白名单限制目标；系统 MUST 在每次动作前核对当前界面与最近观察，MUST NOT 因窗口切换而盲用旧元素引用或坐标。

#### Scenario: 任务跨应用
- **WHEN** Agent 从一个应用切换到另一个应用继续任务
- **THEN** 系统重新观察目标界面并允许执行受约束动作，无需额外应用白名单授权

#### Scenario: 窗口在观察后改变
- **WHEN** 目标窗口或显示器在观察与动作之间发生变化
- **THEN** 系统拒绝使用失效引用或旧坐标，并要求重新观察

### Requirement: 治理系统权限
系统 SHALL 在执行前检查当前动作所需的辅助功能或屏幕录制权限，并在缺失时返回可诊断状态与授权引导；MUST NOT 在无权限时静默失败或伪造成功。系统 SHALL 展示系统设置路径、实际需授权的进程名称与重新检测入口。

系统 SHALL 在 Computer Use 被调起时检查权限，并在权限缺失时自动打开独立的授权指引窗口；窗口 SHALL 逐项展示权限名称、用途、当前状态与操作按钮，未授权项的 `允许` SHALL 触发对应系统授权请求（辅助功能、屏幕录制、输入事件），使应用出现在“系统设置 → 隐私与安全性”列表中。系统 MUST NOT 提供手动打开指引的入口，MUST NOT 持久化“不再提示”，且同一任务 MUST NOT 重复自动打开。指引窗口 SHALL 不带关闭按钮，只能通过窗口内的返回动作离开并回到主窗口；指引窗口与主窗口 SHALL 可以同时存在。系统 MUST NOT 自动触发系统授权提示之外的打扰；授权状态变化后 SHALL 支持重新检测。

指引 SHALL 只包含本应用当前真正需要且能够完成的授权项，MUST NOT 展示当前应用不支持的能力（例如 Chrome 扩展安装）。

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

### Requirement: 最小化界面数据
系统 SHALL 只在内存中处理屏幕与界面数据，MUST NOT 把原始屏幕内容、窗口截图或完整元素树写入会话历史或 LangGraph 检查点；截图 SHALL 经分块内存通道传输，持久化路径只含有短期句柄与安全摘要。句柄过期后 MUST 要求重新观察，MUST NOT 从历史恢复原始图像。若观察内容会发送到远端模型，系统 SHALL 在授权引导中向用户说明这一数据流。

#### Scenario: 屏幕采集
- **WHEN** 系统采集屏幕用于观察
- **THEN** 采集结果只用于当次推理，不落盘、不进入历史

#### Scenario: 检查历史数据
- **WHEN** 开发者检查本地历史与事件
- **THEN** 不包含原始屏幕内容与敏感标识

### Requirement: 支持用户控制与接管
系统 SHALL 提供与 Browser Use 语义一致的暂停、继续与人工接管，控制命令 MUST 作用于实际执行门禁，并在暂停或接管期间阻止 Agent 继续发起桌面动作。系统 SHALL 在执行购买、发送或破坏性等高后果动作前请求用户确认。
点击、元素点击、输入和按键 MUST 在每次调用前展示动作摘要并取得该次调用的用户明确批准；拒绝后 helper MUST NOT 执行动作。等待与滚动可不经此确认。屏幕内容、AX 文本和模型输出 MUST NOT 代替用户批准。

#### Scenario: 接管桌面操作
- **WHEN** 用户接管桌面操作
- **THEN** Agent 停止发起新动作，用户可直接操作系统，交还后恢复

#### Scenario: 中断任务
- **WHEN** 用户中断正在执行的桌面任务
- **THEN** 进行中的动作被取消或到达终态后停止调度，任务停在可恢复的最近状态

### Requirement: 与 Browser Use 保持独立
系统 MUST 把 Computer Use 注册为与 Browser Use 相互独立的 Skill，两者不得共享具体实现或页面组件状态；切换任一实现 MUST NOT 影响另一个契约。

#### Scenario: 替换实现
- **WHEN** Computer Use 从 Mock 实现替换为原生实现
- **THEN** Browser Use 契约与页面组件无需修改
