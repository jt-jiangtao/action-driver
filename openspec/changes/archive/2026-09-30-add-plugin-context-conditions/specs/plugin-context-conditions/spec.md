## Purpose

为插件贡献提供由宿主维护的可序列化上下文键和声明式条件，使可用性随状态变化确定地更新，并可被命令、工具以及后续菜单和视图贡献共同使用。

## ADDED Requirements

### Requirement: Scoped context keys
系统 SHALL 支持宿主键和按插件实例归属的键；插件 MUST 只能设置或移除自身命名空间中的布尔、字符串或有限数字值，MUST NOT 读取或覆盖未授权的宿主私有状态。插件停用、升级或崩溃时，其旧实例的键 SHALL 被回收，迟到更新 MUST 被拒绝。

#### Scenario: 插件更新自己的键
- **WHEN** 活跃插件更新其命名空间中的键
- **THEN** 宿主发布新上下文版本，相关条件重新求值

#### Scenario: 旧实例迟到更新
- **WHEN** 已停用或升级的插件实例试图更新上下文键
- **THEN** 宿主拒绝更新，当前实例的键和值不变

### Requirement: Deterministic declarative conditions
系统 SHALL 校验并求值受限条件表达式：布尔键、字符串或数字相等比较、`!`、`&&`、`||` 和括号。求值 MUST 使用单个不可变上下文快照；表达式引用任何未知键时，整个条件 MUST 为 false，包括对该键取反的表达式。非法表达式 MUST 在贡献发布前失败，并提供可定位的诊断。表达式 MUST NOT 执行脚本或插件回调。

#### Scenario: 键变化后重新求值
- **WHEN** 条件为 `plugin.ready && host.online` 且一个已知键从 false 变为 true
- **THEN** 宿主使用新版本快照更新该条件的结果

#### Scenario: 未知键被取反
- **WHEN** 条件为 `!plugin.missing` 且 `plugin.missing` 从未设置
- **THEN** 条件结果仍为 false

#### Scenario: 无效或过大表达式
- **WHEN** 插件提交语法错误或超过长度、深度、键数量上限的条件
- **THEN** 宿主拒绝该声明并报告出错位置或限制，不发布部分贡献

### Requirement: Reusable availability projection
系统 SHALL 提供按上下文版本求值的可用性结果及变更通知，供现有命令和工具以及独立规划的菜单、视图贡献消费。上下文变化 MUST NOT 单独触发插件重新激活；未声明条件的旧贡献 SHALL 保持既有可用性行为。

#### Scenario: 活跃贡献状态变化
- **WHEN** 已发布贡献依赖的上下文键变化
- **THEN** 消费者获得新版本的可用性结果，而插件实例保持原生命周期

#### Scenario: 旧插件未声明条件
- **WHEN** 旧插件的贡献没有条件字段
- **THEN** 其可用性仅受原有生命周期与授权规则影响
