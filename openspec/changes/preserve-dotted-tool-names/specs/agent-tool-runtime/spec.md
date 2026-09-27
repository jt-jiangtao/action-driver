## MODIFIED Requirements

### Requirement: Target and plugin qualified tool identities
内置工具 SHALL 使用 tools.<target>.<plugin>.<operation> 标识，target SHALL 是 local/cloud 执行上下文归属而不是是否联网。公开模型名称 SHALL 保留点号，与内置工具 ID 相同；下划线兼容转换 SHALL 仅发生于模型协议发送边界，回传准备事件与调用 SHALL 恢复公开名称，版本与名称分离。同一能力在不同 target 下 SHALL 使用不同标识与 grants。

#### Scenario: Discover a local plugin tool
- **WHEN** Agent 发现本地 command Node 工具
- **THEN** 仅展示 tools.local.command.node.run 作为工具 ID 和公开模型名称，不展示旧别名

#### Scenario: No cloud binding
- **WHEN** 请求 cloud 工具但只有 local 实现及授权
- **THEN** 明确不可用或拒绝，不回退到本机执行


## ADDED Requirements

### Requirement: Provider scoped tool name mapping
模型协议适配 SHALL 对工具声明、历史调用和结果名称使用一致的兼容映射；MUST NOT 让兼容名称替代插件 API 或 Runtime 调用名。转换冲突、非法名称或超过协议长度限制 SHALL 在发送前拒绝。旧内置短名称、下划线名称和旧授权别名 SHALL 不注册，目录仅展示公开点分隔名称。

#### Scenario: Stream a dotted tool call
- **WHEN** provider 回传兼容名称的准备事件和工具调用
- **THEN** Runtime 接收原公开点分隔名称，工具正确执行

#### Scenario: Replay tool history
- **WHEN** 已有工具调用与结果被发送给模型继续对话
- **THEN** 声明、调用和结果使用同一协议兼容名称，持久化历史保持原数据

#### Scenario: Ambiguous protocol names
- **WHEN** 两个不同公开名称转换到同一协议名称
- **THEN** 请求明确失败，不发送歧义工具集合

## REMOVED Requirements

### Requirement: Explicit legacy local tool compatibility
**Reason**: 用户确认项目尚未发布，不保留旧工具名称兼容与迁移层。
**Migration**: 开发环境直接使用点分隔公开名称和对应 grants，不兼容旧测试数据。
