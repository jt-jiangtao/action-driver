## Purpose

定义 Action-Driver 自有浏览器会话在内置网页和独立 Chrome 窗口中的可观察行为、Agent 与用户的共同操作边界，以及资源关闭和故障恢复规则。

## ADDED Requirements

### Requirement: 创建受管浏览器会话
系统 SHALL 为任务创建带有稳定会话 ID 的受管浏览器会话，并明确标识内置或外部 Chrome 表面。外部表面 MUST 由 Action-Driver 自行启动并使用隔离 profile；系统 MUST NOT 连接、列举或接管用户已经打开的浏览器实例和标签页。首版外部表面 SHALL 仅支持 macOS Chrome。

#### Scenario: Agent 打开内置浏览器
- **WHEN** Agent 为任务请求内置浏览器会话
- **THEN** 任务右侧出现真实可操作网页，该任务的 Agent 操作和用户页面操作引用同一会话与标签页

#### Scenario: Agent 启动外部 Chrome
- **WHEN** Agent 为任务请求外部 Chrome 表面且本机 Chrome 可用
- **THEN** Action-Driver 启动独立 Chrome 窗口与 profile，Agent 能在该窗口的受管标签页继续操作

#### Scenario: 用户已有 Chrome 窗口
- **WHEN** 用户的 Chrome 已有窗口或标签页且 Agent 请求外部 Chrome
- **THEN** 新会话仍使用 Action-Driver 自行启动的隔离窗口，不获取已有窗口或标签页

### Requirement: 操作真实标签页
系统 SHALL 在受管会话中支持新建、列出、选择、关闭标签页，以及 URL 导航、后退、前进、刷新、标题与 URL 更新。Agent 的 Browser Use 工具 SHALL 能在指定受管标签页执行导航、点击、输入、滚动和截图，结果 SHALL 对应实际网页状态而非静态占位。

#### Scenario: 用户在右侧浏览
- **WHEN** 用户新建标签页、输入 HTTP(S) 地址、点击链接，再使用后退和前进
- **THEN** 右侧显示实际页面，当前标签的标题、地址及导航可用状态随页面变化

#### Scenario: Agent 操作所见页面
- **WHEN** Agent 在内置会话对当前标签页点击、输入并提交本地测试页面
- **THEN** 右侧同一标签页显示提交结果，Agent 随后的截图和页面状态反映该结果

#### Scenario: Agent 操作外部页面
- **WHEN** Agent 在其启动的外部 Chrome 标签页导航、点击、输入并截图
- **THEN** 操作发生在该独立窗口的指定标签页，用户可在窗口观察对应页面变化

### Requirement: 协调 Agent 与用户控制
系统 SHALL 将用户与 Agent 操作绑定到同一会话及明确的标签页；人工接管 SHALL 暂停该会话的 Agent 操作，恢复后 Agent SHALL 重新读取当前页面状态。系统 MUST NOT 将等待中的命令发送到已关闭或已切换身份的标签页。

#### Scenario: 用户接管并修改页面
- **WHEN** 用户接管正在运行的 Browser Use 会话并在页面中修改内容
- **THEN** Agent 对该会话暂停操作，用户能够继续直接操作；恢复后 Agent 依据修改后的状态继续

#### Scenario: 目标标签页关闭
- **WHEN** 命令排队后其目标标签页被关闭
- **THEN** 系统返回明确的标签页失效错误，不在另一标签页重放该命令

### Requirement: 显示失败并清理资源
系统 SHALL 将浏览器启动、导航、关闭和连接故障转换为可见状态；显式关闭浏览器会话或退出应用时 SHALL 释放其受管网页和外部 Chrome 资源。任务完成后在应用仍运行期间 SHALL 保留可回看的受管页面。失败 MUST NOT 被显示为成功的静态网页。

#### Scenario: Chrome 不可用
- **WHEN** Agent 请求外部 Chrome 而本机 Chrome 不存在或无法启动
- **THEN** 工具调用失败，任务页说明原因，且不连接其他浏览器

#### Scenario: 外部窗口被用户关闭
- **WHEN** 用户关闭 Action-Driver 启动的 Chrome 窗口
- **THEN** 会话显示已关闭或失败状态，后续命令不再发送到旧页面，并可显式启动新会话

#### Scenario: 会话结束
- **WHEN** 用户显式关闭浏览器会话或退出应用
- **THEN** 其受管标签页、窗口和临时 profile 被清理，不影响用户原有 Chrome 会话

### Requirement: 保持服务独立与能力边界
浏览器底层包 MUST 只通过 Action-Driver 自有宿主接口执行，不依赖 Codex App 私有服务、认证 broker、会话元数据或原生管道。Agent 的操作 MUST 经过 Tool Registry、Policy Gate 和 Browser Use Provider；Renderer MUST 只使用具名类型化桥接，不得直接访问底层浏览器对象。

#### Scenario: Agent 通过统一 CUA JS 操作浏览器与桌面
- **WHEN** Agent 在同一持久 JS 会话中依次调用 `cua.getTab()` 的浏览器方法和 `cua.getApp()` 的桌面方法
- **THEN** 浏览器调用由 Action-Driver 受管浏览器宿主执行，桌面调用由自有 macOS helper 执行，两者共享 REPL 变量但分别经过对应 Skill 与 Policy Gate；工具记录保存实际 JS 输入和执行输出

#### Scenario: 重置 CUA JS 会话
- **WHEN** Agent 重置 JS 会话后再次获取浏览器或桌面状态
- **THEN** 旧 JS 变量失效，新会话重新初始化对应自有宿主，不能复活旧表面或绕过授权

#### Scenario: 只获准一种表面
- **WHEN** Agent 在一个 JS 单元中调用未获准的另一种表面
- **THEN** 宿主拒绝该表面的 RPC，已获准表面的授权不会扩展到另一表面

#### Scenario: 拒绝未授权操作
- **WHEN** Agent 尝试使用本轮未获授权的 Browser Use 工具
- **THEN** Policy Gate 拒绝调用，浏览器会话状态不变

#### Scenario: 独立宿主验收
- **WHEN** 在未运行 Codex App 私有服务的 macOS 环境执行内置与外部浏览器验收
- **THEN** 两种受管表面均可使用 Action-Driver 自有宿主完成本地页面操作
### Requirement: Browser Use 与自有运行时联合交付
系统 SHALL 在生产 Browser Use 的内置浏览器和外部 Chrome 均通过真实 macOS 验收、Computer Use 自有宿主保持可用并删除 `apps/agent-runtime/vendor` 后，才将两者视为联合交付完成。`thirdparty/backup` 只用于离线对照，MUST NOT 作为运行时依赖。

#### Scenario: 浏览器基础功能已通过但 Computer Use 尚未切换
- **WHEN** Browser Use 在本地夹具可操作，但 Computer Use 仍依赖 vendor
- **THEN** 可以继续迭代浏览器，不将联合交付标记完成
