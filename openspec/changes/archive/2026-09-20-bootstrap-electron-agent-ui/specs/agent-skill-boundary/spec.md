## Purpose

定义 Agent 与外部操作能力之间稳定、类型化且可替换的 Skill 边界，使 Browser Use 与 Computer Use 能独立演进而不耦合 UI 或 Agent 核心。

## ADDED Requirements

### Requirement: Agent 通过 Skill 调用能力
系统 MUST 将 Agent 作为任务编排核心，并通过统一 Skill Contract 发起能力调用；Agent 和界面均不得直接调用 Browser Use 或 Computer Use 的具体实现。

#### Scenario: Agent 请求浏览器操作
- **WHEN** Agent 计划需要执行浏览器动作
- **THEN** Agent 以 Browser Skill 标识和类型化输入创建 Skill 调用，而不是直接访问浏览器对象

#### Scenario: Agent 请求系统操作
- **WHEN** Agent 计划需要执行 macOS 操作
- **THEN** Agent 以 Computer Use Skill 标识和类型化输入创建 Skill 调用，而不是直接访问原生系统 API

### Requirement: Browser Use 与 Computer Use 相互独立
系统 MUST 将 Browser Use 和 Computer Use 注册为两个独立的 Skill 能力，两者不得互相依赖具体实现或共享页面组件状态。

#### Scenario: 替换 Browser Skill 实现
- **WHEN** Browser Skill 从 Mock 实现替换为未来 Chromium 实现
- **THEN** Computer Use Skill 契约及 Agent 页面组件无需修改

### Requirement: 统一 Skill 生命周期
系统 SHALL 使用统一的生命周期状态表达 Skill 调用，至少包含待执行、运行、暂停、等待用户、人工接管、完成和失败。

#### Scenario: Skill 状态投影到界面
- **WHEN** Mock Skill 生命周期发生变化
- **THEN** Agent 会话、执行时间线和浮动控制条从同一状态投影得到一致结果

### Requirement: 使用依赖注入替换实现
系统 MUST 通过依赖注入绑定抽象服务与具体实现，使 Mock 实现能够在不修改消费者的情况下替换为未来 IPC 实现。

#### Scenario: 使用 Mock 组合根启动
- **WHEN** 应用以当前开发配置启动
- **THEN** Agent 会话仓储和 Skill 网关解析为确定性的 Mock 实现

#### Scenario: 未来切换 IPC 适配器
- **WHEN** 组合根将相同服务标识绑定到 IPC 适配器
- **THEN** React 页面和领域接口保持不变

### Requirement: 保持跨边界数据可序列化
系统 SHALL 让 Agent、任务、步骤和 Skill 调用的数据结构可序列化，以便后续通过 Electron IPC 和 Unix Domain Socket 传输。

#### Scenario: 序列化 Skill 事件
- **WHEN** 系统创建任一 Mock Skill 生命周期事件
- **THEN** 该事件不包含函数、DOM 节点、Electron 对象或其他不可序列化值

