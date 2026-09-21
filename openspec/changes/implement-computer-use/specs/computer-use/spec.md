## Purpose

定义 macOS 桌面操作的观察、动作与权限行为，使 Agent 能在用户授权下操作全系统界面，并把过程投影到界面，同时保持与 Browser Use 的独立边界。

## ADDED Requirements

### Requirement: 通过原生服务操作 macOS 界面
系统 SHALL 通过独立原生服务执行 macOS 界面观察与动作，Agent MUST 通过 Computer Skill 契约调用，MUST NOT 直接访问系统 API；系统 SHALL 仅支持 macOS。

#### Scenario: 观察当前界面
- **WHEN** Agent 请求观察当前界面
- **THEN** 原生服务返回结构化元素（角色、名称、层级、可执行动作）与稳定引用

#### Scenario: 执行界面动作
- **WHEN** Agent 请求点击、输入、按键或滚动
- **THEN** 原生服务在目标位置执行动作并返回可观察结果

#### Scenario: 非 macOS 环境
- **WHEN** 应用运行在非 macOS 平台
- **THEN** Computer Use 能力返回不可用状态，应用其余能力正常工作

### Requirement: 治理系统权限
系统 SHALL 在执行前检查辅助功能与屏幕录制权限，并在缺失时返回可诊断状态与授权引导；MUST NOT 在无权限时静默失败或伪造成功。

#### Scenario: 缺少辅助功能权限
- **WHEN** 用户首次请求桌面操作而没有辅助功能权限
- **THEN** 系统展示可诊断提示与授权指引，不执行动作

#### Scenario: 缺少屏幕录制权限
- **WHEN** 任务需要屏幕采集而未授权录屏
- **THEN** 系统返回可诊断状态并说明影响，任务可按裁决降级或失败

#### Scenario: 权限被撤销
- **WHEN** 任务运行中系统权限被撤销
- **THEN** 后续调用返回可诊断错误，任务停止发起新动作

### Requirement: 最小化界面数据
系统 SHALL 只在内存中处理屏幕与界面数据，MUST NOT 把原始屏幕内容、窗口截图或完整元素树写入会话历史；只投影必要的步骤描述与状态。

#### Scenario: 屏幕采集
- **WHEN** 系统采集屏幕用于观察
- **THEN** 采集结果只用于当次推理，不落盘、不进入历史

#### Scenario: 检查历史数据
- **WHEN** 开发者检查本地历史与事件
- **THEN** 不包含原始屏幕内容与敏感标识

### Requirement: 支持用户控制与接管
系统 SHALL 提供与 Browser Use 语义一致的暂停、继续与人工接管，并在接管期间阻止 Agent 继续发起桌面动作。

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
