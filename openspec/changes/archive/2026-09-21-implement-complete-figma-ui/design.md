## Context

见 [proposal.md](./proposal.md) 的 Why。当前 renderer 已有 `HomePage`、`TaskPage`、`SettingsPage`、侧栏、Composer、BrowserPanel 与部分设置组件，但路由使用页面内字符串状态，最近任务数据硬编码且只有首项可打开，模型选择器尚未实现，通用控件状态主要由页面私有 CSS 表达。

Figma 文件以 `00 Foundations`、`01 Components`、`02 Home`、`03 Task`、`04 Settings` 分页组织。组件页是重复 UI 的权威来源；页面画板用于验证组合、尺寸和覆盖关系。Figma 节点 `60:4` 是页面而非可直接实现的画板，因此设计转代码必须针对下表中的具体组件或画板节点调用 `get_design_context`。

## Goals / Non-Goals

**Goals:**

- 对全部 14 个产品画板状态和全部组件集建立可追踪实现与测试。
- 以小而稳定的组件 API 表达视觉状态，避免页面复制和布尔属性爆炸。
- 将 Mock 数据与 React 视图分离，使后续真实 repository/service 可替换 Mock，而无需重写页面。
- 在 1440×900 精确匹配设计，并在 1024×700 保持可用。
- 保留工作区已有实现与测试，通过渐进抽取而非整体重写完成迁移。

**Non-Goals:**

- 不新增独立“最近任务列表页”、Skills 页面或 MCP 页面。
- 不接入真实模型、真实网页或持久化数据库。
- 不为每个 Glyph 创建独立空壳 React 文件。
- 不修改 Electron 主进程边界或运行时协议。

## Decisions

### 1. 最近任务使用共享任务页面和类型化 Mock 目录

新增只读 `MockTaskCatalog`，暴露 `listRecentTasks()` 与 `getTask(taskId)`；`App` 只保存类型化 route、当前 task ID 和布局状态。所有最近任务按钮使用稳定 ID 打开同一个 `TaskPage`，页面内容来自 task projection。

替代方案 A 是为每条任务复制页面数据与组件，能快速贴图，但会让任务数量和组件树同步增长。替代方案 B 是新增任务列表页，但 Figma 没有对应画板且会扩大产品范围。最终裁决选择共享详情页；用户已明确确认，没有覆盖 Agent 建议。

### 2. 组件按语义域拆分，变体用有限联合类型表达

组件分为 `ui`、`navigation`、`model-selector`、`agent`、`browser`、`settings` 六个语义域。状态属性使用联合类型，例如 `TextButtonState`、`ModelTestState`、`TaskLayoutMode`，复杂结构使用子组件组合；页面只负责组合与业务事件连接。

替代方案是严格按每个 Figma node 建一个文件。它具有机械的一一对应，但 33 个基础 Glyph 与大量单状态节点会形成薄包装、隐藏真实复用边界。最终裁决选择“交互/组合组件一一映射，Glyph 统一适配”。

### 3. 图标由单一适配层控制

`ui/AppIcon.tsx` 维护语义名到现有 Lucide glyph 或既有品牌资产的映射，并统一 `size`、`strokeWidth`、`aria-hidden` 与 `currentColor`。按钮和状态组件拥有颜色，图标不得写死前景色。只有 Figma glyph 与 Lucide 明显不匹配时才下载并提交 Figma 导出资产。

### 4. 页面布局采用 Grid/Flex，定位限定在覆盖层

Shell 使用两列 Grid 或 Flex；Task 工作区通过布局 mode 切换列模板；设置页内容使用 max-width 容器；卡片、表格、对话流使用 Grid/Flex。仅模型菜单/更多菜单/对话框、浏览器浮动控制条和目标高亮使用定位。现有 JSX 内联宽度将迁移到 data-state/class 驱动的 CSS 约束。

### 5. 组件核对先于对应代码修改

