# Complete Figma UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用确定性 Mock 数据实现 ActionDriver Figma 文件中的全部 14 个页面状态与完整组件库，并让每个最近任务进入共享的任务详情页。

**Architecture:** renderer 按 `ui`、`navigation`、`model-selector`、`agent`、`browser`、`settings` 六个语义域组合组件；`MockTaskCatalog` 与现有 service/repository 提供视图 projection；`AppRoute` 判别联合控制页面，不把业务状态放进基础组件。页面结构使用 Grid/Flex，只有菜单、弹层、浏览器浮动控制与目标高亮使用覆盖定位。

**Tech Stack:** Electron 38、React 19、TypeScript 5.9、Slate.js、Ant Design Timeline、Lucide React、Vitest、Testing Library、Playwright。

**Spec:** [OpenSpec design](../../../openspec/changes/implement-complete-figma-ui/design.md)

## Global Constraints

- Figma `action-driver` 文件是视觉事实来源；实现组件前必须先读取 `design.md` 表中具体节点的 `get_design_context`。
- 使用确定性 Mock 数据，不接入真实模型、真实网页、数据库或未设计的 Skills/MCP 页面。
- 所有 Glyph 使用 `AppIcon` 适配或 Figma 原始导出资产，颜色默认继承 `currentColor`。
- 结构布局使用 Flex/Grid/正常文档流；定位仅用于菜单、弹层、浮动控制和目标高亮。
- 基准窗口为 1440×900，最小支持窗口为 1024×700。
- 保留工作区现有未提交改动；每次修改前重新读取目标文件，只使用局部补丁。
- 每项行为变更遵循红—绿—重构，失败测试必须在实现前运行并确认失败原因正确。

## Review Focus

- 不存在的 task ID：保持当前页面或返回可恢复状态，绝不能渲染上一个任务的数据；由 Task 3 集成测试覆盖。
- 模型菜单打开时切换布局或任务：菜单必须关闭且 Slate 草稿不能串到另一任务；由 Task 4 测试覆盖。
- 异步测试/刷新被连续点击：pending 期间只发送一次操作；由 Task 2 和 Task 6 测试覆盖。
- 1024×700 小窗口：主要操作可访问，菜单与对话框不越出可视区域；由 Task 7 E2E 覆盖。
- 删除最后一个模型集后：关闭菜单与确认层并进入真实空状态；由 Task 6 测试覆盖。

---

### Task 1: 锁定 Figma 核对基线

**Files:**
- Create: `design/figma-component-audit.md`
- Modify: `openspec/changes/implement-complete-figma-ui/tasks.md`
- Test: `design/figma-component-audit.md`

**Interfaces:**
- Consumes: `design.md` 中的 14 个画板、19 个 Component Set、Standalone/Composite 和 36 个 Glyph 清单。
- Produces: 表头固定为 `Figma node | variants | implementation | tests | visual status | notes` 的实施核对表。

- [ ] **Step 1: 读取每个具体组件节点的设计上下文**

按 `design.md` 的 Component Sets 表逐项调用 `get_design_context(fileKey="PzmxsQ99mfhqedj4aFYut0", nodeId=...)`；section 返回的 sparse metadata 不能标记为已核对。记录尺寸、间距、颜色、字体、图标、变体和覆盖关系。

- [ ] **Step 2: 读取 14 个画板的设计上下文**

依次读取 `60:5`、`202:750`、`60:7`、`111:247`、`112:409`、`202:1337`、`273:6`、`273:54`、`273:90`、`273:126`、`273:162`、`273:198`、`273:234`、`273:270`，记录每个画板需要的 Mock 触发条件。

- [ ] **Step 3: 建立完整核对表**

使用以下记录格式，不允许空白实现责任：

```md
| `125:222` | Maximize, Restore | `components/browser/BrowserSizeToggle.tsx` | `BrowserSizeToggle.test.tsx` | pending | 32px square |
```

Glyph 行将 `implementation` 写为 `components/ui/AppIcon.tsx#<semantic-name>`；只有确认不匹配的图标才写导出资产路径。

- [ ] **Step 4: 验证清单数量**

