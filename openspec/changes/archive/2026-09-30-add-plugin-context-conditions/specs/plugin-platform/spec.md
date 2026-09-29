## ADDED Requirements

### Requirement: Declarative availability for existing contributions
插件的现有命令与工具贡献 SHALL 可声明可选条件。宿主 SHALL 在发现时结合插件生命周期和条件结果，在直接调用开始前再次检查当前条件；条件为 false 时 SHALL 拒绝新调用。条件 SHALL 不授予权限，也 MUST NOT 绕过跨插件依赖、grants、输入校验或资源隔离。

本变更尚未接入的贡献种类 MUST NOT 接受 `when` 声明；后续贡献变更只有在具备相同发现和调用检查时才能扩展该字段。

#### Scenario: 命令条件从可用变为不可用
- **WHEN** 已发布命令的条件在上下文变化后变为 false
- **THEN** 命令不再作为可用项呈现，直接调用在处理器运行前被拒绝

#### Scenario: 条件为真但缺少授权
- **WHEN** 命令或工具条件为 true，但调用者没有原有授权
- **THEN** 宿主仍拒绝调用且不执行插件处理器

#### Scenario: 旧清单没有条件
- **WHEN** 兼容的旧插件清单未声明条件
- **THEN** 宿主按原有贡献注册和回收规则运行该插件

#### Scenario: 尚未接入条件的 Skill
- **WHEN** 插件在 Skill 贡献上声明 `when`
- **THEN** 宿主拒绝该清单，不把该 Skill 当作无条件可用
