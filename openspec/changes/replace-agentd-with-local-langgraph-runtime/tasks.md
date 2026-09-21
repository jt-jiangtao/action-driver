## 1. TypeScript 工作区与运行时合同

- [x] 1.1 建立 `apps/agent-runtime` TypeScript 包、独立入口和构建产物，锁定 LangGraph、LangChain Core、InversifyJS、Zod 与 SQLite 依赖，并验证 `pnpm install --frozen-lockfile`、该包 typecheck 和 build 通过。
- [x] 1.2 建立 `packages/runtime-contracts`，定义握手、命令、响应、事件、Skill 反向调用和错误的 discriminated union 与 Zod schema，并用单元测试验证所有合法 fixture 可往返、未知类型和错误版本被拒绝。
- [x] 1.3 增加结构化克隆与协议兼容测试，验证合同不包含函数、DOM/Electron 对象或 Provider 私有引用，且主版本不一致在业务命令前失败。

## 2. LangGraph Agent Runtime

- [x] 2.1 先编写组合根测试，再实现 Runtime 的 InversifyJS token、端口和 `mock | local` 绑定，验证确定性模型与 Mock Skill 不需要网络和模型凭据即可解析。
- [x] 2.2 实现最小 `StateGraph` 及 acceptGoal、plan、resolveSkill、invokeSkill、verifyOutcome、awaitUser、finish/failed 节点，验证同一 task id 始终映射到同一 LangGraph thread id，且框架类型不泄漏到领域 contracts。
- [x] 2.3 实现等待用户、`Command({ resume })`、AbortSignal 中断和从最近安全 checkpoint 继续，使用可控 Promise 测试等待用户、中断进行中模型、禁止后续 Skill 调用和继续恢复四条路径。
- [x] 2.4 实现 ModelGateway 端口与 DeterministicModelGateway，验证请求只携带当前推理所需上下文、远程错误形成可诊断任务状态且本地历史仍可读取。

## 3. SQLite 历史与 Checkpoint

- [x] 3.1 建立业务数据库连接、WAL/foreign-key/busy-timeout 配置及只前进 migrations，创建 tasks、messages、steps、skill_invocations、runtime_events 和 schema_migrations，并用临时数据库验证首次创建、幂等启动与失败回滚。
- [x] 3.2 实现 Task、Message、Step、SkillInvocation 和 RuntimeEvent 仓储，验证状态变化与对应业务事件在同一事务提交，失败时均不落盘，Renderer/Main 无直接数据库入口。
- [x] 3.3 接入官方 LangGraph SQLite checkpointer，验证 checkpoint、pending writes、thread id 和 checkpoint id 在 Runtime 重启后可恢复，损坏或未完成 checkpoint 被忽略。
- [x] 3.4 实现 checkpoint 到业务投影的幂等 ProjectionService 与启动 reconciliation，注入“checkpoint 已提交但投影未写入”的崩溃点，验证重启补齐且不产生重复事件。
- [x] 3.5 增加持久化载荷守卫测试，验证 DOM/Electron 对象、实时 Handle、坐标引用、原始 Cookie 和 Session Token 无法进入历史或 checkpoint。

## 4. Skill Registry 与 Provider 路由

- [x] 4.1 先编写 Registry 测试，再实现按 `skillId + contractVersion` 注册、下线和解析 Provider，验证 Browser 与 Computer Provider 状态互不影响且缺失能力返回 `CAPABILITY_UNAVAILABLE`。
- [x] 4.2 为每次调用保存 requestedSkillId、resolvedProviderId、providerVersion 和生命周期事件，验证逻辑别名解析后仍能追溯实际 Provider。
- [x] 4.3 实现 Skill execute/result/cancel 状态机，验证 queued、running、paused、waiting_user、takeover、completed、failed、cancelled 的合法转换，且用户中断后在调用终态前不会调度下一动作。
- [x] 4.4 在 Electron Main 建立仅含 Mock Browser/Computer Provider 的 SkillProviderHost，验证反向调用、超时、迟到响应和 Provider 下线；不得添加 Playwright、Native Browser 或 macOS 动作实现。

## 5. UtilityProcess 传输与生命周期

- [x] 5.1 先编写 Supervisor 状态机测试，再实现 `utilityProcess.fork()` 单实例启动、就绪、异常退出、60 秒内最多 3 次重启、受控关闭和超时 kill，验证多窗口不会创建第二个 Runtime。
- [x] 5.2 实现 MessageChannelMain/parentPort 上的 RuntimeServer 与 RuntimeClient，验证握手、request id、deadline、schema 校验、双向 Skill 请求和断线时 pending request 全部失败。
- [x] 5.3 实现按持久化 cursor 的事件订阅、ack 和重连恢复，验证从 `cursor + 1` 继续、重复 cursor 不重复应用且迟到事件不覆盖新状态。
- [x] 5.4 增加 Runtime 入口路径和应用数据路径解析测试，验证开发产物与打包后 macOS arm64/x64 路径均可解析，路径和消息端口不暴露给 Renderer。

## 6. Electron、前端依赖注入与现有 UI 集成

- [x] 6.1 在 Main 注册明确命名的 Agent IPC Handler，在 Preload 暴露最小 submit/get/interrupt/continue/provideInput/subscribe API，并验证 Renderer 无法访问 MessagePort、UtilityProcess、数据库路径或通用 IPC。
- [x] 6.2 实现协议 DTO 到现有 `packages/contracts` 的映射和本地 AgentCommandService/AgentSessionRepository 适配器，验证结构化克隆安全、错误映射完整且 React 组件无需导入 Runtime 合同。
- [ ] 6.3 完善 Renderer 的 InversifyJS composition root 和类型化 React Context bridge，使首页、任务页与组件只消费 `AppServices`，并用容器测试验证 mock/local adapter 可替换、组件不导入 Container 且不会直接构造基础设施实现。
- [ ] 6.4 更新 Renderer、Main 和 Runtime 三层组合根，使视觉/组件测试继续绑定 Mock、生产绑定 local Runtime；运行现有首页和任务页测试及 Playwright 视觉用例，确认布局、文案和已绘制交互没有变化。
- [ ] 6.5 增加桌面集成测试，验证提交目标、收到时间线事件、中断、继续、等待用户恢复和应用退出清理的完整路径，所有数据使用 Mock Provider。

## 7. 打包、CI 与交付验证

- [ ] 7.1 配置 Electron 打包包含 Agent Runtime 构建产物和 SQLite 原生依赖，验证缺失 Runtime、ABI 不匹配或目标架构产物缺失时构建失败而不回退 Mock。
- [ ] 7.2 扩展 Docker quality 流程运行 TypeScript typecheck、lint、单元测试、数据库迁移和 Runtime 合同测试，并在固定 macOS runner 执行打包后 UtilityProcess/SQLite 冒烟。
- [ ] 7.3 运行格式、类型、Lint、单元、Electron E2E、视觉回归、macOS Runtime 冒烟和 `openspec validate replace-agentd-with-local-langgraph-runtime --strict`，确认未恢复 Go/Eino/gRPC/Protobuf 且未实现真实 Browser/Computer 动作。
- [ ] 7.4 更新架构文档说明 `establish-runtime-foundations` 的 Runtime 决策已被本 change 取代，并验证仓库搜索不再将 Go/Eino Agent Service 描述为当前目标架构。
