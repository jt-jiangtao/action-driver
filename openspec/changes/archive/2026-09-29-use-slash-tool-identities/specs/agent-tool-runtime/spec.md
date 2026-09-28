## MODIFIED Requirements

### Requirement: Target and plugin qualified tool identities
内置工具 SHALL 使用 `tools/<target>/<plugin>/<operation>` 标识，层级仅以 `/` 分隔；target SHALL 是 local/cloud 执行上下文归属而不是是否联网。operation 可由一个或多个 `/` 分隔的片段组成。模型名称 SHALL 继续使用下划线形式，版本与名称分离。同一能力在不同 target 下 SHALL 使用不同标识与 grants。新注册工具、发现列表、调用事件和授权 SHALL 使用相同的斜杠 ID。

#### Scenario: Discover a local plugin tool
- **WHEN** Agent 发现本地 command Node 工具
- **THEN** 仅展示 `tools/local/command/node/run` 与 `tools_local_command_node_run`，工具 ID 不含点号

#### Scenario: No cloud binding
- **WHEN** 请求 cloud 工具但只有 local 实现及授权
- **THEN** 明确不可用或拒绝，不回退到本机执行

#### Scenario: Dot-separated tool identity is rejected
- **WHEN** 插件声明或调用使用点号工具 ID
- **THEN** 系统拒绝该 ID，不将其映射到斜杠工具或沿用旧授权

### Requirement: 注册工作区依赖解析工具
系统 SHALL 向模型注册只读工具 `tools_local_command_dependencies_load`，返回本次应用包内文档依赖的 Node 解释器、Node 包目录、原生二进制目录与 Python 解释器的绝对路径。该工具 MUST 声明为只读且无网络副作用，MUST NOT 安装、下载或修改任何依赖，MUST NOT 授予其他工具权限，且其不可用时 MUST 返回结构化错误而不回退到用户环境。该工具 SHALL 随 command 插件生命周期注册和回收，其内部工具 ID SHALL 为 `tools/local/command/dependencies/load`。

#### Scenario: 模型请求依赖路径
- **WHEN** 模型调用 `tools_local_command_dependencies_load` 且该工具本轮已授予
- **THEN** Runtime 返回四个应用包内绝对路径，调用按 `proposed → queued → running → completed` 转移且不产生文件或网络副作用

#### Scenario: 依赖不可用
- **WHEN** 应用包内不存在文档依赖树而模型调用该工具
- **THEN** Runtime 返回 `TOOL_UNAVAILABLE` 类结构化错误，不下载依赖、不回退用户安装的运行时

#### Scenario: Skill 文本不改变权限
- **WHEN** 已启用的文档类 Skill 正文要求使用该工具或其他工具
- **THEN** 只有本轮已授权工具可执行，Skill 文本本身不授予任何权限

## REMOVED Requirements

### Requirement: Explicit legacy local tool compatibility
**Reason**: 用户明确裁决工具 ID 一次性切换，不保留点号工具标识、旧模型名或旧 grants 的兼容映射。
**Migration**: 无自动迁移；调用方和插件作者须改用斜杠工具 ID 重新声明授权。历史记录保留原始数据，不据此恢复执行旧工具调用。
