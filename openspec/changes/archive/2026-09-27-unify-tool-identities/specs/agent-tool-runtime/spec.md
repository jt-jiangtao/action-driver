## ADDED Requirements

### Requirement: Target and plugin qualified tool identities
内置工具 SHALL 使用 tools.<target>.<plugin>.<operation> 标识，target SHALL 是 local/cloud 执行上下文归属而不是是否联网。模型名称 SHALL 为下划线形式，版本与名称分离。同一能力在不同 target 下 SHALL 使用不同标识与 grants。

#### Scenario: Discover a local plugin tool
- **WHEN** Agent 发现本地 command Node 工具
- **THEN** 仅展示 tools.local.command.node.run 与 tools_local_command_node_run，不展示旧别名

#### Scenario: No cloud binding
- **WHEN** 请求 cloud 工具但只有 local 实现及授权
- **THEN** 明确不可用或拒绝，不回退到本机执行

### Requirement: Explicit legacy local tool compatibility
系统 SHALL 仅将已知旧内置标识、模型名及版本化 grants 映射到对应 local，保留原版本；SHALL 不猜测第三方或 cloud 名称。历史事件 SHALL 保留原数据且正常展示。别名冲突 SHALL 拒绝，停用后别名 SHALL 不可调用。

#### Scenario: Resume old calls
- **WHEN** node_run 调用持有 local.node.run@2 且新工具启用
- **THEN** 使用 tools.local.command.node.run@2 执行及记录，不增加发现项

#### Scenario: Local grant cannot authorize cloud
- **WHEN** 调用 tools.cloud.command.node.run 只持有 local.node.run@2
- **THEN** 拒绝调用

#### Scenario: Render old events
- **WHEN** 显示旧工具 ID 的已存事件
- **THEN** 正确显示已有活动和结果，原记录不改写

## MODIFIED Requirements

### Requirement: 注册工作区依赖解析工具
系统 SHALL 向模型注册只读工具 `tools_local_command_dependencies_load`，返回本次应用包内文档依赖的 Node 解释器、Node 包目录、原生二进制目录与 Python 解释器的绝对路径。该工具 MUST 声明为只读且无网络副作用，MUST NOT 安装、下载或修改任何依赖，MUST NOT 授予其他工具权限，且其不可用时 MUST 返回结构化错误而不回退到用户环境。该工具 SHALL 随 command 插件生命周期注册和回收，旧 `load_workspace_dependencies` 调用 SHALL 仅通过对应 local 兼容别名执行。

#### Scenario: 模型请求依赖路径
- **WHEN** 模型调用 `tools_local_command_dependencies_load` 且该工具本轮已授予
- **THEN** Runtime 返回四个应用包内绝对路径，调用按 `proposed → queued → running → completed` 转移且不产生文件或网络副作用

#### Scenario: 依赖不可用
- **WHEN** 应用包内不存在文档依赖树而模型调用该工具
- **THEN** Runtime 返回 `TOOL_UNAVAILABLE` 类结构化错误，不下载依赖、不回退用户安装的运行时

#### Scenario: Skill 文本不改变权限
- **WHEN** 已启用的文档类 Skill 正文要求使用该工具或其他工具
- **THEN** 只有本轮已授权工具可执行，Skill 文本本身不授予任何权限
