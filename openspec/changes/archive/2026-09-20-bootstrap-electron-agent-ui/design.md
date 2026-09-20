## Context

参见 `proposal.md` 的 Why。仓库当前只有 OpenSpec 配置与 `design/assets/actiondriver-logo.svg`，没有应用代码或历史约定。设计来源为 Figma Foundations 节点 `55:2`、首页画板 `60:5`，以及任务页画板 `60:7`、`111:247`、`112:409`。

本阶段需要同时建立 Electron 工程边界、React UI、依赖注入与可替换的 Mock 数据层。真实 Agent Service 最终由 Go + Eino 提供，Browser Use 与 Computer Use 最终作为 Agent 可调用的 Skill 存在；因此 TypeScript 端只定义 UI 所需的可序列化契约与适配器，不在 Renderer 中实现 Agent 推理或操作引擎。

## Goals / Non-Goals

**Goals:**

- 建立可启动、可测试、严格 TypeScript 的 Electron + React + Vite 工程。
- 逐节点还原两个页面及任务页三个布局状态，并把 Figma Foundations 落为代码 Token。
- 以 InversifyJS 隔离 Mock 数据源与未来 IPC 数据源。
- 建立 Agent → Skill 的单向依赖和统一生命周期投影。
- 保持组件边界清晰，避免布尔属性堆积及全局容器访问。

**Non-Goals:**

- 不实现真实浏览器、`webview`、`WebContentsView`、Chromium Fork 或网页导航。
- 不实现 Go Sidecar、Eino、SQLite、Unix Domain Socket、MCP 或 Skill 执行引擎。
- 不实现真实 AXUIElement、CGEvent、ScreenCaptureKit 或 Computer Use。
- 不新增 Skills、MCP、设置、账户等未绘制页面。
- 不实现生产签名、公证、自动更新或遥测。

## Decisions

### 1. 采用 pnpm Workspace，但首个可运行应用保持单一

目录结构采用：

```text
apps/desktop/
  src/main/
  src/preload/
  src/renderer/
packages/
  contracts/
  design-tokens/
```

`apps/desktop` 包含 Electron 应用；`contracts` 只保存跨进程可序列化的 TypeScript 类型、服务接口和 Symbol 标识；`design-tokens` 保存从 Figma Foundations 映射的 CSS 变量与 TypeScript Token。这样可在不引入完整 Monorepo 平台的情况下，为未来 Go 协议生成物和其他客户端保留稳定位置。

备选方案是把所有代码放在单一 `src` 目录。该方案初始文件更少，但会让 Electron 进程边界、领域契约和 UI 组件快速混合，因此不采用。

### 2. Electron 使用三进程目录与最小 Preload 桥接

Main 负责应用生命周期和 `BrowserWindow`；Preload 只通过 `contextBridge` 暴露白名单 API；Renderer 保持纯 Web 环境。窗口启用 `contextIsolation`、关闭 `nodeIntegration`，不向 Renderer 暴露 `ipcRenderer`。

桌面壳层拒绝 Renderer 创建新窗口，并阻止顶层页面导航到应用入口之外：开发环境仅允许 Renderer 开发服务器同源 URL，生产环境仅允许确切的本地入口文件。该策略只保护桌面壳层，不替代后续真实 Browser Skill 自身的受约束导航策略。

当前桥接只提供应用环境等骨架能力。未来 IPC 服务通过新适配器加入，而不是扩大一个无类型的通用 `invoke` 接口。

### 3. InversifyJS 只在组合根中使用

使用当前稳定的 InversifyJS 8.x 与 TypeScript 装饰器元数据。Main 和 Renderer 各有独立容器；Preload 保持最小化，只有在出现多个可替换桥接服务时才建立自己的容器。

Renderer 组合根将接口 Token 绑定到 Mock 实现，再一次性解析 `AppServices`，通过 React Context 传入页面。React 组件不得导入全局容器或在渲染过程中调用 `container.get()`。测试使用独立子容器或测试容器覆盖绑定，避免共享可变单例。

备选方案包括手工工厂和 React Context 直接充当 DI。手工工厂无法满足已确认的 InversifyJS 约束；让组件直接解析容器会形成 Service Locator，因此不采用。

### 4. Agent、Skill 和 UI 使用端口/适配器边界

前端契约分为：

- `AgentSessionRepository`：读取任务、消息和时间线投影。
- `AgentCommandService`：提交目标、中断任务和请求继续。
- `SkillGateway`：以 `skillId`、类型化参数和调用上下文发起 Skill 命令。
- `SkillExecutionEvent`：统一表达 queued、running、paused、waiting-user、taken-over、succeeded、failed。
- `BrowserSkillProjection`：只提供网页栅格、目标高亮和控制条需要的只读视图数据。

