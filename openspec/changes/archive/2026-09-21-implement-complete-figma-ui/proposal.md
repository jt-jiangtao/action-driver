## Why

当前桌面端只覆盖了部分 Figma 页面和交互状态：侧栏最近任务只有首项可进入任务详情，模型选择器与若干控件状态尚未完整落地，已有页面也缺少逐组件的一致性验收。现在需要以 Figma `action-driver` 文件为唯一视觉基准，补齐全部已绘制页面、组件和状态，并继续使用确定性的 Mock 数据，为后续真实服务接入保留稳定边界。

本变更属于产品与架构混合决策型任务，Battle 已完成。最终裁决是：最近任务条目复用共享 `TaskPage` 并由不同 Mock task ID 驱动；不新增 Figma 中不存在的独立任务列表页；有交互语义的组件建立可复用 React 组件，纯 Glyph 通过统一图标适配层映射。当前无未解决的关键分歧。

## What Changes

- 建立 Figma 页面、组件集、变体状态与 React 实现之间的可追踪核对矩阵。
- 完整实现 Home 的默认态与模型选择态、Task 的默认分栏/浏览器放大/浏览器折叠/模型选择态，以及 Settings 的 8 个已绘制状态。
- 让所有最近任务条目都可进入共享任务详情页，并由确定性的 Mock 数据呈现各自标题、会话、执行时间线、Skill 状态和浏览器占位内容。
- 抽取基础控件、导航、模型选择器、Agent、浏览器和设置域组件；状态通过明确的类型化 props 或组合 API 表达。
- 建立统一图标适配层，按 Figma 语义映射 Lucide 图标，并修正连接、模型、新增和按钮前景色。
- 页面结构优先使用 Flex/Grid 与正常文档流；只在 Figma 明确要求的弹层、浮动控制和高亮覆盖物中使用定位。
- 为默认、hover、focus、pressed、selected、loading、disabled、error、success、expanded、collapsed 和 menu-open 等状态补充组件测试与视觉验收。

## Capabilities

### New Capabilities

- `desktop-ui-components`: 定义 Figma 组件库、统一图标语义、状态变体、布局约束及逐组件可验证行为。

### Modified Capabilities

- `desktop-shell`: 扩充侧栏最近任务导航与全页面一致的组件化壳层行为。
- `agent-task-experience`: 补齐 Home、Task、模型选择器和多任务 Mock 导航的全部已绘制状态。
- `model-connections-settings`: 将 8 个设置页面状态及其控件状态纳入完整、可恢复的交互契约。

## Impact

- 主要影响 `apps/desktop/src/renderer` 的路由状态、页面、组件、样式、Mock 服务和测试。
- 复用现有 React 19、Slate.js、Ant Design、Lucide 和设计 Token，不引入新的运行时依赖。
- 不改变 Electron 主进程安全边界，不连接真实模型服务或真实网页，不新增 Skills/MCP 页面。
- 工作区现有未提交改动将被保留；本变更的实现需要在应用阶段逐文件协调，而不是覆盖现状。
