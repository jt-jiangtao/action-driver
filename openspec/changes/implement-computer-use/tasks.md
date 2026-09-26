## 1. 原生服务骨架

- [x] 1.1 建立签名内置的 Swift helper 目标与构建脚本，设置最低 macOS 14，验证可在 macOS arm64/x64 构建产物，并与正式应用使用稳定身份。
- [x] 1.2 定义服务与 Main 的消息契约（观察、动作、采集、权限、错误），用契约测试验证请求/响应可序列化。
- [x] 1.3 实现私有 stdio 消息通道与生命周期（启动、就绪、退出、崩溃重启），验证单实例、无监听端口与受控关闭。
- [x] 1.4 实现权限探测与状态返回（辅助功能、屏幕录制），验证缺失时返回可诊断状态并给出授权引导。

## 2. 观察能力

- [x] 2.1 实现窗口与元素遍历（AXUIElement），验证返回角色、名称、层级与可执行动作。
- [x] 2.2 实现元素引用指纹与校验，验证界面变化后引用失效并返回 `STALE_REFERENCE`。
- [x] 2.3 实现观察结果裁剪（深度与数量上限），验证大数据界面不产生超大载荷。
- [x] 2.4 增加观察单元测试（使用注入的元素替身），覆盖空窗口、嵌套层级与失效引用。
- [x] 2.5 验证跨应用及窗口、显示器切换后重新观察，旧元素引用和坐标不得继续执行；系统授权后不增加应用白名单。

## 3. 动作能力

- [ ] 3.1 实现点击（元素中心与坐标）与验证返回可观察结果。
- [ ] 3.2 实现文本输入与按键注入（CGEvent），验证中文与快捷键输入。
- [ ] 3.3 实现滚动与等待动作，验证边界（无可滚动区域、等待超时）。
- [ ] 3.4 实现动作截止时间与取消，验证超时返回可诊断结果且迟到效果被记录。
- [ ] 3.5 增加动作集成测试（在可预测的系统窗口中执行），验证点击与输入结果。
- [x] 3.6 对每次点击、元素点击、输入和按键在 Runtime 提出具体动作确认，批准绑定单次调用；验证拒绝确认时 helper 不执行动作，屏幕与 AX 文本不得授予执行权限。

## 4. 屏幕采集

- [x] 4.1 实现按需单帧采集（ScreenCaptureKit），验证返回图像与尺寸上限。
- [x] 4.2 实现区域与分辨率约束，验证超限请求被拒绝或裁剪。
- [x] 4.3 验证采集结果不写入历史与日志（内存处理守卫测试）。
- [x] 4.4 建立经鉴权、分块、有大小与 TTL 上限的内存图像通道；Skill 输出与 LangGraph 状态只传短期句柄，模型请求只在当次推理解析图像，完成、取消、超时和断线时清理。
- [x] 4.5 验证原始图像字节不出现在 Skill 数据库、检查点、事件、日志或可恢复历史；句柄过期返回重新观察状态。

## 5. Provider 与 Runtime 接线

- [x] 5.0 通过现有多轮 Tool/Policy Gate 注册类型化 Computer Tools，委托独立 Computer Skill Provider，实现观察、动作、再观察循环；不得走只调用一次便结束的旧 Skill 分支。
- [x] 5.1 以独立 Provider 标识注册 Computer Use，验证与 Browser Use 互不影响。
- [x] 5.2 通过既有反向调用通道执行观察与动作，验证请求标识、截止时间与取消语义。
- [x] 5.3 实现能力错误映射（权限缺失、引擎不可用、引用失效、超时），验证任务状态可诊断。
- [ ] 5.4 验证非 macOS 平台返回不可用且不影响其他能力。

## 6. 页面投影与控制

- [x] 6.1 时间线展示桌面步骤与结果，验证与 Browser Use 相同的状态语义。
- [x] 6.2 将暂停/继续/接管接线到 Runtime、Main 与 helper 的实际门禁，修正当前硬编码 Browser Skill 的控制事件，验证接管期间阻止 Agent 动作。
- [x] 6.3 展示分项权限引导、系统设置路径、实际需授权进程名、重新检测与失败状态，并说明远端模型可能接收观察内容。