Browser Skill 与 Computer Use Skill 仅共享基础 Skill Contract，不互相引用。页面只消费会话投影和命令端口，不导入具体 Skill 类。当前 `MockSkillGateway` 产生确定性事件；未来 `IpcSkillGateway` 可在组合根中无缝替换。

### 5. 页面状态与路由保持最小

使用内存路由只定义 `/` 与 `/tasks/:taskId`。首页提交 Mock 目标后进入预置任务。Skills 和 MCP 入口保留视觉但不注册目标路由。

任务页布局使用显式联合类型 `split | browser-expanded | browser-collapsed`，并分别组合 `SplitTaskLayout`、`BrowserExpandedLayout`、`BrowserCollapsedLayout`，避免用大量布尔属性控制一个巨型组件。Agent 会话状态保存在页面级 Provider 中，布局切换不会重置会话。

### 6. UI 技术与设计还原策略

- 样式使用 CSS Modules 和全局语义 CSS 变量，不引入 Tailwind。
- 生产字体使用 macOS 系统字体栈，以 SF Pro 为首选；测试截图环境使用兼容回退。
- 通用图标使用 `lucide-react`，只有字形与 Figma 明确匹配时才复用；ActionDriver Logo 使用仓库现有 SVG。
- Figma 中的酒店网页栅格在实现开始时下载为本地 PNG，禁止依赖七天失效的 MCP 资产 URL，也不自行重画网页。
- 输入框使用 Slate.js，仅实现文本输入、空状态、加号、发送和中断所需行为。
- 时间线使用 Ant Design Timeline，但颜色、尺寸、间距和当前项背景通过 Token 与局部样式覆盖，以 Figma 为最终视觉标准。
- 浏览器占位面板的尺寸切换、暂停、继续、人工接管都是 Mock UI 状态；不创建真实网页执行对象。

### 7. Mock 数据是可替换适配器，不写死在组件中

Mock fixture 与 Mock 服务分离。Fixture 保存确定性的任务、消息、四步时间线、浏览器投影和 Skill 状态；服务负责状态转换与订阅。组件通过端口读取数据，Story/Test 可注入不同 fixture 覆盖空闲、运行、暂停、接管、成功和失败状态。

### 8. 测试分层

- Vitest：契约数据可序列化、Mock 状态机、Inversify 绑定和 Token 映射。
- React Testing Library：侧栏、Slate Composer、时间线和三种布局的行为测试。
- Playwright Electron：应用启动、首页提交到任务页、布局切换和关键截图回归。
- 视觉验收以 1440×900 为基准，对照 Figma 截图检查尺寸、边距、溢出、阴影和图标对齐。
- Docker 负责依赖安装、类型检查、Lint、单元测试和 Renderer 构建；涉及 macOS 窗口行为与最终打包的验证保留给 macOS 环境。

## Risks / Trade-offs

- [Figma 资产 URL 会过期] → 实施第一阶段下载确切资产并纳入仓库，记录来源节点。
- [Ant Design 默认样式偏离定稿] → 只使用 Timeline 的结构与可访问性，视觉全部映射到局部 Token，不在其他组件中强制使用 Ant Design。
- [Inversify 装饰器与 Vite/测试配置不一致] → 统一基础 `tsconfig` 的装饰器配置，并增加容器解析测试。
- [Mock 状态模型与未来 Go 协议漂移] → 契约只使用可序列化 DTO，并把 IPC 映射限制在适配器层；后续以版本化协议替换。
- [浏览器占位交互被误认为真实能力] → 所有实现命名和测试明确标记为 Mock/Projection，不引入 Electron 浏览器 API。
- [固定桌面尺寸在较小窗口溢出] → 以 1440×900 作为像素验收基准，同时为主内容设置最小尺寸和受控裁切；不在本阶段发明未设计的响应式重排。

## Migration Plan

1. 建立 Workspace、Electron 构建入口、TypeScript 基础配置和安全窗口。
2. 建立 contracts、design-tokens、Inversify 组合根及 Mock 适配器。
3. 完成基础组件，再按首页、任务页默认分栏、浏览器放大、浏览器折叠顺序还原页面。
4. 加入自动化与视觉验证，确认 Mock 场景可离线运行。
5. 后续接入 Go Sidecar 时新增 IPC 适配器并切换容器绑定；保留 Mock 绑定用于测试和 Story。

当前没有生产数据和旧版本，因此无需数据迁移。若实现失败，可回退本次新增目录和配置；现有 Figma 与品牌资产不受影响。
