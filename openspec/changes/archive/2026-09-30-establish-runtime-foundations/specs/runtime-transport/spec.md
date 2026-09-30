## Purpose

定义 Electron 与本地 Agent Service 之间稳定、可演进且仅限本机的通信行为，为 Agent 命令、Skill 调用和增量事件提供统一传输边界。

## ADDED Requirements

### Requirement: 仅通过本地 Unix Domain Socket 通信
系统 MUST 让 Electron Main 与 Agent Service 通过当前用户私有目录中的 Unix Domain Socket 通信，不得为本地运行时开放 TCP 监听端口。

#### Scenario: 建立本地连接
- **WHEN** Agent Service 完成启动
- **THEN** Electron Main 连接到本次应用运行专属的套接字，Renderer 不获得套接字路径或直接连接能力

### Requirement: 建立协议版本握手
系统 MUST 在接受业务命令前交换协议版本、应用版本、运行时版本和能力集合，并拒绝不兼容的协议组合。

#### Scenario: 兼容版本连接
- **WHEN** Electron Main 与 Agent Service 支持相同的主协议版本
- **THEN** 握手成功并返回双方可用能力

#### Scenario: 不兼容版本连接
- **WHEN** 双方主协议版本不兼容
- **THEN** 连接在执行任何任务或数据库写入前失败，并返回明确的版本不兼容原因

### Requirement: 关联命令与响应
系统 SHALL 为每个 Agent 命令携带唯一请求标识、调用上下文、截止时间和可序列化载荷，使调用方能够关联成功结果、业务错误或超时。

#### Scenario: 命令成功
- **WHEN** Electron Main 提交一个有效且未过期的命令
- **THEN** Agent Service 返回携带相同请求标识的类型化结果

#### Scenario: 命令超过截止时间
- **WHEN** 命令在其截止时间前未完成
- **THEN** 调用方收到超时结果，迟到响应不得被当作新的成功结果应用

### Requirement: 提供可恢复的有序事件流
系统 SHALL 按会话提供有序的运行事件订阅，并为事件分配单调递增游标，使 Electron 在短暂断线后能够从最后确认位置恢复。

#### Scenario: 订阅任务事件
- **WHEN** Electron Main 订阅一个活动任务
- **THEN** Agent Service 按游标顺序发送任务、步骤和 Skill 生命周期事件

#### Scenario: 连接中断后恢复
- **WHEN** Electron Main 使用最后确认游标重新订阅
- **THEN** Agent Service 从下一条可用事件继续发送，已确认事件不会被重复应用

### Requirement: 保持 Renderer 进程隔离
系统 MUST 由 Electron Main 独占 Sidecar 连接，并只通过显式、类型化的 Preload API 向 Renderer 投影必要数据。

#### Scenario: Renderer 请求任务状态
- **WHEN** Renderer 读取或订阅 Agent 任务状态
- **THEN** 请求经由白名单桥接和 Main 适配器完成，Renderer 不能访问原始传输客户端或任意调用接口