## 7. 验证

- [x] 7.1 增加端到端集成测试（Mock 原生替身）：请求观察 → 动作 → 结果 → 接管。
- [ ] 7.2 增加签名打包冒烟：helper 随应用启动、权限归属、授权后重检或重启、权限撤销、单次观察与动作；记录实际系统设置显示名称。
- [x] 7.3 提交前运行 `pnpm typecheck`、`pnpm lint`、`pnpm test`，以及与界面、运行时、打包变更相关的 `pnpm test:e2e:local`、`pnpm test:e2e:packaged:macos`，记录通过和失败数量。

## 8. 授权指引窗口

- [x] 8.1 协议与 helper 支持 `permissions` 的 `prompt` 与 `target`：按单项触发辅助功能、屏幕录制与输入事件的系统授权请求；只读预检不登记应用。
- [x] 8.2 实现独立授权指引窗口：无标题栏边框、固定尺寸、无关闭按钮、`Esc` 返回主窗口，两窗口可同时存在。
- [x] 8.3 按参考形态实现窗口内容：参考图同款图标、中文标题与说明、逐项卡片（`允许`/`已完成`/“在系统设置中完成”），且不提供底部按钮。
- [x] 8.4 Computer Use 被调起且缺权限时自动打开指引窗口；无手动入口、无“不再提示”持久化、同一任务只打开一次。
- [x] 8.5 记录系统设置中的实际显示名称并区分开发构建与签名打包构建。
- [x] 8.6 运行定向测试与全量验证并记录结果，包含两个窗口同时存在时的样式检查。
- [x] 8.7 串行化 Main 侧 helper 请求，消除两个窗口并发探测导致的 `ENGINE_UNAVAILABLE: Computer Use is busy`。

## 验证记录

2026-09-26，本机 macOS arm64：

- `swift test`（`apps/native-computer-use-helper`）：5 项通过。
- `pnpm typecheck`、`pnpm lint`：通过；交互契约校验 138 项声明。
- `pnpm test`：150 个文件通过、2 跳过；935 个用例通过、2 跳过。
- `pnpm test:e2e:local`：7 项中 6 项通过，1 项失败——既有 `persists the selected Token Plan image API and default model in settings` 用例仍在查找当前设置界面已移除的“生图接口”下拉框，与本次改动无关（同一失败已记录在 `openspec/changes/archive/2026-09-26-add-office-document-system-skills/tasks.md`）。本次另修正该文件中过期的 preload 桥接键断言（补齐 `computerUse` 与既有 `taskOutput`）。
- `pnpm test:e2e:packaged:macos`：通过。打包脚本把 helper 放入 `Contents/Helpers/ActionDriver Computer Use.app`，校验可执行位、arm64 架构与 `codesign --verify --strict`，随后打包应用启动并通过 `packaged-runtime.spec.ts`。
- 真实 helper 二进制 stdio 冒烟（`dist/arm64/actiondriver-computer-use`）：`permissions` 返回 `{accessibility, screenRecording, eventPosting, permissionTarget: "ActionDriver Computer Use"}`；`observe` 返回当前前台应用的结构化元素树与 `observationId`；`maxElements: 1, maxDepth: 1` 时返回树仅 1 个节点；失效 `observationId` / `elementRef` 的 `act` 返回 `STALE_REFERENCE`；`shutdown` 返回 `{accepted: true}` 并退出。
- 真实 helper 单会话串行冒烟：逐条请求/响应可用；`wait` 请求超过自身截止时间时返回 `{"code":"TIMED_OUT","message":"Request deadline elapsed"}`；随后 `shutdown` 返回 `{accepted: true}` 并退出。
- 同一时刻并发投递的第二个请求返回 `ENGINE_UNAVAILABLE: Computer Use is busy`：单实例 helper 选择拒绝而不是排队，Main 侧每条任务的动作轮次本身串行；多任务同时操作桌面会被拒绝而非静默交错。

