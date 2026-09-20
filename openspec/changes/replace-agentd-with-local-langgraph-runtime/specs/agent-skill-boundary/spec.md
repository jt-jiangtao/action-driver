## MODIFIED Requirements

### Requirement: Agent 通过 Skill 调用能力
系统 MUST 将本地 Agent Runtime 作为任务编排核心，并通过统一 Skill Contract 发起能力调用；Agent 图节点和界面均不得直接访问 Browser Use、Computer Use 或其他桌面能力的具体实现。

#### Scenario: Agent 请求浏览器操作
- **WHEN** Agent 计划需要执行浏览器动作
- **THEN** Agent 以 Browser Skill 标识和类型化输入创建 Skill 调用，由 Registry 解析实际 Provider，而不是直接访问浏览器对象

#### Scenario: Agent 请求系统操作
- **WHEN** Agent 计划需要执行 macOS 操作
- **THEN** Agent 以 Computer Use Skill 标识和类型化输入创建 Skill 调用，而不是直接访问原生系统 API

### Requirement: Browser Use 与 Computer Use 相互独立
系统 MUST 将 Browser Use 和 Computer Use 注册为两个独立的 Skill 能力，两者不得互相依赖具体实现、运行时 Handle 或页面组件状态。

#### Scenario: 替换 Browser Skill 实现
- **WHEN** Browser Skill 从 Mock 实现替换为 Playwright Provider 或未来 Native Provider
- **THEN** Computer Use Skill 契约、Agent Runtime 核心和 React 页面组件无需修改

### Requirement: 统一 Skill 生命周期
系统 SHALL 使用统一的生命周期状态表达 Skill 调用，至少包含待执行、运行、暂停、等待用户、人工接管、完成、失败和取消。

#### Scenario: Skill 状态投影到界面
- **WHEN** 任一 Skill 生命周期发生变化
- **THEN** Agent 会话、执行时间线和能力控制界面从同一持久化事件投影得到一致结果

#### Scenario: 任务被用户中断
- **WHEN** 用户中断任务且 Skill 调用仍在运行
- **THEN** Runtime 请求取消该调用，并在收到完成、失败或取消结果前不发起后续动作

### Requirement: 使用依赖注入替换实现
系统 MUST 通过依赖注入绑定 Agent Runtime、模型、存储、Skill Registry 与 Provider 端口，使测试实现能够在不修改消费者的情况下替换生产实现。

#### Scenario: 使用 Mock 组合根启动
- **WHEN** 应用以测试或视觉验收配置启动
- **THEN** Agent 会话仓储、模型端口和 Skill Provider 解析为确定性 Mock 实现

#### Scenario: 未来切换 IPC 适配器
- **WHEN** 生产应用完成 Runtime 版本握手
- **THEN** Electron Main 将相同领域服务标识绑定到本地 Runtime Adapter，React 页面保持不变

### Requirement: 保持跨边界数据可序列化
系统 SHALL 让 Agent、任务、步骤和 Skill 调用的数据结构经过运行时校验并可被结构化克隆，不包含函数、DOM 节点、Electron 对象或 Provider 私有实时引用。

#### Scenario: 序列化 Skill 事件
- **WHEN** Runtime 向 Main 发布 Skill 生命周期事件
- **THEN** 双方在应用事件前校验协议版本和载荷结构，非法载荷被拒绝并产生可诊断错误

## ADDED Requirements

### Requirement: 记录实际解析的 Skill Provider
系统 SHALL 为每次 Skill 调用保存请求的 Skill 标识、实际解析的 Provider 标识和 Provider 版本，使逻辑别名不会隐藏真实执行来源。

#### Scenario: 解析 Browser Skill 别名
- **WHEN** Agent 使用逻辑 Browser Skill 标识且 Registry 将其解析为具体 Provider
- **THEN** 调用记录同时保存请求标识、实际 Provider 标识和 Provider 版本
