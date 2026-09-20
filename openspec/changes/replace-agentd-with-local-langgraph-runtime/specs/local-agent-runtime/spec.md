## Purpose

定义随 ActionDriver 桌面应用运行的本地 Agent Runtime 行为，使任务能够在不依赖远程会话状态的情况下执行、暂停、恢复并通过 Skill 调用桌面能力。

## ADDED Requirements

### Requirement: Agent Loop 在本地独立运行
系统 MUST 在 Renderer 之外的本地独立进程中运行 Agent Loop，并由 Electron Main 启动、监督和关闭该进程。

#### Scenario: 启动桌面应用
- **WHEN** 用户启动 ActionDriver
- **THEN** Electron Main 启动单一 Agent Runtime 实例，并只在运行时完成就绪检查后接受任务命令

#### Scenario: Runtime 尚未就绪
- **WHEN** 用户在 Agent Runtime 完成就绪检查前提交目标
- **THEN** 系统返回可识别的暂不可用结果，不丢弃命令也不启动第二个 Runtime

### Requirement: 使用可恢复的图状态执行任务
系统 SHALL 为每个任务维护稳定的运行线程标识，并在可恢复边界保存图状态，使进程退出后能够从最近一次完整 checkpoint 恢复。

#### Scenario: Runtime 在步骤之间退出
- **WHEN** Agent Runtime 在已保存 checkpoint 后意外退出
- **THEN** 重启后的 Runtime 从该任务最近一次完整 checkpoint 恢复，而不是从头重复已确认完成的步骤

#### Scenario: checkpoint 不完整
- **WHEN** Runtime 发现某次 checkpoint 写入未完整提交
- **THEN** 系统忽略该 checkpoint，并从上一个完整 checkpoint 恢复

### Requirement: 区分等待用户与用户中断
系统 MUST 区分 Agent 主动等待用户输入和用户主动中断运行，并为两种状态提供明确、可恢复的状态投影。

#### Scenario: Agent 需要用户确认
- **WHEN** Agent 在继续执行前需要用户提供信息或确认
- **THEN** 任务进入等待用户状态、保存 checkpoint，并在收到对应输入后从等待点继续

#### Scenario: 用户中断正在运行的任务
- **WHEN** 用户触发中断
- **THEN** Runtime 取消当前可取消工作、停止发起新的 Skill 调用，并将任务停留在最近一次安全恢复点

#### Scenario: 用户继续已中断任务
- **WHEN** 用户对已中断任务触发继续
- **THEN** Runtime 从最近一次安全恢复点继续，并保持同一任务和运行线程标识

### Requirement: 模型推理不拥有会话历史
系统 MUST 将模型推理作为可替换的远程调用边界，并且远程推理服务不得成为 ActionDriver 任务、消息、步骤或 checkpoint 的持久化事实来源。

#### Scenario: 请求模型推理
- **WHEN** Agent Loop 需要模型输出
- **THEN** Runtime 仅发送完成当前推理所需的上下文，并将返回结果写入本地运行记录

#### Scenario: 远程推理不可用
- **WHEN** 模型调用因网络或服务错误失败
- **THEN** 本地历史和最近 checkpoint 保持可读，任务显示可诊断错误且不会伪造成功结果

### Requirement: 支持确定性本地测试模式
系统 SHALL 提供不依赖模型凭据和真实桌面能力的确定性 Runtime 绑定，用于测试、视觉验收和离线开发。

#### Scenario: 使用测试组合根启动
- **WHEN** 测试环境启动 Agent Runtime
- **THEN** 系统使用确定性模型与 Mock Skill Provider 完成可重复的状态转换
