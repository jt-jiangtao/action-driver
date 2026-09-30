## 1. 放行范围与脱敏分流

- [x] 1.1 新增 `apps/agent-runtime/src/tool-error-exposure.ts`，导出放行消息常量与 `isExposableToolError`；验证：新增用例覆盖每条放行消息命中、以及含动态内容的 `INVALID_REQUEST: …` 不命中。
- [x] 1.2 让 `apps/agent-runtime/src/tool-result-redaction.ts` 的 `redactToolError` 命中放行消息时原样返回、其余继续输出 `[redacted N characters]`；验证：用例断言两类消息的分流结果。
- [x] 1.3 让 Computer Use 的抛出点引用同一常量（Skill 门禁、引擎不可用、执行上下文缺失、待执行代码不可用、工具参数无效、`APP_DENIED`／`APP_FORBIDDEN`／`APP_BUSY` 与授权取消）；验证：`pnpm vitest run apps/agent-runtime/src/computer-use` 全部通过且既有消息文本断言不变。

## 2. 模型可见结果与工具说明

- [x] 2.1 补一条链路用例：会话未读 `computer-use` Skill 时调用 `js`，模型侧工具结果包含 `SKILL_NOT_LOADED` 原文；验证：`pnpm vitest run apps/agent-runtime/tests/agent-graph.test.ts apps/agent-runtime/tests/tool-invocation-service.test.ts`。
- [x] 2.2 在 `apps/agent-runtime/src/computer-use/cua-tools.ts` 的 `js` 说明中追加 Skill 前置条件行；验证：`apps/agent-runtime/src/computer-use/entry.test.ts` 断言说明包含 `skill_read`、`computer-use` 与 `SKILL_NOT_LOADED`。
- [x] 2.3 复现真实失败：在 `apps/agent-runtime/src/computer-use/cua-runtime.test.ts` 中断言未读 Skill 的调用失败消息未被脱敏、且不含 `[redacted`。

## 3. 受信宿主运行前提（读 Skill 后暴露的第二层缺陷）

- [x] 3.1 抽出 `runtimeProcessEnvironment`，在保留既有 `NODE_OPTIONS` 的前提下追加 `--experimental-vm-modules`；验证：`apps/desktop/src/main/runtime-supervisor.test.ts` 断言两种取值。
- [x] 3.2 用真实 Electron utility 进程验证 flag 传递方式：`execArgv` 无效、`NODE_OPTIONS` 生效，并复现／消除受信宿主的 `ENGINE_UNAVAILABLE: trusted host requires VM module support`。
- [x] 3.3 记录实测依据与替代方案（design D4）。

## 4. 失败调用的可恢复性（修复运行前提后暴露的第三层问题）

- [x] 4.1 让失败的 `js` 调用同样进入易失原始结果通道：下一次模型请求携带原始错误与该次调用已产出的输出；验证：`apps/agent-runtime/tests/agent-graph.test.ts` 的失败用例断言模型可见原文、检查点不含原文。
- [x] 4.2 `js` 工具说明补充受支持入口（全局 `cua`，禁止直接 `import("@oai/sky")`）；验证：`apps/agent-runtime/src/computer-use/entry.test.ts` 断言说明文本。
- [x] 4.3 复现真实失败类别以确认根因：`ReferenceError: sky is not defined`（34 字符）与直接导入 `@oai/sky` 触发的 `Cannot find package '@statsig/js-client'`（dist 路径下 207 字符）。

## 5. 界面展示实际代码与直接导入健壮性（用户裁决 A + D）

- [x] 5.1 新增内存代码表并接入 `js` 执行器与 Runtime 装配；验证：`apps/agent-runtime/tests/stream-session-service.test.ts` 同时断言实时流与重订阅都带出内存代码、持久化记录仍只有长度摘要。
- [x] 5.2 界面按 JavaScript 展示 `computer.js` 的实际代码，并在代码不在内存时回落为长度摘要；验证：`apps/desktop/src/renderer/src/components/ActivityTimeline.test.tsx` 覆盖两种状态。
- [x] 5.3 沙箱加载器为 `computer-use-telemetry.js` 提供合成实现，并把加载器接入应用子进程启动参数；验证：`apps/agent-runtime/src/computer-use/cua-runtime.test.ts` 断言 `await import("@oai/sky")` 成功。
- [x] 5.4 让内存记录同时保存该次调用的实际输出与失败原因，流事件新增可选 `rawError` 字段并在完成／失败事件上带出；验证：`apps/agent-runtime/tests/stream-session-service.test.ts` 断言三项原始值与持久化记录仍只有摘要，`apps/agent-runtime/src/computer-use/cua-runtime.test.ts` 断言执行器写入成功输出与失败原因。
- [x] 5.5 界面在 Computer Use 卡片里展示实际输出与原始错误；验证：`apps/desktop/src/renderer/src/components/ActivityTimeline.test.tsx` 断言代码、输出与错误文本均出现。

