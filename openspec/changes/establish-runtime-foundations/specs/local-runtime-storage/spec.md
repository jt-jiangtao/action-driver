## Purpose

定义任务与 Agent 运行数据默认保存在本机 SQLite 数据库中的持久化行为，确保离线可用、可迁移并为后续运行恢复提供一致数据基础。

## ADDED Requirements

### Requirement: 运行数据默认保存在本地
系统 SHALL 将任务、消息、执行步骤、Skill 调用和运行事件默认保存到当前 macOS 用户的本地应用数据目录，不依赖账号、云服务或网络连接。

#### Scenario: 离线创建任务
- **WHEN** 用户在无网络连接时提交任务
- **THEN** 任务及其初始运行记录被写入本地数据库，并可被当前应用会话读取

### Requirement: Sidecar 独占数据库写入
系统 MUST 由 Agent Service 作为 SQLite 数据库的唯一写入所有者；Electron Main、Preload 和 Renderer 不得直接打开数据库执行写入。

#### Scenario: 界面提交命令
- **WHEN** Renderer 通过受控接口提交任务或 Skill 控制命令
- **THEN** 数据库写入由 Agent Service 在命令处理事务中完成

### Requirement: 使用原子数据库迁移
系统 MUST 在运行时对外就绪前按顺序执行版本化迁移，并保证单次迁移全部成功或全部回滚。

#### Scenario: 首次创建数据库
- **WHEN** 应用数据目录中不存在数据库
- **THEN** Agent Service 创建数据库、应用全部迁移并记录当前 schema 版本后才进入就绪状态

#### Scenario: 迁移失败
- **WHEN** 任一迁移无法完成
- **THEN** 本次迁移回滚，Agent Service 不进入就绪状态，并保留可诊断错误而不继续写入未知 schema

### Requirement: 原子记录运行状态变化
系统 SHALL 在同一事务中保存一次 Agent 或 Skill 状态变化及其对应事件，避免界面投影与持久化状态出现部分更新。

#### Scenario: Skill 调用进入运行状态
- **WHEN** Agent Runtime 接受一个 Skill 调用
- **THEN** Skill 调用当前状态和对应生命周期事件在同一事务中提交

### Requirement: 保持持久化记录可演进
系统 SHALL 为持久化实体使用稳定标识、创建与更新时间以及 schema 版本信息，使未来版本能够迁移数据而无需依赖 UI 组件结构。

#### Scenario: 应用升级后读取历史任务
- **WHEN** 新版本完成数据库迁移并读取旧版本创建的任务
- **THEN** 历史任务仍能映射为当前任务、消息、步骤和 Skill 投影
