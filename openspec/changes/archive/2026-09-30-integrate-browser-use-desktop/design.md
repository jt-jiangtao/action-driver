## Context

参见 proposal.md。当前 `BrowserPanel` 绘制静态图片，标签与导航按钮无真实动作；`BrowserSkillProjection` 只有标题、URL、状态和高亮。生产 `browser-use` Provider 尚未注册。`packages/browser-desktop` 目前只有客户端复用、资源与独立 service 生命周期，尚无通用会话核心；`packages/browser-runtime` 已有可启动独立 Chrome profile 的自有 host，但未接入桌面任务。现有 `implement-browser-use` 明确不接产品，因此本变更单独处理产品集成。

## Goals / Non-Goals

**Goals:**

- 让内置网页的可见页面与 Agent 实际操作页面为同一对象。
- 将可复用的桌面会话与标签操作放在 `packages/browser-desktop`，保持宿主注入；任务绑定、Electron 实现、UI 和 Agent 接线留在 Action-Driver 应用层。
- 以类型化、可序列化的会话契约协调任务、Renderer、Electron Main 和 Agent Runtime。
- 保留确定性的 Mock 页面，生产会话则始终呈现真实状态。

**Non-Goals:**

- 附着现有 Chrome 实例、扩展连接、跨表面迁移标签页或共享凭据。
- 首版支持 Edge、Brave、Safari 或非 macOS 外部浏览器。
- 借用 Codex App 私有服务。

## Decisions

### 1. 原生内置网页与独立 Chrome 采用统一会话契约

在 `packages/browser-desktop` 增加独立于现有还原候选 facade 的 Browser Session 核心，端口标识 session、surface、tab、命令和状态；它负责标签身份、命令分发、控制状态、错误与关闭生命周期，是浏览器状态的事实来源。它只接收可替换的宿主端口，不包含 task ID、Electron、React 或 Agent 类型。`apps/desktop` 负责 task→session 映射及宿主注入；Renderer 只接收可序列化投影，Agent 通过 Tool Registry、Policy Gate 和 Browser Use Provider 调用同一会话。现有 `setupBrowserDesktop`/`createBrowserDesktopService` 保留原件还原边界，新增产品核心不表示完整 desktop service 已通过等价验收。

替代方案是 Renderer 自行持有浏览器状态并把 Agent 命令转给页面组件。这会让页面卸载、任务切换及 Agent 后台运行时丢失事实来源，且跨越既有 Skill 边界，故不采用。

### 2. 内置网页使用 Main 持有的隔离原生 view

在当前 BrowserWindow 的右侧网页区域安放独立 `WebContentsView`。Renderer 继续绘制标签栏、地址栏和控制条，向 Main 提交网页区域矩形与可见状态；Main 负责 view 的创建、尺寸同步、切换、销毁及页面导航事件。网页使用独立 session partition，不加载 Action-Driver preload，禁止将网页导航带入应用 Renderer。Agent 对内置标签的操作通过该 view 的 webContents/CDP 能力实现，并以真实 view 截图和事件回传结果。原生 view 的层级要求网页区域与控件区域分离；窗口尺寸和设备缩放变化需在真实 Electron 验收。

替代方案是对外部 Chrome 截图并在右侧回放。它可复用现有 host，却会把用户输入、焦点、滚动和缩放变成远程坐标问题。用户已选择右侧真实浏览器产品形态，故采用原生 view；这是本次 Battle 的最终裁决。

### 3. 外部窗口只启动受管 Chrome

复用 `createLocalBrowserHost` 的隔离 profile 启动、页面操作与清理能力，在桌面 Provider 中注册为 `external-chrome` 表面。仅把 Action-Driver 创建的 context/page 纳入会话映射，不枚举或附着用户 Chrome。任务选择表面后只对该表面发命令；切换表面需显式新建会话，不自动复制页面、cookies 或历史记录。

替代方案是 Chrome 扩展连接现有标签页，省去新窗口，却扩大权限、认证和既有标签归属范围。用户明确排除连接，故不采用。用户还将外部首版限定为 Chrome，接受其他浏览器暂不可用的范围代价。

### 4. 会话控制与任务投影

`browser-desktop` Browser Session 记录运行、暂停、接管、关闭与失败状态，以及每个 tab 的 URL、标题、加载状态、前进/后退可用性。命令在会话内按目标 tab 串行执行并在执行前验证 tab 身份；接管停止 Agent 命令，用户直接操作网页。恢复时由 Agent 重新获取当前标签与页面信息。`apps/desktop` 的任务投影只保存 ID、surface 和显示字段，不保存 Electron、Playwright 或 CDP 对象；显式关闭会话或退出应用才释放这些对象。

替代方案是复用当前仅有 `title/url/status/target` 的投影并靠 UI 推断 tab 状态。它无法准确处理多个标签、外部窗口关闭和目标失效，故扩展明确契约。任务完成后会话保持可回看；显式关闭会话或退出应用才释放资源。

### 5. Browser Use 与 Computer Use 共用还原库的 CUA JS 入口

模型可见工具使用持久 JS 调用及重置，沿用 `@action-driver/cua-repl` 的调用语义，由 `@action-driver/cua` 的合并 `createCUASession` 提供浏览器和桌面对象。一个单元可先用 `cua.getTab()` 操作浏览器，再用 `cua.getApp()` 操作桌面；REPL 跨调用保留变量，重置清除变量与会话。浏览器通过自有 Browser host RPC 执行，桌面通过现有 macOS helper RPC 执行，不把网页操作转成桌面坐标点击。生产模型可见的 `tools.local.browser-use.command` 在统一入口真实验收通过后移除；右侧 UI 继续使用内部 Browser Session 命令端口。

