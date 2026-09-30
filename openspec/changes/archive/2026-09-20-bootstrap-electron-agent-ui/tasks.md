## 1. 工程骨架与质量基线

- [x] 1.1 创建 pnpm Workspace、`apps/desktop`、`packages/contracts`、`packages/design-tokens` 目录与严格 TypeScript 基础配置，并通过 `pnpm install` 和 `pnpm typecheck` 验证。
- [x] 1.2 配置 Electron Main、Preload、React Renderer 与 Vite 构建入口，创建最小安全窗口，并通过开发启动与生产构建命令验证三个入口均可编译。
- [x] 1.3 配置 ESLint、格式化、Vitest、React Testing Library 和 Playwright Electron 测试骨架，并用一个基础测试验证所有测试命令可运行。
- [x] 1.4 添加用于安装、类型检查、Lint、单元测试和 Renderer 构建的 Docker 配置，并在容器中执行完整基础检查验证环境可复现。
- [x] 1.5 配置 `contextIsolation: true`、`nodeIntegration: false`、新窗口/跨源导航拒绝策略和最小类型化 Preload API，并通过测试验证 Renderer 无法直接访问 Node/Electron API 或跳出应用入口。

## 2. 设计资产与 Token

- [x] 2.1 从 Figma 节点 `60:5`、`60:7`、`111:247`、`112:409` 下载确切的图像与必要 SVG 资产到本地并记录节点来源，验证代码不引用临时 Figma MCP URL。
- [x] 2.2 将 Foundations 节点 `55:2` 的语义色、字体、间距、圆角、阴影和动效映射为 CSS 变量与 TypeScript Token，并用单元测试验证关键 Token 值。
- [x] 2.3 建立全局样式、macOS 系统字体栈、基础重置和 Reduced Motion 规则，并在 1440×900 测试页面验证背景、字体与阴影容器不被裁切。
- [x] 2.4 以单一 SVG 资产集成仓库现有 Action-Driver Logo，并完成 `lucide-react` 图标映射，验证所有图标使用固定 16px 字形槽并与文字垂直对齐。

## 3. Agent 与 Skill 契约

- [x] 3.1 先编写契约测试，覆盖任务、消息、执行步骤、Skill 调用、生命周期事件和浏览器只读投影的可序列化要求。
- [x] 3.2 在 `packages/contracts` 实现通过契约测试的 TypeScript DTO、服务端口与 Inversify Symbol 标识，确保不存在 DOM、Electron 或函数值。
- [x] 3.3 分别定义 Browser Skill 与 Computer Use Skill 的判别式调用契约和独立能力注册，并用编译期与单元测试验证两者只依赖基础 Skill Contract、可独立替换且互不引用具体实现。
- [x] 3.4 先编写容器解析测试，再实现 Main 与 Renderer 的 Inversify 组合根；验证 React 消费端只接收 `AppServices`，不直接访问全局容器。

## 4. Mock 数据与状态模型

- [x] 4.1 先编写 Mock Agent/Skill 状态机测试，覆盖 queued、running、paused、waiting-user、taken-over、succeeded、failed 及非法转换。
- [x] 4.2 实现确定性的任务、消息、四步时间线、Browser Skill 投影 fixture 与 Mock 仓储，通过状态机和序列化测试。
- [x] 4.3 实现 Mock `AgentCommandService`、`AgentSessionRepository` 和 `SkillGateway`，并验证提交目标、中断、暂停、继续和接管会产生一致的会话投影。
- [x] 4.4 为未来 IPC 实现预留同契约适配器边界并增加替换绑定测试，验证切换绑定不需要修改 React 组件。

## 5. 基础组件

- [x] 5.1 先编写侧栏组件测试，再实现 Figma 的窗口控制区、品牌行、新任务、Skills、MCP 和最近任务列表，验证 248px 宽度、加载态、选中态及无用户页脚。
- [x] 5.2 先编写 Slate Composer 行为测试，再实现空闲发送态与运行中中断态，验证输入、空值保护、加号、发送和停止按钮行为。
- [x] 5.3 先编写执行时间线测试，再用 Ant Design Timeline 实现成功、当前与等待步骤，验证 `3 / 4`、竖直排列和宽度随对话流变化。
- [x] 5.4 先编写会话头部和消息组件测试，再实现任务标题、用户消息与 Agent 响应，验证间距、换行和无多余时间/Skill/更多按钮。
- [x] 5.5 先编写浏览器占位组件测试，再实现 Tab Bar、Navigation Bar、网页栅格、目标高亮和浮动控制条，验证文字不溢出、控件不重复且不创建真实浏览器。
- [x] 5.6 为浏览器占位控制条实现统一生命周期的显式组件状态，验证运行、暂停、继续、人工接管、等待、完成和中断文案及合法操作符合定稿。
- [x] 5.7 实现只替换图标的浏览器尺寸切换按钮，并用组件测试验证默认、放大、折叠状态下按钮背景和边框保持不变。

## 6. 首页与任务页

- [x] 6.1 组合已验证组件实现 Figma 节点 `60:5` 首页，验证 1440×900 下 Logo、标题、说明与 720px 输入框的位置和阴影。
- [x] 6.2 实现仅包含首页与 `/tasks/:taskId` 的内存路由，验证首页提交非空目标后进入预置 Mock 任务且 Skills/MCP 不创建新页面。
- [x] 6.3 组合组件实现 Figma 节点 `60:7` 默认任务页，验证 248/536/656 三栏尺寸、对话宽度、时间线宽度和浏览器覆盖层互不重叠。
- [x] 6.4 实现 Figma 节点 `111:247` 的浏览器放大任务状态，验证保留侧栏、隐藏 Agent 面板并展示静态浏览器空状态。
- [x] 6.5 实现 Figma 节点 `112:409` 的浏览器折叠任务状态，验证 Agent 对话与输入框扩展到 720px 且浏览器面板不存在。
- [x] 6.6 实现 `split | browser-expanded | browser-collapsed` 显式状态切换，验证往返切换不会重置 Mock 会话、输入或 Skill 生命周期。

## 7. 集成与视觉验收

- [x] 7.1 增加 Electron 冒烟测试，验证应用启动到首页、提交任务、切换三种布局以及关闭窗口的完整路径。
- [x] 7.2 为首页、默认任务页、浏览器放大和浏览器折叠生成 1440×900 基准截图，以 2% 最大像素差阈值自动对照 Figma，并逐帧修正布局而非使用临时位移。
- [x] 7.3 验证交互状态的 80/160/240/360/600ms Motion Token 和 Reduced Motion 降级，确保动画不改变最终布局或造成覆盖。
- [x] 7.4 通过 `pnpm check:all` 执行类型检查、Lint、单元测试、Renderer 构建和 macOS Electron 冒烟/视觉回归，并执行 Docker 检查，确认不存在未使用或被截断的组件。
