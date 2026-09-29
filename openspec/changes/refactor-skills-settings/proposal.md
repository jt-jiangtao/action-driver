## Why

Skills 设置页把服务端列表数据再次保存到本地 state，且同时负责列表、文件工作区与弹窗交互，增加了状态失同步和焦点回归的风险。整理这些职责可让现有 Skill 管理行为更容易维护和验证。

## What Changes

- 由现有 TanStack Query 查询直接驱动 Skill 列表，保留编辑草稿等必要的本地状态。
- 将列表、详情工作区、文件树和操作弹窗拆成职责明确的组件。
- 使用单一 Radix Dialog primitive 承担详情与操作弹窗的焦点约束、Escape 和焦点恢复，保留现有操作与测试标识。
- 保留服务调用、错误提示、受保护 Skill 限制和可见的用户流程。

Battle 已完成，用户明确接受上述方向。原生 `<dialog>` 是已比较的可行替代方案；此变更选择 Radix 以减少当前手写焦点逻辑。无未裁决关键分歧。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

无。此次为现有 Skill 设置行为的内部整理，不更改已发布的需求契约；`.openspec.yaml` 使用 `skip_specs: true`。

## Impact

涉及 `SkillsPage.tsx`、新增的页内组件、桌面端依赖及对应单元测试。公共页面 props、AgentFilesService 契约和 Skill 存储不变。
