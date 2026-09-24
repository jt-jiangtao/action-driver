## 1. Phoenix 模型追踪接线

- [x] 1.1 在 Runtime 内抽出独立的模型追踪端口与数据类型，使网关和 Phoenix 适配器不再依赖 LangSmith 文件；用模型网关及 Phoenix 适配器测试验证成功、流式终态、失败和凭据过滤。
- [x] 1.2 将 Phoenix 适配器接到 Runtime 的现有 OTel tracer，验证真实模型调用产生带会话、任务、请求和关联标识的模型 span，并与上层调用共享 trace ID。
- [x] 1.3 用受控采集器故障测试证明追踪失败不改变模型执行结果；用本地 Alloy/Phoenix/Tempo/Loki 带唯一标记的集成验收证明 Phoenix 有原文、Tempo/Loki 无原文与凭据。

## 2. LangSmith 与旧模型日志退役

- [x] 2.1 删除 ActionDriver 对 LangSmith 的直接依赖、适配器、环境配置、测试和未装配的 Electron 详情/Renderer 列表路径；保留 LangGraph 间接惰性 SDK，显式关闭继承的 LangChain/LangSmith 自动追踪环境开关，并用行为测试、类型检查和生产构建验证无 LangSmith 出站。
- [x] 2.2 移除未被生产读取的模型日志 DTO、查询/投影与 `model_calls` 新写入路径，保留既有 SQLite 表和历史行；用旧库夹具验证升级启动后历史数据仍在且新任务正常完成。
- [x] 2.3 清理旧日志 IPC、本地日志读取/存储与对应测试，只保留正在使用的 OTel 运行摘要；用 Main/Runtime 日志测试验证无本机新增日志文件和无旧读取接口。

## 3. 全仓无用代码与依赖审计

- [x] 3.1 建立从 Electron 三入口、Runtime 入口、包公开入口、构建脚本和测试/设计验收入口出发的引用清单，逐项记录零生产引用候选、动态引用及保留理由；用二次引用搜索复核每个删除项。
- [x] 3.2 删除已证实不参与生产或有效验收的模块、冗余包导出和三方依赖；保留仍执行的旧模型连接迁移与有明确用途的 Mock/视觉夹具；用 `corepack pnpm typecheck`、Lint 和包构建验证依赖闭包。

## 4. 规范、文档与全量验收

- [x] 4.1 将当前主规范和运维文档更新为 Phoenix 事实来源，处理被取代的 `use-langsmith-model-logs` 变更，保留归档历史；用 OpenSpec 严格验证和全局引用搜索确认当前文档无相反指引。
- [ ] 4.2 运行 `corepack pnpm check:all`、Runtime 并发/重启相关测试和 `corepack pnpm test:e2e:packaged:macos`；核对本地 Phoenix 模型原文、Tempo/Loki 脱敏、平台停机时任务继续执行，并记录任何外部环境限制。