Run: `rg -c '^\| `[^`]+` \|' design/figma-component-audit.md`

Expected: 表内含 14 个画板、19 个组件集、所有组合组件和 36 个 Glyph，无临时占位标记或空路径。

- [ ] **Step 5: 运行实现前基线**

Run: `pnpm test && pnpm typecheck && pnpm build`

Expected: 记录命令结果；若存在与本变更无关的已有失败，将命令、失败用例和原始错误写入 audit notes，不修改范围外代码。

### Task 2: 建立基础控件与统一图标适配层

**Files:**
- Create: `apps/desktop/src/renderer/src/components/ui/AppIcon.tsx`
- Create: `apps/desktop/src/renderer/src/components/ui/IconButton.tsx`
- Create: `apps/desktop/src/renderer/src/components/ui/Checkbox.tsx`
- Create: `apps/desktop/src/renderer/src/components/ui/RadioOption.tsx`
- Create: `apps/desktop/src/renderer/src/components/ui/TextButton.tsx`
- Create: `apps/desktop/src/renderer/src/components/ui/TextField.tsx`
- Create: `apps/desktop/src/renderer/src/components/ui/ModelTestStatus.tsx`
- Create: `apps/desktop/src/renderer/src/components/ui/ui.test.tsx`
- Create: `apps/desktop/src/renderer/src/styles/ui.css`
- Modify: `apps/desktop/src/renderer/src/styles/global.css`

**Interfaces:**
- Consumes: Figma nodes `125:222`、`180:755`、`179:275`、`175:243`、`178:244`、`181:770` and the 36-glyph audit.
- Produces: `AppIconName`, `TextButtonVariant`, `TextButtonState`, `ModelTestState`, plus controlled form components.

- [ ] **Step 1: 写图标颜色和控件状态失败测试**

```tsx
it('lets a plus icon inherit the primary button foreground', () => {
  render(<TextButton variant="primary" icon="plus">添加模型集</TextButton>)
  expect(screen.getByRole('button', { name: '添加模型集' })).toHaveClass('text-button-primary')
  expect(screen.getByTestId('app-icon-plus')).toHaveAttribute('data-color', 'currentColor')
})

it.each(['default', 'focused', 'filled', 'error', 'success', 'loading', 'disabled'] as const)(
  'renders text field state %s',
  (state) => {
    render(<TextField label="名称" state={state} value="" onChange={() => undefined} />)
    expect(screen.getByLabelText('名称')).toHaveAttribute('data-state', state)
  }
)
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `pnpm vitest run apps/desktop/src/renderer/src/components/ui/ui.test.tsx`

Expected: FAIL，因为 `TextButton`、`TextField` 和 `AppIcon` 尚不存在。

- [ ] **Step 3: 实现有限联合类型和受控组件**

```ts
export type AppIconName =
  | 'arrow-left' | 'check' | 'chevron-down' | 'chevron-left' | 'chevron-right'
  | 'circle-alert' | 'close' | 'ellipsis' | 'eye' | 'folder' | 'globe' | 'link'
  | 'loader' | 'lock' | 'mcp' | 'maximize' | 'minimize' | 'more-vertical'
  | 'panel-left' | 'panel-right' | 'pause' | 'play' | 'plus' | 'pointer'
  | 'refresh' | 'search' | 'send' | 'server' | 'settings' | 'skill'
  | 'takeover' | 'task' | 'trash' | 'network' | 'cpu' | 'boxes'

export type TextButtonVariant = 'primary' | 'secondary' | 'quiet' | 'danger'
export type TextButtonState = 'default' | 'loading' | 'disabled'
export type ModelTestState = 'untested' | 'testing' | 'success' | 'failed'
```

Hover、focus、pressed 使用 CSS 伪类，loading/disabled/error/success 等数据状态使用属性；不要把每个伪类变成 React boolean prop。

- [ ] **Step 4: 实现语义域样式**

`ui.css` 通过 `currentColor` 控制 svg，不设置 Plus 的固定灰色；所有尺寸和 Token 取自 Task 1 audit。`global.css` 只保留 reset、字体和 `@import`，不得复制组件规则。

- [ ] **Step 5: 运行组件测试和类型检查**

Run: `pnpm vitest run apps/desktop/src/renderer/src/components/ui/ui.test.tsx && pnpm --filter @actiondriver/desktop typecheck`

Expected: PASS，且 19 个组件集核对表中的基础控件项更新为已实现。

### Task 3: 类型化路由、MockTaskCatalog 与侧栏导航

**Files:**
- Create: `apps/desktop/src/renderer/src/models/app-route.ts`
- Create: `apps/desktop/src/renderer/src/services/mock-task-catalog.ts`
- Create: `apps/desktop/src/renderer/src/services/mock-task-catalog.test.ts`
- Create: `apps/desktop/src/renderer/src/components/navigation/SidebarEntry.tsx`
- Create: `apps/desktop/src/renderer/src/components/navigation/RecentTaskItem.tsx`
- Create: `apps/desktop/src/renderer/src/components/navigation/SettingsNavEntry.tsx`
- Create: `apps/desktop/src/renderer/src/styles/navigation.css`
- Modify: `apps/desktop/src/renderer/src/App.tsx`
- Modify: `apps/desktop/src/renderer/src/App.test.tsx`
- Modify: `apps/desktop/src/renderer/src/components/Sidebar.tsx`
- Modify: `apps/desktop/src/renderer/src/components/Sidebar.test.tsx`
- Modify: `apps/desktop/src/renderer/src/di/container.ts`

**Interfaces:**
- Produces: `type AppRoute = {kind:'home'} | {kind:'task'; taskId:string} | {kind:'settings'; returnTo: Exclude<AppRoute,{kind:'settings'}>}`.
- Produces: `RecentTaskSummary` and `MockTaskCatalog.listRecentTasks(): readonly RecentTaskSummary[]`, `getTask(id: string): TaskProjection | null`.

- [ ] **Step 1: 写多任务与未知 ID 失败测试**

```ts
it('returns distinct immutable projections for every recent task', () => {
  const catalog = new MockTaskCatalog()
  const recent = catalog.listRecentTasks()
  expect(recent.length).toBeGreaterThan(1)
  expect(new Set(recent.map((task) => task.id)).size).toBe(recent.length)
  expect(catalog.getTask(recent[0].id)?.title).not.toBe(catalog.getTask(recent[1].id)?.title)
  expect(catalog.getTask('missing-task')).toBeNull()
})
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `pnpm vitest run apps/desktop/src/renderer/src/services/mock-task-catalog.test.ts apps/desktop/src/renderer/src/App.test.tsx`

Expected: FAIL，因为 catalog 和多任务导航尚不存在。

- [ ] **Step 3: 实现 MockTaskCatalog 与 AppRoute**

目录至少包含当前五个最近任务标题，每个 task ID 对应独立的 messages、steps 和 browser projection；每次返回 `structuredClone`，避免组件修改共享 fixture。

- [ ] **Step 4: 用组件重构侧栏并迁移 App**

`Sidebar` 接收 `recentTasks`、`activeTaskId` 和 `onOpenTask(taskId)`；`RecentTaskItem` 接收 `state: 'default' | 'loading'` 与 `active`。未知 ID 不改变 route，也不保留上一个任务的错误映射。

- [ ] **Step 5: 运行导航测试**

Run: `pnpm vitest run apps/desktop/src/renderer/src/services/mock-task-catalog.test.ts apps/desktop/src/renderer/src/components/Sidebar.test.tsx apps/desktop/src/renderer/src/App.test.tsx`

Expected: PASS；五个最近任务均可打开共享 TaskPage，Skills/MCP 点击后 route 不变，设置返回进入前页面。

### Task 4: 组合模型选择器与 AgentComposer

**Files:**
- Create: `apps/desktop/src/renderer/src/models/model-selection.ts`
- Create: `apps/desktop/src/renderer/src/components/model-selector/ModelSelector.tsx`
- Create: `apps/desktop/src/renderer/src/components/model-selector/ModelSelectorTrigger.tsx`
- Create: `apps/desktop/src/renderer/src/components/model-selector/ModelConnectionItem.tsx`
- Create: `apps/desktop/src/renderer/src/components/model-selector/ModelOptionItem.tsx`
- Create: `apps/desktop/src/renderer/src/components/model-selector/ModelSelector.test.tsx`
- Create: `apps/desktop/src/renderer/src/styles/model-selector.css`
- Modify: `apps/desktop/src/renderer/src/components/AgentComposer.tsx`
- Modify: `apps/desktop/src/renderer/src/components/AgentComposer.test.tsx`
- Modify: `apps/desktop/src/renderer/src/pages/HomePage.tsx`
- Modify: `apps/desktop/src/renderer/src/pages/TaskPage.tsx`
- Modify: `apps/desktop/src/renderer/src/pages/pages.test.tsx`

**Interfaces:**
- Produces: `ModelSelectionProjection { connections: readonly ModelConnectionOption[]; selectedModelId: string }`.
- Produces: `ModelSelector({projection,onSelect,onOpenChange})` and Composer props `modelSelection`, `onSelectModel`.

- [ ] **Step 1: 写选择、展开、键盘和草稿保持失败测试**

```tsx
it('selects a model without clearing the Slate draft', async () => {
  const user = userEvent.setup()
  render(<AgentComposer modelSelection={projection} onSelectModel={onSelect} onSubmit={vi.fn()} />)
  await user.type(screen.getByLabelText('任务描述'), '保留这段文字')
  await user.click(screen.getByRole('button', { name: /当前模型/ }))
  await user.click(screen.getByRole('option', { name: 'gpt-4.1' }))
  expect(screen.getByLabelText('任务描述')).toHaveTextContent('保留这段文字')
})
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `pnpm vitest run apps/desktop/src/renderer/src/components/model-selector/ModelSelector.test.tsx apps/desktop/src/renderer/src/components/AgentComposer.test.tsx`

Expected: FAIL，因为模型选择器尚不存在。

- [ ] **Step 3: 实现四个模型选择器组件集**

Trigger 使用 `aria-expanded`/`aria-controls`，Menu 使用 `role="listbox"`，ModelOptionItem 使用 `role="option"`/`aria-selected`。Escape 关闭、上下键移动、Enter 选择；点击外部关闭。连接分组展开状态归 Menu 管理。

- [ ] **Step 4: 组合到 Composer、Home 和 Task**

Composer 保留 Slate editor 实例；打开/关闭 menu 不重建 `Slate`。Home 与 Task 共用同一组件和 mock projection，页面只控制选中模型 ID。

- [ ] **Step 5: 运行模型选择与页面测试**

Run: `pnpm vitest run apps/desktop/src/renderer/src/components/model-selector/ModelSelector.test.tsx apps/desktop/src/renderer/src/components/AgentComposer.test.tsx apps/desktop/src/renderer/src/pages/pages.test.tsx`

Expected: PASS；默认态和打开态都能通过语义查询触发，草稿与任务状态保持。

### Task 5: Task、Conversation 与 Browser 组件化

**Files:**
- Create: `apps/desktop/src/renderer/src/components/browser/BrowserSizeToggle.tsx`
- Create: `apps/desktop/src/renderer/src/components/browser/BrowserTabBar.tsx`
- Create: `apps/desktop/src/renderer/src/components/browser/BrowserNavigationBar.tsx`
- Create: `apps/desktop/src/renderer/src/components/browser/BrowserSkillControls.tsx`
- Create: `apps/desktop/src/renderer/src/components/agent/TaskHeader.tsx`
- Create: `apps/desktop/src/renderer/src/components/agent/UserMessage.tsx`
- Create: `apps/desktop/src/renderer/src/components/agent/AgentResponse.tsx`
- Create: `apps/desktop/src/renderer/src/styles/agent.css`
- Create: `apps/desktop/src/renderer/src/styles/browser.css`
- Modify: `apps/desktop/src/renderer/src/components/BrowserPanel.tsx`
- Modify: `apps/desktop/src/renderer/src/components/BrowserPanel.test.tsx`
- Modify: `apps/desktop/src/renderer/src/components/Conversation.tsx`
- Modify: `apps/desktop/src/renderer/src/components/Conversation.test.tsx`
- Modify: `apps/desktop/src/renderer/src/components/ExecutionTimeline.tsx`
- Modify: `apps/desktop/src/renderer/src/pages/TaskPage.tsx`

**Interfaces:**
- Consumes: `TaskProjection`, `BrowserSkillProjection`, `TaskLayoutMode`.
- Produces: Browser and conversation components with no repository/service imports.

- [ ] **Step 1: 写组合与防重复操作失败测试**

为 BrowserSizeToggle 的 maximize/restore、FloatingControls 的 running/paused/taken-over/pending、消息角色和时间线进度编写测试；pending 测试连续点击两次并断言回调只执行一次。

- [ ] **Step 2: 运行测试并确认失败**

Run: `pnpm vitest run apps/desktop/src/renderer/src/components/BrowserPanel.test.tsx apps/desktop/src/renderer/src/components/Conversation.test.tsx apps/desktop/src/renderer/src/components/ExecutionTimeline.test.tsx`

Expected: 新组合组件相关断言 FAIL。

- [ ] **Step 3: 抽取纯视图组件**

子组件只接收 projection 和事件 props；pending 锁仍保留在 `BrowserSkillControls`。`ExecutionTimeline` 继续使用 Ant Design 的可访问结构，但尺寸和颜色来自 Figma audit。

- [ ] **Step 4: 用 CSS Grid 表达三种 Task 布局**

```css
.task-page[data-mode='split'] { grid-template-columns: 536px minmax(0, 656px); }
.task-page[data-mode='browser-expanded'] { grid-template-columns: minmax(0, 1192px); }
.task-page[data-mode='browser-collapsed'] { grid-template-columns: minmax(0, 1192px); }
```

在 1440 基准宽度之外使用 `minmax()` 和容器宽度，移除 JSX `style={{width}}`；通过条件渲染控制哪个 panel 占据唯一列。

- [ ] **Step 5: 运行 Task 相关测试**

Run: `pnpm vitest run apps/desktop/src/renderer/src/components/BrowserPanel.test.tsx apps/desktop/src/renderer/src/components/Conversation.test.tsx apps/desktop/src/renderer/src/components/ExecutionTimeline.test.tsx apps/desktop/src/renderer/src/pages/pages.test.tsx apps/desktop/src/renderer/src/App.test.tsx`

Expected: PASS；三种布局无 DOM 重叠，切换后任务 projection 与草稿保持。

### Task 6: 完成 Settings 的 8 个页面状态

**Files:**
- Create: `apps/desktop/src/renderer/src/components/settings/SettingsPageTitle.tsx`
- Create: `apps/desktop/src/renderer/src/components/settings/LibraryModelRow.tsx`
- Create: `apps/desktop/src/renderer/src/components/settings/ModelLibrary.tsx`
- Create: `apps/desktop/src/renderer/src/components/settings/ManualModelRow.tsx`
- Create: `apps/desktop/src/renderer/src/components/settings/DeleteModelSetDialog.tsx`
- Create: `apps/desktop/src/renderer/src/components/settings/settings-components.test.tsx`
- Create: `apps/desktop/src/renderer/src/models/add-model-set-state.ts`
- Create: `apps/desktop/src/renderer/src/styles/settings.css`
- Modify: `apps/desktop/src/renderer/src/components/AddModelSetDialog.tsx`
- Modify: `apps/desktop/src/renderer/src/components/ModelConnectionCard.tsx`
- Modify: `apps/desktop/src/renderer/src/components/ModelConnectionsEmptyState.tsx`
- Modify: `apps/desktop/src/renderer/src/components/ModelStatusPill.tsx`
- Modify: `apps/desktop/src/renderer/src/components/ModelToggle.tsx`
- Modify: `apps/desktop/src/renderer/src/components/SettingsSidebar.tsx`
- Modify: `apps/desktop/src/renderer/src/pages/SettingsPage.tsx`
- Modify: `apps/desktop/src/renderer/src/pages/SettingsPage.test.tsx`

**Interfaces:**
- Produces: `AddModelSetState` and reducer actions `update-draft`, `connection-testing`, `connection-result`, `enter-models`, `models-discovered`, `model-testing`, `model-result`, `toggle-model`, `back`.
- Consumes: existing `ModelConnectionsService`; no component directly constructs Mock data.

- [ ] **Step 1: 写 8 个状态与删除确认失败测试**

使用 service deferred promises 固定 Untested→Testing→Partial Failure/Success；删除测试先打开 menu，再点击删除，断言确认前 service 未调用，取消保持卡片，确认后最后一项进入空状态。

- [ ] **Step 2: 运行测试并确认失败**

Run: `pnpm vitest run apps/desktop/src/renderer/src/components/settings/settings-components.test.tsx apps/desktop/src/renderer/src/pages/SettingsPage.test.tsx`

Expected: 新状态和删除确认相关断言 FAIL。

- [ ] **Step 3: 实现 reducer 并保留 wizard 状态**

```ts
export type AddModelSetState = {
  step: 'connection' | 'models'
  draft: ModelConnectionDraft
  connectionState: 'idle' | 'testing' | 'success' | 'failed'
  models: readonly ModelOption[]
  discovering: boolean
}
```

返回上一步只修改 `step`，不得清空 `draft`、`models` 或结果；异步 action 通过 operation token 忽略过期响应。

- [ ] **Step 4: 组合设置组件与删除确认**

ConnectionCard、ModelLibrary、rows 和 status 复用 Task 2 控件；更多菜单和确认层遵循 Figma 尺寸。产品页不得呈现额外 Status Summary 行。

- [ ] **Step 5: 运行 Settings 测试**

Run: `pnpm vitest run apps/desktop/src/renderer/src/components/settings/settings-components.test.tsx apps/desktop/src/renderer/src/pages/SettingsPage.test.tsx apps/desktop/src/renderer/src/services/mock-model-connections.test.ts`

Expected: PASS；8 个状态均可确定性触发，步骤往返保留数据，连续操作不会重复调用 service。

### Task 7: 全页面视觉回归与最终验证

**Files:**
- Modify: `apps/desktop/e2e/app.spec.ts`
- Modify: `apps/desktop/tests/visual-baseline.test.ts`
- Modify: `design/actual/*.png`
- Modify: `design/figma-component-audit.md`
- Modify: `openspec/changes/implement-complete-figma-ui/tasks.md`

**Interfaces:**
- Consumes: 14 个产品画板触发器和所有组件测试。
- Produces: 1440×900 验收截图、1024×700 可用性断言、最终组件覆盖状态。

- [ ] **Step 1: 写 14 个场景和最小窗口失败 E2E**

为每个 Figma 画板建立具名场景；使用测试专用 Mock 初始状态或公开 UI 操作触发，不通过修改 React 内部状态。1024×700 场景断言主要按钮 bounding box 在 viewport 内且关键区域不相交。

- [ ] **Step 2: 运行 E2E 并确认视觉差异**

Run: `pnpm test:e2e`

Expected: 新增场景最初因截图缺失或像素差异 FAIL；保存差异作为修正依据，不直接放宽阈值。

- [ ] **Step 3: 对照 Figma 修正视觉**

按 audit 的顺序修正 Token、字体、尺寸、间距、圆角、阴影、层级和图标；每次只修改负责该差异的语义域 CSS/组件，禁止用页面绝对坐标补丁掩盖组件错误。

- [ ] **Step 4: 更新截图和核对表**

只在人工/像素检查确认与 Figma 一致后更新 `design/actual`。将 audit 的 `visual status` 改为 passed，并填写具体测试路径和截图文件。

- [ ] **Step 5: 运行完整验证**

Run: `pnpm test && pnpm typecheck && pnpm lint && pnpm build && pnpm test:e2e`

Expected: 所有命令 exit 0。

- [ ] **Step 6: 验证 OpenSpec 和范围**

Run: `openspec validate implement-complete-figma-ui --strict && git diff --check && git status --short`

Expected: OpenSpec strict validation PASS，`git diff --check` 无输出，status 只包含本变更文件与开始前已记录的用户改动。

- [ ] **Step 7: 完成自检**

逐项核对 `design.md`：14/14 产品画板、19/19 Component Sets、全部 Standalone/Composite、36/36 Glyph 均有实现/映射、测试和视觉结果；不存在临时占位、含糊引用或未裁决的新产品行为。