每个实现任务开始时必须对目标节点调用 `get_design_context`，读取参考代码和截图，再核对现有组件与 Token。组件页 section 的 sparse metadata 只用于清点，不能替代子节点 context。完成后在核对矩阵记录代码路径、测试和视觉验收结果。

### 6. 测试分为组件行为、页面组合和截图三层

- Vitest + Testing Library：控件状态、可访问属性、输入保持、任务切换和 Mock service 行为。
- App 集成测试：Home/Task/Settings 路由和跨组件状态。
- Electron E2E：14 个产品画板对应的确定性场景，在 1440×900 截图并与 `design/actual` 验收图核对；另做 1024×700 无重叠检查。

## Figma 页面核对矩阵

| 页面 | 节点 | 必须覆盖的状态 |
|---|---|---|
| Home | `60:5` | 默认首页 |
| Home | `202:750` | Composer 模型选择器打开 |
| Task | `60:7` | 默认分栏 |
| Task | `111:247` | 浏览器放大 |
| Task | `112:409` | 浏览器折叠 |
| Task | `202:1337` | Task Composer 模型选择器打开 |
| Settings | `273:6` | 有数据 |
| Settings | `273:54` | 空状态 |
| Settings | `273:90` | 更多菜单打开 |
| Settings | `273:126` | 连接配置 |
| Settings | `273:162` | 模型未测试 |
| Settings | `273:198` | 测试中 |
| Settings | `273:234` | 部分失败 |
| Settings | `273:270` | 全部成功 |

## Figma 组件核对矩阵

### Component Sets（19/19）

| Figma 组件集节点 | React 责任 | 变体核对 |
|---|---|---|
| `125:222` Button/Browser Size Toggle | `BrowserSizeToggle` | Maximize、Restore |
| `180:755` Control/Checkbox | `Checkbox` | false/true、disabled、indeterminate |
| `179:275` Control/Radio Option | `RadioOption` | selected false/true |
| `175:243` Control/Text Button | `TextButton` | Primary/Secondary/Quiet/Danger × Default/Hover/Focus/Pressed/Loading/Disabled |
| `178:244` Control/Text Field | `TextField` | Default/Focused/Filled/Error/Success/Loading/Disabled |
| `181:770` Status/Model Test | `ModelTestStatus` | Passed/Failed/Testing/Untested |
| `191:839` Navigation/Settings Entry | `SettingsNavEntry` | Default/Hover/Selected |
| `235:3693` Navigation/Sidebar Entry | `SidebarEntry` | Default/Selected |
| `235:3700` Navigation/Recent Task | `RecentTaskItem` | Default/Loading，另由页面表达 active |
| `266:786` Settings/Model Status | `ModelStatusPill` | Untested/Testing/Success/Failed |
| `267:829` Settings/Picker Model Row | `ModelPickerRow` | Selected true 的四状态及 Selected false/Untested |
| `267:840` Settings/Library Model Row | `LibraryModelRow` | Enabled true/false |
| `267:941` Settings/Connection Card | `ModelConnectionCard` | Expanded/Collapsed/Menu Open |
| `270:957` Settings/Model Library | `ModelLibrary` | Populated/Empty/Menu Open |
| `271:1272` Settings/Add Model Set | `AddModelSetDialog` | Connection Default/Success；Models Untested/Testing/Partial Failure/Success |
| `197:895` Model Selector/Connection Item | `ModelConnectionItem` | Expanded true/false × Default/Hover |
| `197:896` Model Selector/Model Item | `ModelOptionItem` | Default/Hover/Selected |
| `197:897` Model Selector/Trigger | `ModelSelectorTrigger` | Default/Hover/Open |
| `235:3537` Agent/Composer | `AgentComposer` | Default/Model Selecting；运行中断状态由任务契约补充 |

### Standalone / Composite Components

