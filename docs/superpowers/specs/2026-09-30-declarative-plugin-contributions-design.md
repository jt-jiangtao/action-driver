# 插件声明式贡献平台

## 目标

让插件以版本化声明提供命令、工具、Skill、面板、视图和菜单。宿主可在不激活插件执行代码的情况下发现贡献，并在激活、停用、升级和故障期间保持统一归属、授权和回收。完整行为契约见 [OpenSpec](../../../openspec/changes/extend-declarative-plugin-contributions/specs/plugin-platform/spec.md)。

## 边界与设计

扩展现有 manifest、catalog、插件管理器和 Desktop 受控面板宿主，不建立第二套贡献注册表。菜单只引用已声明命令，视图只通过受控桥接渲染。显示与执行都依赖首个新会话建设的权威上下文条件；直接调用必须重新校验条件和 grants。旧插件按既有贡献继续运行，要求新协议的插件在旧宿主上明确失败。

## 已裁决的取舍

曾比较先只补少数入口与完整覆盖六类贡献。推荐渐进首版以降低接口与迁移成本；用户选择完整覆盖，并确认六类入口、发现、冲突、激活和卸载都纳入本次 spec。主要风险是公共 API 扩张与视图安全面增加，缓解方式是版本化契约、原子发布、受控消息桥和兼容测试。实施顺序见 [OpenSpec tasks](../../../openspec/changes/extend-declarative-plugin-contributions/tasks.md)。