## 6. 桌面 provider 命令白名单（72 字符错误的根因）

- [x] 6.1 白名单与模型入口对齐，放行 `app-policy`／`session-start`／`session-end`，保留对 `observe`／`shutdown` 等桌面专用或废弃操作的拒绝；验证：`apps/desktop/src/main/computer-use-provider.test.ts`。
- [x] 6.2 工具命名：运行时标题、活动组标题与卡片表头识别 `js`／`js_reset`，不再显示通用的「已调用工具」；验证：`apps/agent-runtime/tests/tool-activity-title.test.ts`、`apps/agent-runtime/tests/agent-graph.test.ts`、`apps/desktop/src/renderer/src/components/ActivityTimeline.test.tsx`。
- [x] 6.3 审批请求改为逐字段构造，不再把调用方上下文里的 `AbortSignal` 写进事件负载；验证：`apps/agent-runtime/src/computer-use/app-approval-broker.test.ts` 断言请求形状恰好为冻结字段。

## 7. 输入、输出与报错持久化（用户覆盖既有隐私裁决）

- [x] 7.1 `js` 执行器不再声明 `redactForPersistence`：输入、输出与错误随调用持久化；删除长度摘要与已执行文本长度记录。
- [x] 7.2 删除只为最小化落库存在的机制：图内易失源码／结果通道、`COMPUTER_CODE_UNAVAILABLE` 分支、仅内存展示通道与 `rawError` 协议字段。
- [x] 7.3 失败调用保留失败前的输出：`ToolInvocationService` 在 catch 中快照已收集输出，并随工具结果回给模型；验证：`apps/agent-runtime/tests/agent-graph.test.ts`、`apps/agent-runtime/tests/tool-invocation-service.test.ts`。
- [x] 7.4 验证刷新后仍可见：`apps/agent-runtime/tests/stream-session-service.test.ts` 断言重新订阅时源码与输出原样回放；`apps/agent-runtime/tests/agent-graph.test.ts` 断言检查点包含源码与失败输出。

## 8. 收尾

- [x] 8.1 运行 `pnpm typecheck` 与 `pnpm lint`，确认无新增告警。
- [ ] 8.2 提交前一次性运行 `pnpm test`（改动涉及运行时行为，必要时追加 `pnpm test:e2e:local`），并把命令与结果写入提交信息。
- [ ] 8.3 归档变更并把 delta 同步进 `openspec/specs/computer-use/spec.md`。

## 迭代验证记录（2026-09-27）

