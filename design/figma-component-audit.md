# Figma 组件与页面核对表

来源：[ActionDriver Figma](https://www.figma.com/design/PzmxsQ99mfhqedj4aFYut0/action-driver?node-id=60-4)。每一行均已读取具体节点的 `get_design_context`；实现完成后将 visual status 更新为运行截图结果。

## Product Frames（14/14）

| Figma node | variants | implementation | tests | visual status | notes |
|---|---|---|---|---|---|
| `60:5` | Home default | `pages/HomePage.tsx` | `pages/pages.test.tsx`, `e2e/app.spec.ts` | passed | `design/actual/home-default.png`，720px composer |
| `202:750` | Home model selecting | `pages/HomePage.tsx` | `components/model-selector/ModelSelector.test.tsx`, `e2e/app.spec.ts` | passed | `design/actual/home-model-selecting.png` |
| `60:7` | Task split | `pages/TaskPage.tsx` | `pages/pages.test.tsx`, `e2e/app.spec.ts` | passed | `design/actual/task-split.png`，248/536/656 columns |
| `111:247` | browser expanded | `pages/TaskPage.tsx` | `pages/pages.test.tsx`, `e2e/app.spec.ts` | passed | `design/actual/task-browser-expanded.png` |
| `112:409` | browser collapsed | `pages/TaskPage.tsx` | `pages/pages.test.tsx`, `e2e/app.spec.ts` | passed | `design/actual/task-browser-collapsed.png` |
| `202:1337` | Task model selecting | `pages/TaskPage.tsx` | `components/model-selector/ModelSelector.test.tsx`, `e2e/app.spec.ts` | passed | `design/actual/task-model-selecting.png` |
| `273:6` | Settings populated | `pages/SettingsPage.tsx` | `pages/SettingsPage.test.tsx`, `e2e/app.spec.ts` | passed | `design/actual/settings-populated.png` |
| `273:54` | Settings empty | `pages/SettingsPage.tsx` | `pages/SettingsPage.test.tsx`, `e2e/app.spec.ts` | passed | `design/actual/settings-empty.png` |
| `273:90` | Settings menu open | `pages/SettingsPage.tsx` | `pages/SettingsPage.test.tsx`, `e2e/app.spec.ts` | passed | `design/actual/settings-menu-open.png` |
| `273:126` | connection form | `components/AddModelSetDialog.tsx` | `pages/SettingsPage.test.tsx`, `e2e/app.spec.ts` | passed | `design/actual/settings-connection-form.png` |
| `273:162` | models untested | `components/AddModelSetDialog.tsx` | `pages/SettingsPage.test.tsx`, `e2e/app.spec.ts` | passed | `design/actual/settings-models-untested.png` |
| `273:198` | models testing | `components/AddModelSetDialog.tsx` | `pages/SettingsPage.test.tsx`, `e2e/app.spec.ts` | passed | `design/actual/settings-models-testing.png` |
| `273:234` | partial failure | `components/AddModelSetDialog.tsx` | `pages/SettingsPage.test.tsx`, `e2e/app.spec.ts` | passed | `design/actual/settings-models-partial-failure.png` |
| `273:270` | all success | `components/AddModelSetDialog.tsx` | `pages/SettingsPage.test.tsx`, `e2e/app.spec.ts` | passed | `design/actual/settings-models-success.png` |

## Component Sets（19/19）

| Figma node | variants | implementation | tests | visual status | notes |
|---|---|---|---|---|---|
| `125:222` | Maximize, Restore | `components/browser/BrowserSizeToggle.tsx` | `components/BrowserPanel.test.tsx` | passed | 32px square, icon-only |
| `180:755` | false/true, disabled, indeterminate | `components/ui/Checkbox.tsx` | `components/ui/ui.test.tsx` | passed | 18px row, optional label |
| `179:275` | selected false/true | `components/ui/RadioOption.tsx` | `components/ui/ui.test.tsx` | passed | 320×76 option card |
| `175:243` | 4 styles × 6 states | `components/ui/TextButton.tsx` | `components/ui/ui.test.tsx` | passed | 36px height, loading preserves label width |
| `178:244` | 7 field states | `components/ui/TextField.tsx` | `components/ui/ui.test.tsx` | passed | helper text preserves current input |
| `181:770` | Passed, Failed, Testing, Untested | `components/ui/ModelTestStatus.tsx` | `components/ui/ui.test.tsx` | passed | icon and label share color |
| `191:839` | Default, Hover, Selected | `components/navigation/SettingsNavEntry.tsx` | `components/Sidebar.test.tsx` | passed | 212×36 |
| `235:3693` | Default, Selected | `components/navigation/SidebarEntry.tsx` | `components/Sidebar.test.tsx` | passed | 36px row |
| `235:3700` | Default, Loading | `components/navigation/RecentTaskItem.tsx` | `components/Sidebar.test.tsx` | passed | loading spinner at trailing edge |
| `266:786` | Untested, Testing, Success, Failed | `components/ModelStatusPill.tsx` | `components/ui/ui.test.tsx` | passed | compact status pill |
| `267:829` | selected + four states; unselected | `components/settings/ModelPickerRow.tsx` | `components/settings/settings-components.test.tsx` | passed | 588×56 |
| `267:840` | Enabled true/false | `components/settings/LibraryModelRow.tsx` | `components/settings/settings-components.test.tsx` | passed | 798×48 |
| `267:941` | Expanded, Collapsed, Menu Open | `components/ModelConnectionCard.tsx` | `components/settings/settings-components.test.tsx` | passed | 800px card |
| `270:957` | Populated, Empty, Menu Open | `components/settings/ModelLibrary.tsx` | `components/settings/settings-components.test.tsx` | passed | library shell owns list/empty state |
| `271:1272` | Connection default/success; Models four states | `components/AddModelSetDialog.tsx` | `pages/SettingsPage.test.tsx` | passed | 640px, max 80vh |
| `197:895` | expanded true/false × default/hover | `components/model-selector/ModelConnectionItem.tsx` | `components/model-selector/ModelSelector.test.tsx` | passed | network glyph, 320×36 |
| `197:896` | Default, Hover, Selected | `components/model-selector/ModelOptionItem.tsx` | `components/model-selector/ModelSelector.test.tsx` | passed | check only when selected |
| `197:897` | Default, Hover, Open | `components/model-selector/ModelSelectorTrigger.tsx` | `components/model-selector/ModelSelector.test.tsx` | passed | CPU + selected label + chevron |
| `235:3537` | Default, Model Selecting | `components/AgentComposer.tsx` | `components/AgentComposer.test.tsx` | passed | 720×118, menu above composer |

## Standalone / Composite（19/19）

| Figma node | variants | implementation | tests | visual status | notes |
|---|---|---|---|---|---|
| `62:5` | Brand mark | `components/ActionDriverLogo.tsx` | `pages/pages.test.tsx` | passed | reuse exact brand asset |
| `63:51` | PanelLeft icon button | `components/ui/IconButton.tsx` | `components/ui/ui.test.tsx` | passed | AppIcon panel-left |
| `63:63` | PanelRight icon button | `components/ui/IconButton.tsx` | `components/ui/ui.test.tsx` | passed | AppIcon panel-right |
| `63:59` | Plus icon button | `components/ui/IconButton.tsx` | `components/ui/ui.test.tsx` | passed | inherits currentColor |
| `63:55` | Search icon button | `components/ui/IconButton.tsx` | `components/ui/ui.test.tsx` | passed | AppIcon search |
| `63:67` | Send icon button | `components/ui/IconButton.tsx` | `components/ui/ui.test.tsx` | passed | dark circular usage in composer |
| `110:180` | Browser Tab Bar expanded | `components/browser/BrowserTabBar.tsx` | `components/BrowserPanel.test.tsx` | passed | 44px bar |
| `110:216` | Browser Navigation Bar expanded | `components/browser/BrowserNavigationBar.tsx` | `components/BrowserPanel.test.tsx` | passed | address row + actions |
| `235:3717` | Browser Floating Controls | `components/browser/BrowserSkillControls.tsx` | `components/BrowserPanel.test.tsx` | passed | 348×34 overlay |
| `235:3762` | Shell Sidebar | `components/Sidebar.tsx` | `components/Sidebar.test.tsx` | passed | 248×900 |
| `235:3709` | Settings Page Title | `components/settings/SettingsPageTitle.tsx` | `components/settings/settings-components.test.tsx` | passed | title + description + optional action |
| `266:744` | Settings Sidebar | `components/SettingsSidebar.tsx` | `pages/SettingsPage.test.tsx` | passed | 248×900 |
| `287:1164` | Manual Add Row | `components/settings/ManualModelRow.tsx` | `components/settings/settings-components.test.tsx` | passed | Plus icon-only action |
| `199:895` | Model Selector Menu | `components/model-selector/ModelSelector.tsx` | `components/model-selector/ModelSelector.test.tsx` | passed | 344×264 |
| `118:217` | Execution Timeline wide | `components/ExecutionTimeline.tsx` | `components/ExecutionTimeline.test.tsx` | passed | AntD rail assets and 3/4 progress |
| `235:3701` | Conversation Header | `components/agent/TaskHeader.tsx` | `components/Conversation.test.tsx` | passed | folder glyph + title |
| `235:3705` | User Message | `components/agent/UserMessage.tsx` | `components/Conversation.test.tsx` | passed | subtle rounded bubble |
| `235:3707` | Agent Response | `components/agent/AgentResponse.tsx` | `components/Conversation.test.tsx` | passed | plain response text |
| `271:997` | Status Summary | `components/settings/ModelLibrary.tsx` | `pages/SettingsPage.test.tsx` | design reviewed; intentionally absent | source node is empty; product spec forbids extra summary row |

## Glyph Mapping（36/36）

| Figma node | variants | implementation | tests | visual status | notes |
|---|---|---|---|---|---|
| `171:228` | ArrowLeft | `components/ui/AppIcon.tsx#arrow-left` | `components/ui/ui.test.tsx` | passed | Lucide ArrowLeft candidate |
| `171:249` | Check | `components/ui/AppIcon.tsx#check` | `components/ui/ui.test.tsx` | passed | Lucide Check candidate |
| `171:235` | ChevronDown | `components/ui/AppIcon.tsx#chevron-down` | `components/ui/ui.test.tsx` | passed | Lucide ChevronDown candidate |
| `62:10` | ChevronLeft | `components/ui/AppIcon.tsx#chevron-left` | `components/ui/ui.test.tsx` | passed | Lucide ChevronLeft candidate |
| `62:11` | ChevronRight | `components/ui/AppIcon.tsx#chevron-right` | `components/ui/ui.test.tsx` | passed | Lucide ChevronRight candidate |
| `171:254` | CircleAlert | `components/ui/AppIcon.tsx#circle-alert` | `components/ui/ui.test.tsx` | passed | Lucide CircleAlert candidate |
| `62:21` | Close | `components/ui/AppIcon.tsx#close` | `components/ui/ui.test.tsx` | passed | Lucide X candidate |
| `171:265` | Ellipsis | `components/ui/AppIcon.tsx#ellipsis` | `components/ui/ui.test.tsx` | passed | Lucide Ellipsis candidate |
| `171:239` | Eye | `components/ui/AppIcon.tsx#eye` | `components/ui/ui.test.tsx` | passed | Lucide Eye candidate |
| `62:17` | Folder | `components/ui/AppIcon.tsx#folder` | `components/ui/ui.test.tsx` | passed | Lucide Folder candidate |
| `62:20` | Globe | `components/ui/AppIcon.tsx#globe` | `components/ui/ui.test.tsx` | passed | Lucide Globe2 candidate |
| `171:232` | Link | `components/ui/AppIcon.tsx#link` | `components/ui/ui.test.tsx` | passed | Lucide Link candidate |
| `82:204` | Loader | `components/ui/AppIcon.tsx#loader` | `components/ui/ui.test.tsx` | passed | Lucide LoaderCircle candidate |
| `62:27` | Lock | `components/ui/AppIcon.tsx#lock` | `components/ui/ui.test.tsx` | passed | Lucide LockKeyhole candidate |
| `62:16` | MCP | `components/ui/AppIcon.tsx#mcp` | `components/ui/ui.test.tsx` | passed | Lucide Blocks candidate |
| `62:19` | Maximize | `components/ui/AppIcon.tsx#maximize` | `components/ui/ui.test.tsx` | passed | Lucide Maximize2 candidate |
| `131:211` | Minimize2 | `components/ui/AppIcon.tsx#minimize` | `components/ui/ui.test.tsx` | passed | Lucide Minimize2 candidate |
| `110:175` | MoreVertical | `components/ui/AppIcon.tsx#more-vertical` | `components/ui/ui.test.tsx` | passed | Lucide MoreVertical candidate |
| `62:9` | PanelLeft | `components/ui/AppIcon.tsx#panel-left` | `components/ui/ui.test.tsx` | passed | Lucide PanelLeft candidate |
| `62:18` | PanelRight | `components/ui/AppIcon.tsx#panel-right` | `components/ui/ui.test.tsx` | passed | Lucide PanelRight candidate |
| `62:24` | Pause | `components/ui/AppIcon.tsx#pause` | `components/ui/ui.test.tsx` | passed | Lucide Pause candidate |
| `62:26` | Play | `components/ui/AppIcon.tsx#play` | `components/ui/ui.test.tsx` | passed | Lucide Play candidate |
| `62:13` | Plus | `components/ui/AppIcon.tsx#plus` | `components/ui/ui.test.tsx` | passed | Lucide Plus, currentColor |
| `62:28` | Pointer | `components/ui/AppIcon.tsx#pointer` | `components/ui/ui.test.tsx` | passed | Lucide MousePointer2 candidate |
| `62:22` | Refresh | `components/ui/AppIcon.tsx#refresh` | `components/ui/ui.test.tsx` | passed | Lucide RefreshCw candidate |
| `62:12` | Search | `components/ui/AppIcon.tsx#search` | `components/ui/ui.test.tsx` | passed | Lucide Search candidate |
| `62:23` | Send | `components/ui/AppIcon.tsx#send` | `components/ui/ui.test.tsx` | passed | Lucide ArrowUp candidate |
| `171:260` | Server | `components/ui/AppIcon.tsx#server` | `components/ui/ui.test.tsx` | passed | Lucide Server candidate |
| `171:224` | Settings | `components/ui/AppIcon.tsx#settings` | `components/ui/ui.test.tsx` | passed | Lucide Settings candidate |
| `62:15` | Skill | `components/ui/AppIcon.tsx#skill` | `components/ui/ui.test.tsx` | passed | Lucide WandSparkles candidate |
| `62:25` | Takeover | `components/ui/AppIcon.tsx#takeover` | `components/ui/ui.test.tsx` | passed | Lucide Hand candidate |
| `62:14` | Task | `components/ui/AppIcon.tsx#task` | `components/ui/ui.test.tsx` | passed | Lucide ListTodo candidate |
| `171:246` | Trash2 | `components/ui/AppIcon.tsx#trash` | `components/ui/ui.test.tsx` | passed | Lucide Trash2 candidate |
| `292:883` | Network | `components/ui/AppIcon.tsx#network` | `components/ui/ui.test.tsx` | passed | Lucide Network candidate |
| `292:899` | Cpu | `components/ui/AppIcon.tsx#cpu` | `components/ui/ui.test.tsx` | passed | Lucide Cpu candidate |
| `292:913` | Boxes | `components/ui/AppIcon.tsx#boxes` | `components/ui/ui.test.tsx` | passed | Lucide Boxes candidate |

## Baseline

- Design context: 14/14 product frames, 19/19 component sets, 19/19 standalone/composite nodes and 36/36 glyph nodes read successfully on 2026-09-21.
- Runtime baseline: `pnpm test` 40 files / 134 tests passed；workspace typecheck passed；desktop production build passed on 2026-09-21.
- Shared UI implementation: `AppIcon` maps 36/36 glyph names through one adapter；Checkbox、RadioOption、TextButton、TextField and ModelTestStatus have component behavior coverage；Settings model status reuses the shared presentation.
