# ActionDriver 浏览器产品集成设计

## 目标与验收

用户在任务页右侧看到真实网页和可操作的浏览器栏；Agent 使用 Browser Use 时能在同一标签页执行导航、点击、输入、滚动和截图。Agent 也能自行启动独立 Chrome 窗口并操作其中的页面。用户可以看到执行状态、手动操作页面、接管或恢复 Agent。首版限 macOS 和 Chrome，不连接用户已打开的浏览器实例或标签页；底层浏览器服务不依赖 Codex App 私有服务。

以本地 HTTP 夹具验证：Agent 打开页面、创建与切换标签页、执行页面操作，用户从右侧界面看到同一状态并可操作；外部模式由 Agent 启动隔离 Chrome，执行相同步骤；关闭、失联和接管后有明确状态，任务与浏览器资源能清理。

## 已确认的产品行为

- 任务默认使用右侧内置浏览器。分栏、放大、折叠只改变展示，不重建标签页或丢失页面状态。
- 标签栏支持新建、选择、关闭；地址栏支持输入 URL、后退、前进和刷新；网页本身接受鼠标与键盘操作。URL、标题、加载及错误状态来自实际页面。
- Agent 可选择外部 Chrome 作为执行表面，ActionDriver 以单独 profile 启动并拥有该窗口。用户可直接在窗口操作。任务记录当前表面和标签页；内置与外部会话不自动迁移页面或凭据。
- Agent 与用户访问同一 Browser Use 会话。用户接管时暂停 Agent 的该会话操作；恢复后 Agent 读取当前页面状态再继续。普通用户页面操作的并发冲突按会话串行化，不把点击发送到错误标签页。
- 未安装 Chrome、启动失败、页面加载失败、标签页或窗口关闭时展示可恢复的错误；不回退到静态图片或假成功。

## 架构与数据流

Browser Use 的公共端口只传可序列化的 session ID、surface (`embedded` 或 `external-chrome`)、tab ID、命令、状态和结果。`packages/browser-desktop` 承载可复用的桌面会话核心：标签身份、命令分发、控制状态、错误与关闭生命周期，宿主由外部注入。已有 `setupBrowserDesktop`/`createBrowserDesktopService` 继续承担还原候选的客户端及服务边界；产品会话核心作为明确的新出口，不以这次产品集成宣称整个候选包已完成原件等价。`packages/browser-runtime` 继续提供独立 Chrome host。两个底层包不引用 Electron UI、Agent 任务模型或 Codex 私有接口。

`apps/desktop` 是 ActionDriver 适配层：它创建内置与外部宿主、把会话绑定到任务、转发 Agent 工具调用、生成任务投影并管理 UI。用户关闭会话或应用退出时，它调用 `browser-desktop` 的关闭契约来清理自有资源。任务 ID 只存在于应用层映射，不进入通用包的会话接口。

内置表面由 Electron Main 持有隔离的网页 `WebContentsView`，Renderer 仅绘制浏览器栏、控件及 WebContentsView 的位置占位，通过具名类型化 IPC 发命令和接收事件。Main 将原生 view 与任务页的尺寸、可见性和窗口生命周期同步，网页不获得 ActionDriver 的 preload 或 Node 能力。Agent 通过同一桌面 Browser Use 端口操作该 view；控制实现可采用 Electron 的 webContents/CDP 适配，不另开一个不可见浏览器冒充右侧页面。

外部表面复用自有 `createLocalBrowserHost` 的隔离 Chrome profile 和 Playwright/CDP 能力。桌面适配层只暴露 ActionDriver 创建的会话与标签页，不扫描或附着用户已打开的 Chrome。任务完成后保留可回看的页面；显式关闭会话或退出应用时终止自有会话并清理临时 profile。用户主动关闭外部窗口时投影转为已关闭并允许重新启动。

Agent Runtime 通过现有 Tool Registry、Policy Gate 和 Skill Provider 边界发起 Browser Use 调用，页面按钮走同一个 `browser-desktop` 会话核心。该核心是标签与控制状态的事实来源；任务投影保存 ID 与可显示状态，不保存 Electron 对象或 Playwright Page。Mock 继续提供可复现的视觉验收路径，生产不得回退到 Mock Browser Provider。

## 替代方案与裁决

比较过“右侧截图流 + 远端点击回放”与“原生嵌入网页”。截图流更容易复用现有外部 Chrome host，也更接近纯远程会话，但文字输入、焦点、滚动和尺寸变化需要坐标映射，用户难以把右侧当作真实浏览器。采用原生嵌入网页，同时保留独立 Chrome 模式，满足截图所示产品形态和 Agent 操作要求。用户明确排除连接现有浏览器，并把外部首版收窄为 Chrome。

## 风险与处理

- 原生 view 覆盖 Renderer 的层级与窗口缩放会影响浮动控件和弹层。浏览器栏与接管控件应放在不被 view 覆盖的区域；resize、折叠、切换任务和最小窗口须做真实 Electron 验收。
- 内置 Chromium 与外部 Chrome 的站点兼容性、登录状态和下载路径可能不同；两者隔离且不自动共享 profile。明确显示当前表面，不暗示状态会同步。
- 外部 Chrome 关闭、崩溃或 profile 清理失败可能造成悬挂状态；按会话生命周期报告失败并在重启时回收自有资源。
- 用户与 Agent 同时操作可能导致目标漂移；命令绑定 session/tab，接管暂停 Agent，恢复前重新读取页面状态。
- 现有 `agent-task-experience` 明确规定 Mock 占位和不驱动真实网页。本变更只在生产 Browser Use 场景修改这些要求，保留 Mock 视觉夹具。
- `browser-desktop` 还原候选未完成全部原件服务能力。新增产品会话核心须有独立测试与出口，不将其误标为“全包已验收”或据此切换全部生产依赖。

## 实施与验证边界

先在 `browser-desktop` 建立通用会话契约和核心，再接入 ActionDriver 桌面适配、内置 view、UI 控件、外部 Chrome Provider 与 Agent 工具。定向测试覆盖会话、IPC、标签页与错误转换；真实 Electron 加本地 HTTP 夹具覆盖内置页面及外部 Chrome 的 Agent 操作与用户接管。首版不支持 Edge、Brave、Safari、现有标签页连接、跨表面迁移或 Codex 私有服务。
