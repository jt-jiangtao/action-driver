## 1. 宿主生命周期端口与入口拆分

- [x] 1.1 定义宿主生命周期端口（就绪上报 `ready(descriptor)`、关闭订阅 `onShutdown(handler)`）并把 `ParentPortLike` 收为 Electron 适配器实现细节；验证：新增单元测试覆盖就绪描述符形状与关闭回调只触发一次
- [x] 1.2 从 `runtime-process.ts` 抽出宿主无关的 `createAgentRuntime(options)`，返回 `{ ready, close }`；验证：`runtime-process` 定向单测通过，启动与关闭顺序与现状一致
- [x] 1.3 实现 Electron utility process 适配器，保持 `runtime.ready`（含服务描述符）与 `runtime.shutdown` 语义；`runtime-entry.ts` 退化为该适配器；验证：桌面端 `runtime-supervisor` 定向测试通过，无 Electron 依赖注入
- [x] 1.4 实现纯 Node 进程适配器（SIGINT/SIGTERM 触发关闭、退出码传播）与对应入口；验证：不启动 Electron 即可启动 Runtime 并在 HTTP/WS 上完成一次会话（新增定向冒烟测试）
- [x] 1.5 宿主缺失场景显式失败（既无父端口也无线程信号通道）；验证：单元测试断言错误码与信息，且不产生半初始化资源

## 2. 存储与执行装配收敛

- [x] 2.1 抽出 `createRuntimeStorage({ dataRoot })`：统一构造 rollout 日志与投影、辅助状态库、资产目录、输入/输出文件、checkpointer、模型连接文件，并暴露 `close()`；验证：定向单测断言构造顺序与释放覆盖全部句柄
- [x] 2.2 抽出执行环境与插件装配入口（沙箱、运行时路径、插件宿主），使 `createAgentRuntime` 只编排、不内联具体实现；验证：`rg` 确认启动函数内不再出现具体存储/沙箱构造
- [x] 2.3 保留启动清理与单写入者语义：旧运行库处理、`claimRuntimeOwnership`、关闭时释放所有权；验证：以存在旧库与既有所有权记录的临时数据根启动，断言行为与现状一致
- [x] 2.4 服务配置不再由调用方拼接路径：桌面 supervisor 与 Node 入口都只提供数据根、工作区根与服务凭据；验证：桌面 `runtime-paths`/`runtime-supervisor` 定向测试通过

## 3. 契约不变性验证

- [x] 3.1 对外协议不变：HTTP 路由、`actiondriver.stream.v2` 事件顺序与游标恢复；验证：服务端 HTTP 与 `stream-session-service` 定向测试通过
- [x] 3.2 权限与工作区约束不变：服务凭据校验、未授权拒绝、工作区越界拒绝；验证：相关定向测试通过
- [x] 3.3 桌面监督行为不变：重启上限、就绪等待、关闭超时；验证：`runtime-supervisor` 定向测试通过

## 4. 文档同步

- [x] 4.1 更新 `analysis/cloud-runtime-preflight.md`：把存储装配结论改为 rollout 落地后的真实现状（`RuntimeRepositories` 已就位、装配仍内联），并指向本变更
- [x] 4.2 在 `docs/roadmap.md` 阶段 5 增加本变更与分析文档的索引，不新增未裁决范围

## 5. 提交前验证（提交动作的一部分）

- [x] 5.1 运行 `pnpm typecheck`、`pnpm lint`、`pnpm test` 并记录通过/失败数量与已知无关失败
- [x] 5.2 因涉及运行时启动与打包行为，追加 `pnpm test:e2e:local`（必要时 `pnpm test:e2e:packaged:macos`）
- [x] 5.3 提交只包含本变更文件，排除工作区中其他会话的改动（含未提交的 rollout 改动）；验证：`git status` 与提交 diff 复核

## 6. 范围说明（未裁决项不实施）

- [x] 6.1 不实现云端部署、远端存储、身份/多租户、调度与配额；需要时另开变更并先完成 Battle
- [x] 6.2 不改动 Linux/容器执行沙箱与运行时路径；`sandbox-execution` 既有规格保持不变
- [x] 6.3 不引入远端共享状态或粘性路由实现；仅在设计与文档中记录已知约束

## 提交前验证记录（2026-09-30，Node v20.14.0）

- `pnpm typecheck`：27 个工作区项目通过。
- `pnpm lint`：通过，含 152 条 E2E 交互声明验证。
- `pnpm test`：438 个测试文件中 429 通过、7 失败、2 跳过；2625 个测试中 2612 通过、11 失败、2 跳过。失败位于未修改的 `packages/sky`、`packages/cua`、`packages/browser-runtime`；日志显示第三方 ESM 加载错误，以及 Node v20.14.0 缺少 `URL.parse`、`Promise.withResolvers` 的兼容问题。
- `pnpm test:e2e:local`：7 通过、3 失败。Runtime 启动和两轮真实流会话通过；失败为 preload API 列表多出 `pluginContributions`、设置页生图接口控件缺失、图片预览元素缺失。失败测试与页面代码均不在本变更文件范围内，暂不归因于宿主拆分。
- 未追加 `pnpm test:e2e:packaged:macos`：Electron 包内使用的 `dist/index.js` 路径与打包配置未改，本地 E2E 已构建并运行该入口；新增的 `dist/node.js` 不参与桌面打包启动。
- 定向回归：11 个测试文件、111 个测试通过，覆盖 Electron/Node 宿主、存储所有权与失败清理、HTTP/WS、流会话、工作区约束、桌面监督。
