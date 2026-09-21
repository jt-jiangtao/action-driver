# ActionDriver 路线与任务清单

本文件汇总已确认的终态目标与各阶段关键任务，用于防止任务遗漏。每个阶段的实现在对应 OpenSpec change 中展开，本文件只做索引与验收锚点。

## 终态目标

**产品**：仅支持 macOS、面向普通用户的通用电脑操作 Agent；同时覆盖 Browser Use 与 Computer Use，先完成 Browser Use，再扩展到整个 macOS。

**架构**：

- 客户端：Electron + 页面（展示与操作）+ Main（本机独占能力：Browser/Computer Skill、macOS 权限、窗口）。
- 服务端：当前集成在客户端内的本地服务端，负责会话与配置的唯一写入（写本地存储）、Agent Loop、模型请求真实发起；必须可原样迁移到云端，后期承载云端执行。
- 传输：客户端与服务端之间使用 HTTP（配置与查询）与 WebSocket（会话、事件、控制命令、反向 Skill 调用）。
- 数据：历史与会话数据写在本地，服务端是唯一写入者；云端阶段的数据归属与同步策略需独立裁决。

## 阶段与关键任务

### 功能里程碑顺序（2026-09-22 用户确认，按前端功能逐个扩展）

1. **模型配置 → 测试 → 选择**：设置页连接管理（协议、地址、密钥、发现、连接测试、模型测试、不支持文本）、首页与任务页的模型选择器接到真实连接。
2. **列表**：侧栏最近任务与会话列表改为服务端真实数据（替换 Mock 任务目录）。
3. **实际生成**：提交目标后由真实模型驱动 Agent Loop，页面时间线展示真实推理与结果。
4. **添加 Skill**（MCP 暂不考虑）：Skill 管理入口与注册/调用链路，Browser/Computer 之外的 Skill 也走同一契约。
5. **Browser Use**：内嵌浏览器真实执行、观察、目标高亮与接管。
6. **Computer Use**：macOS 全系统操作。

### 阶段 1：服务端化与传输（进行中）

对应 change：`serve-runtime-over-http`（HTTP/WS 服务端、配置与凭据迁入服务端、客户端收窄）。

关键任务：

- 服务端 HTTP + WebSocket 传输、访问凭据、生命周期与单实例。
- 配置与凭据由服务端写入本地；模型请求由服务端真实发起。
- 页面改为 HTTP/WS 客户端；Main 与 Preload 收窄。
- 迁移已配置连接；移除 MessagePort 私有 RPC 与被取代的客户端实现。
- 契约、集成、断线恢复、打包与安全验证。

### 阶段 2：Browser Use（下一个独立 change）

终态：网页直接嵌入产品内部、不调起外部浏览器；浏览器操作以 Skill 暴露；页面实时展示观察、步骤、目标高亮与结果；浏览器内悬浮控制条承载暂停/继续/人工接管。

关键任务：

- Playwright Fork 第一版：内嵌会话、导航、点击输入、截图与观察。
- Browser Skill Provider 真实实现（注册、调用、取消、超时、接管），与 Mock Provider 并存以便测试。
- 页面接线：真实导航结果、目标高亮、状态动画与执行时间线。
- Action Graph 的第一次落地（页面元素图、稳定引用、增量观察）。
- 与 Computer Use 保持独立注册与独立评测。

### 阶段 3：Native Browser Engine（定制 Electron/Chromium Fork）

终态：维护定制 Electron/Chromium Fork，改内核向 Agent 暴露适合自动化的 Action Graph、稳定 Node Handle、增量观察与受约束动作接口；接入 Jev 依据 Action Graph 快速选择动作。

关键任务：

- Chromium/Electron Fork 构建与供应链（版本固定、可复现构建、产物校验）。
- 内核侧暴露 Action Graph、稳定 Node Handle 与受约束动作 API。
- 观察与动作的增量协议（避免全量快照与高 token 消耗）。
- Jev 接入与评测（选择准确率、延迟、成本）。
- 与 Playwright 引擎各自保留接口与评测边界，不抽象成同一底层 Provider。

### 阶段 4：Computer Use（macOS 全系统操作）

终态：通过 AXUIElement、CGEvent 与 ScreenCaptureKit 实现全系统 Computer Use；仅支持 macOS；与 Browser Use 高层统一（同一 Skill 契约与 Agent Runtime），底层各自独立。

关键任务：

- Swift/Objective-C++ 原生服务：辅助功能读取、事件注入、屏幕采集。
- 权限引导与降级：辅助功能、录屏授权缺失时的提示与安全失败。
- Computer Skill Provider 接入服务端反向调用通道。
- 观察与动作的数据最小化（不落盘原始屏幕与敏感内容）。
- 与 Browser Use 统一的任务步骤、报告与接管语义。

### 阶段 5：云端执行

终态：服务端部署到云端执行 Agent Loop，运行在云端侧的隔离环境中；**云端不操作用户本机 GUI**（已裁决 2026-09-22），本机 GUI 动作只发生在本地形态。

关键任务：

- 云端装配：传输（HTTPS/WSS）、存储（远端）、凭据（托管密钥服务）、部署与可观察性。
- 云端侧执行环境与能力范围（例如云端浏览器/沙箱）的选型与隔离边界。
- 历史归属与同步策略（需要独立 Battle：客户端权威 / 云端权威 / 混合）。
- 账号与鉴权体系（设备身份、最小权限、可撤销凭据）。

### 阶段 6：记忆与重放

终态：Page Memory、Procedure Memory 与零 Token 重放，依赖稳定的 Action Graph。

关键任务：

- 页面与流程记忆的数据模型与写入策略。
- 重放执行器与失效检测（页面变化时降级回模型决策）。
- 与隐私策略的边界（不记忆敏感内容）。

## 贯穿阶段

- 打包与发布：macOS arm64/x64 产物、原生依赖、签名与更新。
- 质量门禁：类型、Lint、单元、契约、集成、视觉回归、打包后冒烟。
- 治理：决策型任务先完成 Battle 并在 OpenSpec 留痕；执行型任务直接推进。