| Figma 节点 | React 责任 |
|---|---|
| `62:5` Brand/Logo Mark | 复用 `ActionDriverLogo` |
| `63:51`、`63:63`、`63:59`、`63:55`、`63:67` | `IconButton` + `AppIcon` 的 PanelLeft/PanelRight/Plus/Search/Send |
| `110:180` Browser/Tab Bar · Expanded | `BrowserTabBar` |
| `110:216` Browser/Navigation Bar · Expanded | `BrowserNavigationBar` |
| `235:3717` Browser/Floating Controls | `BrowserSkillControls` |
| `235:3762` Shell/Sidebar | `Sidebar` 组合 |
| `235:3709` Settings/Page Title | `SettingsPageTitle` |
| `266:744` Settings/Sidebar | `SettingsSidebar` |
| `287:1164` Settings/Manual Add Row | `ManualModelRow`，仅在弹层交互中按设计呈现 |
| `199:895` Model Selector/Menu | `ModelSelectorMenu` |
| `118:217` Agent/Execution Timeline · AntD / Wide | `ExecutionTimeline` |
| `235:3701` Agent/Conversation Header | `TaskHeader` |
| `235:3705` Agent/User Message | `UserMessage` |
| `235:3707` Agent/Response | `AgentResponse` |
| `271:997` Status Summary | 仅用于设计核对；产品画板不要求额外汇总行 |

### Glyph Mapping（36/36）

统一适配层必须覆盖：ArrowLeft、Check、ChevronDown、ChevronLeft、ChevronRight、CircleAlert、Close、Ellipsis、Eye、Folder、Globe、Link、Loader、Lock、MCP、Maximize、Minimize2、MoreVertical、PanelLeft、PanelRight、Pause、Play、Plus、Pointer、Refresh、Search、Send、Server、Settings、Skill、Takeover、Task、Trash2、Network、Cpu、Boxes。每个 glyph 均须与 Figma 导出视觉比对；无法确认匹配时使用原始导出资产。

## Data and State Boundaries

- `AppRoute` 使用判别联合：home、task(taskId)、settings(returnTo)。
- `MockTaskCatalog` 拥有最近任务目录；`AgentSessionRepository` 继续拥有活动任务投影和订阅。
- `ModelSelector` 接收已启用连接/模型的只读 projection，并通过 `selectedModelId/onSelect` 通知页面，不直接访问设置 service。
- Settings wizard state 局部保存在 dialog reducer 中，步骤切换不重建 draft、selection 或 test results。
- 菜单、hover、focus 等短生命周期 UI 状态留在组件内部；跨页面/跨任务状态不得放入通用组件。

## Risks / Trade-offs

- [Figma 组件 section 只返回 sparse metadata] → 每项实现前读取表中具体子节点 context，并用截图验证，禁止仅凭 section 清单编码。
- [当前工作区有大量未提交改动] → 应用阶段逐文件读取最新内容、采用小补丁并在每组任务后运行局部测试，禁止覆盖式重写。
- [一次实现全部状态容易形成巨型 CSS] → 按语义域拆分 CSS 文件并通过共享 Token/组件状态类去重。
- [Hover/pressed 的单元测试不能证明像素准确] → 行为测试负责状态可达，E2E 截图负责视觉组合。
- [Lucide 与 Figma glyph 可能存在细微差异] → 逐图标比对，明显不匹配时提交 Figma 导出资产。
- [Mock 数据可能被误写进视图] → 数据集中在 catalog/service，页面只消费接口。

## Migration Plan

1. 先补组件覆盖矩阵、基础控件和图标适配层，不改变页面路由。
2. 引入类型化 Mock 任务目录和 route，迁移侧栏最近任务。
3. 接入模型选择器并完成 Home/Task 状态。
4. 迁移 Settings 到共享控件并补齐 8 个状态。
5. 完成 14 个画板截图与最小窗口验证，移除确认无引用的旧样式。

每一步都保持应用可运行。若回滚，按相反顺序撤销对应小提交；不涉及数据迁移。
