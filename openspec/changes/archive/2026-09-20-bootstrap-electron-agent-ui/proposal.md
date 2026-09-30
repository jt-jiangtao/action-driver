## Why

Action-Driver 目前只有 Figma 设计基础和品牌资产，还没有可运行的 Electron 工程、前端页面或稳定的能力边界。需要先建立一个严格遵循已确认设计的 TypeScript 桌面端骨架，让首页与任务页能够用 Mock 数据完整演示，同时为后续 Agent 通过 Skill 调用 Browser Use 和 Computer Use 留出不会污染 UI 的扩展接口。

## What Changes

- 建立仅面向 macOS 的 Electron + React + TypeScript + Vite 前端工程骨架，包含 Main、Preload、Renderer 的安全进程边界。
- 使用 InversifyJS 作为依赖注入容器；Main、Preload、Renderer 分别建立组合根，业务组件不得直接解析全局容器。
- 依据 Figma 节点 `60:5` 实现首页，依据节点 `60:7`、`111:247`、`112:409` 实现任务页的默认分栏、浏览器放大和浏览器折叠状态。
- 使用设计 Token、现有 Action-Driver SVG、Lucide Icons、Slate.js 输入框与 Ant Design Timeline；组件视觉以 Figma 为准，不强制套用 Ant Design。
- 所有任务、消息、时间线和 Skill 状态先由类型安全的 Mock 仓储与服务提供，为后续真实 IPC/Sidecar 数据源保留替换点。
- 将 Agent Runtime 定义为核心编排层；Browser Use 和 Computer Use 定义为独立 Skill 能力，通过统一的 Skill Contract 被 Agent 调用。
- Browser Use 在本阶段只实现静态网页栅格、目标高亮、浮动控制条和面板布局状态，不创建真实浏览器实例，也不实现导航、暂停、接管或 Chromium 能力。
- Skills 与 MCP 仅保留已绘制的侧栏入口，不新增未绘制的页面或流程。
- 增加覆盖容器绑定、Mock 服务、关键组件状态、页面布局和 Electron 启动冒烟的自动化测试。

## Capabilities

### New Capabilities

- `desktop-shell`: 定义 macOS Electron 窗口、安全进程边界、侧栏及页面壳层的可观察行为。
- `agent-task-experience`: 定义首页输入、任务对话、执行时间线、输入框状态和任务页三种布局状态。
- `agent-skill-boundary`: 定义 Agent 核心与 Browser Use、Computer Use Skill 的类型化契约、Mock 实现及依赖注入边界。

### Modified Capabilities

无。

## Impact

- 新增 Electron Main、Preload 和 React Renderer 工程及其 TypeScript 配置、构建、测试和质量检查脚本。
- 新增 InversifyJS、React、Slate.js、Ant Design、Lucide React 及配套测试依赖。
- 新增设计 Token、通用组件、首页、任务页、Mock 数据与 Skill 契约。
- 复用 `design/assets/action-driver-logo.svg`；实现阶段需从 Figma 下载并本地保存页面使用的确切图像资产，避免依赖临时 URL。
- 不接入 Go Sidecar、SQLite、Unix Domain Socket、真实 Browser Use、Computer Use、MCP 或 Skill 执行引擎；这些属于后续变更。
