## Purpose

定义 Electron Main 与本地 Agent Runtime 之间可版本化、可恢复且与 Renderer 隔离的双向消息边界，为命令、事件和 Skill Provider 调用提供统一传输行为。

## ADDED Requirements

### Requirement: 使用应用私有的进程消息通道
系统 MUST 让 Electron Main 与其启动的 Agent Runtime 通过应用私有的本地进程消息通道通信，不得开放本机 TCP 监听端口。

#### Scenario: 建立 Runtime 连接
- **WHEN** Electron Main 启动 Agent Runtime
- **THEN** Main 建立仅属于本次应用实例的双向消息通道，Renderer 不获得原始通道或 Runtime 进程引用

### Requirement: 建立协议版本握手
系统 MUST 在接受业务命令前交换协议版本、应用版本、Runtime 版本和能力集合，并拒绝不兼容的主协议版本。

#### Scenario: 兼容版本连接
- **WHEN** Main 与 Runtime 支持相同的主协议版本
- **THEN** 握手成功并返回双方协商后的可用能力

#### Scenario: 不兼容版本连接
- **WHEN** 双方主协议版本不一致
- **THEN** Runtime 在执行任务或写入业务数据前拒绝连接，并返回明确的版本错误

### Requirement: 关联命令、响应与反向调用
系统 SHALL 为每个命令和 Skill Provider 反向调用携带唯一请求标识、截止时间和版本化载荷，使双方能够关联成功、失败、取消和超时结果。

#### Scenario: 提交任务成功
- **WHEN** Main 发送有效且未过期的任务命令
- **THEN** Runtime 返回携带相同请求标识的类型化结果

#### Scenario: Runtime 请求执行 Skill
- **WHEN** Agent Loop 选择一个已注册 Skill Provider
- **THEN** Runtime 通过同一双向边界向 Main 发起类型化调用，并将 Provider 结果关联回原 Skill 调用

#### Scenario: 请求超时
- **WHEN** 请求在截止时间前未完成
- **THEN** 调用方收到超时结果，迟到响应不得被应用为新的成功结果

### Requirement: 提供可恢复的有序事件订阅
系统 SHALL 为任务事件分配持久化单调游标，并允许 Main 从最后确认游标之后恢复订阅。

#### Scenario: Runtime 重启后恢复事件
- **WHEN** Main 使用最后确认游标重新订阅任务事件
- **THEN** Runtime 从下一条可用事件继续发送，已确认事件不会被重复应用

### Requirement: 保持 Renderer 进程隔离
系统 MUST 由 Electron Main 独占 Runtime 通道，并只通过显式、类型化的 Preload API 向 Renderer 投影必要能力。

#### Scenario: Renderer 请求任务状态
- **WHEN** Renderer 读取或订阅任务状态
- **THEN** 请求经由白名单桥接和 Main 适配器完成，Renderer 无法访问数据库路径、Runtime 通道或通用 IPC 调用

#### Scenario: Renderer 控制 Skill 生命周期
- **WHEN** Renderer 暂停、继续或人工接管一个已知 Skill invocation
- **THEN** Preload 只接受 invocation id 与 `pause`、`resume`、`take-over` 之一，并通过明确命名的 IPC Handler 转换为版本化 `skill.control` Runtime 命令；Renderer 不获得通用命令发送能力
