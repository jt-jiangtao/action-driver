# 无用代码与依赖审计（2026-09-24）

## 入口与核对方式

以 `apps/desktop/electron.vite.config.ts` 的 Main、Preload、Renderer 入口，`apps/agent-runtime/package.json` 的 `src/runtime-entry.ts`，各包 `exports`/`src/index.ts`，根目录构建脚本、测试和 `design/figma-component-audit.md` 为根。对候选用 `rg` 搜索静态导入、文件名字符串、动态导入与配置引用；删除后再跑类型检查、Lint、生产构建和打包冒烟。测试引用不等于生产可达，设计验收引用也不应误删。

| 候选 | 可达性与用途 | 结论 |
| --- | --- | --- |
| Runtime `langsmith-observability.ts` 与直接 `langsmith` 依赖 | 旧生产装配曾使用；已由 Phoenix 替换 | 删除主动接入与直接依赖 |
| Runtime `model-log-projection.ts` 的模型日志部分、`modelCalls` 仓储 | 无生产读取方；旧 UI 不再装配 | 删除新写入与读取，保留任务投影 |
| SQLite `model_calls` 表与索引 | 历史用户数据，v3 迁移建立 | 保留，不清空历史行 |
| Desktop `langsmith-detail-view`、模型日志服务/模型/Mock | 仅旧测试相互引用，无 Main、Preload、Renderer 入口 | 删除源码和专属测试 |
| Desktop `logs-ipc`、`log-ipc-contract`、接口日志服务/模型 | 仅旧测试和死链引用，无生产 `registerLogIpcHandlers` 调用 | 删除源码和专属测试 |
| `packages/contracts` 模型日志 DTO | 仅旧模型日志链引用 | 删除 |
| `packages/observability` Pino logger、文件日志读写、旧本地 interaction store | 生产使用 OTel `createProcessObservability`；旧实现只由死链或测试引用 | 删除并清理直接依赖 |
| `MemoryInteractionLogStore` 与详情/分页类型 | 当前 6 组网关、HTTP、WebSocket、工具及性能行为测试使用；生产 recorder 不注入 store | 暂保留为测试基础设施，生产装配无存储分支；后续可在重构这些测试时移入测试目录 |
| `@langchain/core` → `langsmith` | LangGraph 图编排与 SQLite checkpoint 的间接依赖 | 用户裁决保留惰性依赖，Runtime 关闭自动追踪开关 |
| Main 旧模型连接 JSON 迁移 | `src/main/index.ts` 启动时仍调用，成功后删除旧文件 | 保留 |
| `ExecutionTimeline`、`Checkbox`、`RadioOption`、`TextField` | 当前 Figma 组件审计与行为测试使用 | 保留 |
| Renderer `styles/tokens.css` | `main.tsx` 生产入口直接加载 | 保留 |
| Runtime/Renderer Mock 与视觉 E2E 夹具 | 测试、设计验收或开发模式仍使用 | 保留可核实的夹具 |

## 二次核对

删除项应无生产导入；`rg`、类型检查、Lint、Runtime/Desktop build 和打包冒烟作为最终证据。`pnpm-lock.yaml` 中的 LangSmith 属于 LangGraph 间接依赖，不能以锁文件字符串为删除条件。