- 1.1／1.2：`pnpm vitest run apps/agent-runtime/tests/tool-error-exposure.test.ts` 通过（2 项）。
- 1.3：`pnpm vitest run apps/agent-runtime/src/computer-use` 通过（13 文件、80 项）；首次并行运行出现一次 `cua-runtime.test.ts` 子进程 dispose 偶发失败，单独重跑与随后的一次全目录重跑均通过。
- 2.1：`pnpm vitest run apps/agent-runtime/tests/agent-graph.test.ts -t "skill gate"` 通过（1 项）；`pnpm vitest run apps/agent-runtime/tests/tool-invocation-service.test.ts` 通过（14 项）。
- 2.2／2.3：`pnpm vitest run apps/agent-runtime/src/computer-use/entry.test.ts apps/agent-runtime/src/computer-use/cua-runtime.test.ts` 通过（18 项）。
- 3.1：`pnpm vitest run apps/desktop/src/main/runtime-supervisor.test.ts` 通过（10 项）。
- 3.2：Electron 38.8.6 实测——`execArgv` 方式 `vm.SourceTextModule` 仍缺失；`NODE_OPTIONS` 方式为 true。用真实宿主模块在 utility 进程内验证：当前环境返回 59 字符 `ENGINE_UNAVAILABLE: trusted host requires VM module support`，加入该 flag 后宿主创建成功。
- 4.1／4.2：`pnpm vitest run apps/agent-runtime/tests/agent-graph.test.ts apps/agent-runtime/src/computer-use/entry.test.ts` 通过（36 项）。
- 4.3：用真实 REPL 子进程复现——`await sky.listApps()` → `ReferenceError: sky is not defined`（34）；`import("@oai/sky")` → `Cannot find package '@statsig/js-client'`（dev 路径 202，dist 路径 207）；`await cua.getState()` 正常。
- 5.1：`pnpm vitest run apps/agent-runtime/tests/stream-session-service.test.ts` 通过（31 项）。
- 5.2：`pnpm vitest run apps/desktop/src/renderer/src/components/ActivityTimeline.test.tsx` 通过（34 项）。
- 5.3：`pnpm vitest run apps/agent-runtime/src/computer-use/cua-runtime.test.ts` 通过（16 项）；实测 `await import("@oai/sky")` 在加载器接入后成功（导出 1 个键），未接入时报 `Cannot find package '@statsig/js-client'`。
- 5.4／5.5：`pnpm vitest run apps/agent-runtime/src/computer-use apps/agent-runtime/tests/stream-session-service.test.ts apps/desktop/src/renderer/src/components/ActivityTimeline.test.tsx apps/desktop/src/renderer/src/services/stream-task-projection.test.ts packages/runtime-contracts/tests/stream-protocol.test.ts` 通过（21 个文件、258 项）。
- 类型与静态检查：`pnpm --filter @action-driver/agent-runtime typecheck`、`pnpm --filter @action-driver/desktop typecheck` 与改动文件 ESLint 通过。
- 6.1／6.2：`pnpm vitest run apps/desktop/src/main apps/agent-runtime/src/computer-use apps/agent-runtime/tests/stream-session-service.test.ts apps/desktop/src/renderer/src/components/ActivityTimeline.test.tsx apps/agent-runtime/tests/tool-activity-title.test.ts apps/agent-runtime/tests/agent-graph.test.ts` 通过（38 个文件、257 项）。
- 6.3：实际错误 `PERSISTENCE_PAYLOAD_REJECTED at runtimeEvent.payload.approval.signal: DOM, Electron, and other live objects are forbidden` 的根因是审批请求展开了调用方上下文；修复后 `pnpm vitest run apps/agent-runtime/src/computer-use apps/agent-runtime/tests/stream-session-service.test.ts apps/desktop/src/main apps/agent-runtime/tests/agent-graph.test.ts` 通过（36 个文件、218 项）。
- 根因确认：用户实际错误 `SKILL_PROVIDER_FAILED: INVALID_REQUEST: Unsupported Computer Use command` 长度正好 72，与历史记录中的 `[redacted 72 characters]` 一致；原因是 provider 白名单未跟上应用寻址改造。
- 7.1 至 7.4：`pnpm vitest run apps/agent-runtime/src/computer-use apps/agent-runtime/tests apps/desktop/src packages/runtime-contracts/tests packages/contracts` 覆盖 159 个文件、1055 项；其中 1 项在并行全量下失败（`cua-runtime.test.ts` 的 `does not count the real application approval wait against the cell budget`，时间预算用例），单独运行与较小批次均通过，属该文件既有的并行时序抖动。
- 8.1 类型与 Lint 已在本轮提交前批次通过；8.2 验证已执行但存在未解决失败，8.3 尚未归档。

## 本地检查点提交验证（2026-09-27）

- 用户明确授权提交全部当前工作区改动，按主题拆分；本次保存代码检查点，不声明所有验收通过。
- `pnpm typecheck`：通过。
- `pnpm lint`：通过。首次扫描因项目内新加入 Fork 源码而终止；补充 thirdparty 排除后完成，146 项交互声明有效。
- `pnpm test`：169 文件通过、1 文件失败、2 文件跳过；1117 项通过、1 项失败、2 项跳过。没有重复运行全量单测。
- 失败：`cua-runtime.test.ts` / `does not count the real application approval wait against the cell budget`，TIMED_OUT。用例代码与 HEAD 相同，但本轮定向复核仍失败，未证明只是并行抖动，也未证明与全部代码改动无关。
- `pnpm test:e2e:local`：6 通过、2 失败、1 跳过。失败为 Token Plan 设置项 `wan2.7-image 生图接口` 不存在，以及宽图预览 `wide-image.png` 不存在；这些设置/图片相关文件本轮无改动，仍保留为未解决失败。
- 两个 OpenSpec change 的 strict 校验与 `git diff --check` 通过。
- `pnpm test:e2e:packaged:macos`：通过，arm64 打包应用冒烟 1 项；内置运行时与 Renderer 认证成功。
- 独立审查 P2 未解决：失败调用输出虽存入 invocation，但 tool.failed 不携带 output，stream projector 仅 completed 携带 rawOutput；因此失败前的打印内容尚未在界面和回放完整呈现。当前保存用户要求的本地检查点，不将此能力标为最终验收通过，不归档。
