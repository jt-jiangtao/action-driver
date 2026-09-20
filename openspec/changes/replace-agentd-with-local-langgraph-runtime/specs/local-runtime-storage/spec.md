## Purpose

定义 ActionDriver 客户端对历史会话、任务运行记录和 Agent checkpoint 的本地持久化行为，确保离线读取、升级迁移与崩溃恢复具有一致结果。

## ADDED Requirements

### Requirement: 历史与 checkpoint 只保存在客户端
系统 MUST 将任务、消息、步骤、Skill 调用、运行事件和 Agent checkpoint 默认保存在当前 macOS 用户的本地应用数据目录，不依赖账号、云同步或远程历史服务。

#### Scenario: 离线读取历史任务
- **WHEN** 用户在无网络连接时重新打开 ActionDriver
- **THEN** 系统能够从本地数据库读取历史任务、对话和最后已保存的运行状态

#### Scenario: 模型服务返回结果
- **WHEN** Runtime 收到远程模型输出
- **THEN** 输出作为本地任务记录保存，远程服务不被用作后续读取历史的来源

### Requirement: Runtime 独占业务数据写入
系统 MUST 由本地 Agent Runtime 作为业务数据库的唯一写入进程；Electron Main、Preload 和 Renderer 不得直接打开数据库执行写入。

#### Scenario: 界面提交任务命令
- **WHEN** Renderer 通过白名单接口提交任务
- **THEN** 任务与初始事件由 Agent Runtime 写入本地数据库

### Requirement: 保存可恢复且可校验的 checkpoint
系统 SHALL 按任务线程保存版本化 checkpoint，并将业务投影关联到明确的 checkpoint，使重启恢复不会遗漏或重复应用已确认事件。

#### Scenario: 从 checkpoint 重建投影
- **WHEN** Runtime 启动时发现 checkpoint 已提交但对应界面投影尚未完成
- **THEN** 系统以幂等方式补齐投影和事件，并保持事件顺序不变

#### Scenario: 重复恢复同一 checkpoint
- **WHEN** 同一 checkpoint 因重试被再次处理
- **THEN** 系统不会生成重复步骤、Skill 调用或运行事件

### Requirement: 使用原子且只前进的迁移
系统 MUST 在 Runtime 对外就绪前按顺序执行版本化数据库迁移，并保证单次迁移全部成功或全部回滚。

#### Scenario: 首次创建数据库
- **WHEN** 本地应用数据目录中不存在数据库
- **THEN** Runtime 创建数据库、应用全部迁移并记录 schema 版本后才进入就绪状态

#### Scenario: 迁移失败
- **WHEN** 任一迁移无法完成
- **THEN** 本次迁移回滚，Runtime 不进入就绪状态，并保留可诊断错误

### Requirement: 持久化数据不包含实时桌面对象
系统 MUST 只保存可序列化的领域数据，不得将 DOM 节点、Electron 对象、实时浏览器 Handle、坐标引用或原始认证凭据写入历史和 checkpoint。

#### Scenario: 保存 Skill 调用
- **WHEN** Runtime 持久化一次 Skill 调用
- **THEN** 记录只包含稳定标识、版本化输入输出和状态，不包含进程内对象或原始 Cookie、Session Token