`@action-driver/browser-runtime` 独占通用 Browser/Tab 客户端、命令协议及通用服务；`@action-driver/browser-desktop` 依赖并复用这一客户端，只增加 Codex desktop 原包独有的 service、资源与桌面会话行为。两原 client bundle 相同，service bundle 不同，因此不能仅更换实例就宣称桌面服务等价。`@action-driver/cua` 通过注入获得 browser agent，不反向导入 `browser-desktop`。Electron `WebContentsView`、受管 Chrome 启动、任务绑定与权限留在 Action-Driver 应用层；本机 Chrome 启动实现从通用包迁出。所有特权对象留在宿主进程，REPL 只收发可序列化数据。

每个 browser/computer RPC 按当前任务独立执行 Skill、Policy、接管状态、取消和目标身份检查，已授权一种表面不能授权另一种。工具投影使用模型标题和实际 surface，显示真实 JS 输入、文本/错误/图片输出，并在任务重新读取后保留；截图以受控资源呈现，不输出 Base64 正文。旧 JSON 工具记录不迁移。

替代方案是保留 `browser-use.command` 并将 JSON 动作在卡片中排成伪脚本，实施较小却不能让 Agent 调用 Codex 式 CUA，也不能共享持久变量，因此不采用。另一个方案是把通用 browser runtime 并入 `browser-desktop`，会让 Chrome 与 CUA 通用能力依赖桌面专有服务；并入 `cua` 则增加 desktop→cua 的反向依赖和装配循环风险。因此保留两包，公共调用只实现一次，桌面差异单独实现。

## Risks / Trade-offs

- [原生 view 层级遮挡浮动控制条或弹层] → 控件放在网页区域之外，按可见区域设置 bounds，在分栏、放大、折叠、切换任务和最小窗口下进行真实 Electron 验收。
- [CDP 附着和页面事件行为因 Electron 版本变化] → 锁定仓库现有 Electron 版本，针对实际打包产物验证；对调试器分离和页面销毁提供明确错误。
- [用户与 Agent 同时操作发生目标漂移] → 命令绑定 session/tab；接管暂停 Agent，恢复前重读页面状态；关闭的 tab 不重映射。
- [外部 Chrome 崩溃或清理失败] → 将会话标为失败，拒绝继续使用旧 tab，记录并清理 Action-Driver 自有临时 profile；不触及用户 profile。
- [内置与外部浏览器登录状态不一致] → 明确显示 surface，隔离 profile，不自动迁移认证信息。用户已接受这一权衡。
- [现有 Mock 视觉规范和生产行为冲突] → 仅修改生产任务场景的规范，Mock 仍为视觉验收夹具。
- [产品集成与 browser-desktop 原件还原状态混淆] → 新会话核心单独导出和验收；保留现有 service facade 与尚未完成的差异验证门槛，不声称整个包已达原件等价。
- [统一 JS 会话扩大能力边界] → 在每次可信 RPC 而非只在工具入口检查对应表面授权、任务身份、取消与接管；混合调用和重置单独验收。
- [desktop service 仍有原件差异] → 按 desktop 专有命令、资源与失败路径补齐还原包并真实验收，不用通用 service 或 UI 适配掩盖缺口。
- [工具记录重载后丢失输入输出] → 工具投影完整保留 JS 输入、输出、展示配置和图片引用，使用真实 Electron 任务重载用例验证。

## Migration Plan

1. 在 `packages/browser-desktop` 引入可注入宿主的会话契约与核心，保留当前还原候选 facade 和 Mock 组合根；定向验证生命周期和序列化。
2. 接入内置 view 与 UI 操作，使现有视觉按钮在生产会话中有真实行为。
3. 注册外部 Chrome Provider 和 Agent Browser Use 工具，再接入任务投影与控制。
4. 使用本地 HTTP 页面、真实 Electron 和独立 Chrome 验收。仅在生产路径真实通过后启用；若失败，关闭新 Provider 注册并恢复原生产行为，不删除 Mock 夹具或修改底层服务基线。

## 2026-09-28 联合交付门槛

用户要求 Browser Use 与 `apps/agent-runtime/vendor` 移除一起完成，Computer Use 必须保持可用。此项覆盖先前“CUA 整体替换非前置条件”的分期安排：浏览器会话与 UI 可先独立开发和验证，但最终启用和交付必须等待自有 CUA/Sky/REPL 宿主验收、生产切换及 vendor 删除共同完成。`thirdparty/backup` 仅用于离线对照，不得作为产品回退路径。具体迁移与风险见联合设计 `docs/superpowers/specs/2026-09-28-browser-and-vendor-cutover-design.md`。

## Archive Decision (2026-09-30)

### Decisions

- 最终方向：按用户明确裁决直接归档本变更，保留 5/19 的历史任务状态，不实施剩余任务，也不同步 2 份 delta spec。
- 对比过的替代方案：先审计当前代码与各变更的依赖，完成仍有效的任务、同步规范后再逐项归档。该方案可减少遗留缺口，但需要继续执行用户现已取消的工作。
- 用户覆盖：此前建议先审计并完成有效项；用户随后明确改为整体归档，并确认当前无任务要执行。

### Risks / Trade-offs

- 未完成任务不会因归档而完成；如需这些功能，必须重新立项和验证。
- Delta spec 留在历史归档中，不作为主规范当前要求；归档不删除其他工作树中的未提交文件。
