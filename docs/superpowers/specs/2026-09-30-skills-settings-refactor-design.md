## Context

`SkillsPage` 通过 `fetchQuery` 拉取列表后复制到本地 `skills` state；详情弹窗自建键盘循环，操作弹窗另有一套遮罩。现有 `SettingsPage` 已用 `useQuery`，桌面端尚无 Radix 依赖。参见 proposal.md。

## Goals / Non-Goals

**Goals:** 列表只有 Query 缓存一个服务端事实来源；UI 组件按列表、详情、文件树、操作表单分责；所有 Skills 弹窗具备一致的模态焦点行为。

**Non-Goals:** 不改变 AgentFilesService、Skill 存储、页面导航、文案或其它设置页弹窗。

## Decisions

1. **状态边界。** `useQuery({ queryKey: ['skills'], queryFn: service.listSkills, staleTime: 30_000, retry: false })` 提供列表；变更后用精确查询失效刷新。保留查询词、选中 ID、文件与编辑草稿、表单和提交状态为本地状态。详情摘要从列表按 ID 派生，避免列表刷新后旧对象驻留；删除后关闭详情。可行替代是继续 `fetchQuery` 并同步两份 state，改动少但仍有失同步窗口。用户裁决采用单一 Query 来源。
2. **组件边界。** 页面协调服务调用；列表、详情工作区（含文件树与编辑器区）、操作弹窗各接收明确 props，数据读写通过回调返回页面。避免把服务对象任意传给展示组件。
3. **Dialog。** 引入 `@radix-ui/react-dialog`，让详情与操作弹窗使用同一 primitive。用受控 open 状态保持现有按钮入口；通过 `Dialog.Content` 的自动焦点与关闭回调替代 document 级按键监听，并在忙碌提交时阻止关闭。原生 `<dialog>` 可免依赖，但需要自行协调嵌套模态、React 生命周期和测试环境。用户明确选择 Radix。

## Risks / Trade-offs

- [新依赖及 Electron/测试兼容性] → 固定版本，定向验证打开、Tab、Escape、关闭后焦点及嵌套操作弹窗。
- [列表刷新导致选中项或编辑草稿变化] → 用稳定 ID 派生摘要，编辑草稿只在明确切换文件或保存时重置。
- [现有 CSS 与门户层级差异] → 保留现有类名和测试标识，检查遮罩、详情与操作弹窗的层级。

用户未覆盖 Agent 推荐。可逐文件回退此重构；没有数据迁移。
