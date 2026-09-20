## ADDED Requirements

### Requirement: Agent Runtime 管理 Skill Registry
系统 MUST 由本地 Agent Runtime 维护 Skill 能力注册表，并根据稳定 Skill 标识、协议版本和能力描述选择已注册提供者。

#### Scenario: 注册 Browser Skill 提供者
- **WHEN** Electron Main 与 Agent Runtime 完成握手并声明 Browser Skill 能力
- **THEN** Registry 将其记录为 Browser Skill 提供者，而不改变 Computer Use Skill 的注册状态

#### Scenario: 请求未注册 Skill
- **WHEN** Agent 计划请求当前没有可用提供者的 Skill
- **THEN** Runtime 返回类型化的能力不可用结果，不把调用伪装为成功或直接访问底层实现

### Requirement: Agent Runtime 统一调度 Skill 调用
系统 SHALL 让 Agent Runtime 为每次 Skill 调用分配稳定调用标识、保存生命周期状态，并通过已注册提供者执行调用。

#### Scenario: 调度已注册 Skill
- **WHEN** Agent 提交类型与提供者能力匹配的 Skill 调用
- **THEN** Runtime 先持久化待执行状态，再向对应提供者发出调用并发布后续生命周期事件

### Requirement: 保留 Mock 与本地运行时适配器
系统 SHALL 允许测试和设计验收继续使用确定性 Mock Skill Gateway，同时让生产组合根切换到本地 Agent Runtime 适配器，消费者接口保持不变。

#### Scenario: 运行组件测试
- **WHEN** 测试组合根绑定 Mock Skill Gateway
- **THEN** 现有页面能够在不启动 Sidecar、数据库或定制 Electron 的情况下复现全部 Mock 状态

#### Scenario: 启动生产组合根
- **WHEN** 生产应用完成 Sidecar 握手
- **THEN** 相同的 Agent 与 Skill 消费接口由本地运行时适配器提供
