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

仍未完成的验证：

- 3.1–3.5 需要把真实点击、中文／快捷键输入与滚动注入到可预测的系统窗口，会改动本机桌面焦点与内容，未在本次自动执行；本次只验证了等待超时、失效引用与权限缺失等无副作用路径。3.4 中“迟到效果被记录”同样依赖真实越界动作。
- 5.4 需要在非 macOS 主机上运行；本机只能验证注册被平台开关关闭的代码路径。
- 7.2 的 helper 随应用启动、TCC 权限归属、授权后重检／重启、权限撤销与系统设置中的实际进程名需要用户在“系统设置 → 隐私与安全性”交互授权后确认；本次只验证了打包、签名、启动与直接调用 helper 的能力域行为。带正式 Developer ID 的发布签名（`ACTIONDRIVER_CODESIGN_IDENTITY`）同样未在本机执行。
