## 1. 查询与组件边界

- [x] 1.1 补充 Skills 列表刷新、选中项同步和加载失败的定向测试，并确认 `pnpm vitest run apps/desktop/tests/unit/renderer/src/pages/AgentSettingsPages.test.tsx` 运行结果。
- [x] 1.2 用 `useQuery` 直接呈现列表、精确失效刷新，移除本地 `skills` 副本；运行同一 Skills 页面定向测试。
- [x] 1.3 拆出列表、文件树、详情工作区与操作表单组件，保留页面 props、服务行为和 e2e 标识；运行同一定向测试并做 TypeScript 检查。

## 2. 弹窗与验证

- [x] 2.1 加入固定版本 `@radix-ui/react-dialog`，迁移详情及操作弹窗，删除手写焦点循环；用定向测试验证 Escape、Tab、关闭后焦点与忙碌时不可关闭。
- [x] 2.2 验证受保护 Skill、编辑保存、创建/重命名/卸载及门户层级的现有行为；运行 Skills 页面定向测试，必要时执行针对设置页的本地界面验证。

## 验证记录

- 状态边界：页面改用 `useQuery({ queryKey: ['skills'], staleTime: 30_000, retry: false })`；本地 `skills` 副本与 `fetchQuery` 同步代码删除，选中项改为按 id 从列表派生；写入后用 `invalidateQueries + fetchQuery` 精确刷新，开关改为乐观更新 Query 缓存并在失败时回滚。
- 组件边界：新增 `pages/skills/SkillListPanel.tsx`、`SkillDetailDialog.tsx`、`SkillActionDialog.tsx`、`SkillFileTree.tsx`、`skill-presentation.ts`；`SkillsPage.tsx` 723 行 → 357 行只保留服务调用与状态协调。页面 props、服务方法、类名与 e2e 标识全部保留。
- 弹窗：引入固定版本 `@radix-ui/react-dialog@1.1.23`；详情与操作弹窗共用同一 primitive，删除自建 `document` 键盘循环。焦点进入即落在「关闭 Skill 详情」按钮，Tab/Shift+Tab 被限制在弹窗内，Escape 关闭并把焦点还给打开它的行；提交进行中 Escape、遮罩点击与取消按钮均不生效。
- 弹窗保持内联渲染（不使用 Portal），因为既有测试与 `inert` 语义都依赖列表留在同一棵树中；`settings.css` 为 Radix 的 overlay/内容兄弟结构补充固定居中规则。
- 新增 3 项定向断言（列表刷新后详情与列表行同步、弹窗焦点约束与关闭后焦点归还、忙碌时不可关闭）；`pnpm vitest run apps/desktop/tests/unit/renderer/src/pages/AgentSettingsPages.test.tsx` 23 项通过（原有 20 项全部保留，其中 1 项因 Radix 会把背景标记为 inert 而改为显式 `hidden: true` 断言列表仍挂载）。
- `pnpm --filter @action-driver/desktop typecheck` 与改动文件 ESLint 通过。