2026-09-26，授权指引窗口（本轮追加）：

- 实测本机“系统设置 → 隐私与安全性 → 设备控制和数据访问”列表：`ChatGPT` 开启，`Codex Computer Use` 关闭，没有 `ActionDriver Computer Use` 条目。开发构建下 helper 由宿主进程启动、ad-hoc 签名无 Team ID，读回的三项权限都继承宿主授权，所以窗口直接显示 `Done`，系统不会出现“拖入列表”的指引。
- 指引窗口按 Codex 参考形态 1:1 实现：无窗口标题文本（清空文档标题，避免共用 `index.html` 的 `ActionDriver` 标题泄漏到标题栏）、应用图标、`Enable Codex Computer Use` 标题与说明、`Accessibility` 与 `Screenshots` 两张卡片。参考图里的 `Chrome Extension` 一行不复制；输入事件随辅助功能生效，也不单列。
- `pnpm test:e2e:local`：8 项中 7 项通过。新增用例验证：`ensureGuidance` 打开第二个窗口、两窗口同时存在、指引窗口 `closable=false`/`resizable=false`、窗口标题不含 `ActionDriver`、点 `Back` 后只剩一个窗口。唯一失败仍是既有的 `persists the selected Token Plan image API and default model in settings`。
- `pnpm typecheck`、`pnpm lint` 通过（交互契约 145 项）；`pnpm test`：153 个文件通过、2 跳过，951 个用例通过、2 跳过。
- 样式检查：用真实应用同时打开主窗口与指引窗口截图核对，指引窗口在独立表面下自适应、无设置页侧栏残留。
- 待确认：窗口文案里的产品名当前取 `Codex`（与本机系统设置条目一致），如需改回其它名称，只需改 `ComputerUseGuidance.tsx` 的 `PRODUCT_NAME` 常量。

2026-09-26，指引窗口视觉与并发收尾：

- 参考图 1:1 复刻：辅助功能改为蓝色圆环 + 蓝色人形，屏幕录制改为取景框四角 + 灰色填充相机，与参考图字形一致；文案改为中文；窗口顶部不再有标题栏边框（`hiddenInset` + 内容自带拖拽区）。
- 去掉底部三个按钮：授权后切回窗口自动重新检测（`focus`），`Esc` 返回主窗口，`Esc` 销毁窗口会打断 Playwright 的按键调用，因此 E2E 断言改看窗口数量结果。
- 修掉同屏并发缺陷：`ComputerUseClient` 现在串行派发请求；新增用例证明第二条请求在第一条应答前不会写入 helper，从而不再出现 `ENGINE_UNAVAILABLE: Computer Use is busy`（该错误出现在用户截图中）。
- 验证：`swift test` 8 项通过；`pnpm typecheck`、`pnpm lint` 通过（142 项交互契约）；`pnpm test` 153 个文件通过、2 跳过，952 个用例通过、2 跳过；`pnpm test:e2e:local` 8 项中 7 项通过，唯一失败仍是既有的 “生图接口” 下拉框用例。

仍未完成的验证：

- 3.1–3.5 需要把真实点击、中文／快捷键输入与滚动注入到可预测的系统窗口，会改动本机桌面焦点与内容，未在本次自动执行；本次只验证了等待超时、失效引用与权限缺失等无副作用路径。3.4 中“迟到效果被记录”同样依赖真实越界动作。
- 5.4 需要在非 macOS 主机上运行；本机只能验证注册被平台开关关闭的代码路径。
- 7.2 的 helper 随应用启动、TCC 权限归属、授权后重检／重启、权限撤销与系统设置中的实际进程名需要用户在“系统设置 → 隐私与安全性”交互授权后确认；本次只验证了打包、签名、启动与直接调用 helper 的能力域行为。带正式 Developer ID 的发布签名（`ACTIONDRIVER_CODESIGN_IDENTITY`）同样未在本机执行。
