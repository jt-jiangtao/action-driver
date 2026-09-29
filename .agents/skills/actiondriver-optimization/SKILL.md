---
name: actiondriver-optimization
description: 分析并优化 ActionDriver 项目的性能、渲染、组件架构或进程边界。当用户说“优化项目”“优化性能”“优化架构”“代码优化”“重构一下”，或要求对 ActionDriver 做优化分析时使用。
---

# ActionDriver 优化

用户要求“优化这个项目”时用这份流程。核心是：先拿证据，再按面加载对应 skill，并把结论落进本仓库既有治理流程。

## 先分类

优化请求通常改变模块职责、公共接口或渲染契约，按 [AGENTS.md](../../../AGENTS.md) 属**决策型**：先完成 Battle（目标与成功标准、对现有假设的质疑、至少一个真实替代方案、风险与代价），用 `openspec-propose` / `openspec-update-change` 留痕，用户裁决后才动代码。只有完全落在已裁决范围内的机械改动（如把重复字面量收进常量、补一个 memo）才是执行型，可直接做。

判断依据与检查表见 [agent-battle-protocol.md](../../../docs/governance/agent-battle-protocol.md)。

## 按面加载 skill

| 优化的面 | skill | 本项目口径 |
| --- | --- | --- |
| 渲染层性能：`apps/desktop/src/renderer/src/**` | `vercel-react-best-practices` | 取 `rerender-*`、`rendering-*`、`js-*`、`client-*`、`bundle-*`。**不适用** `server-*`、`async-api-routes`、`async-suspense-boundaries`、`bundle-defer-third-party`（无 Next.js / RSC / 服务端 / Web 首屏水合）。客户端取数用 `@tanstack/react-query` 5，不是 SWR，逐条核对后再引用 |
| 组件 API 与状态归属：`components/**`、`di/**`、`models/**` | `vercel-composition-patterns` | 复合组件、状态提升与解耦、context 接口、布尔 props 泛滥；React 19.3 适用去 forwardRef 等条目 |
| 设计模式与抽象取舍：`packages/**`、`apps/agent-runtime/src/**` 的模块划分与依赖方向 | `software-best-design-patterns`（首选，含 When NOT to Use）、`gof-patterns`（模式查询）、`solidifier`（克制审查） | 本项目多用结果类型、可辨识联合与显式契约；单实现接口、包单构造函数的工厂、隐藏逻辑的间接层按缺陷处理。设计模式只在付得起维护成本时才引入，且不得改变已裁决的进程边界 |
| TypeScript 类型与契约设计：`packages/*-contracts/**`、共享 DTO、zod schema | `typescript-types`、`typescript-discriminated-unions`、`typescript-source-organization`、`typescript-tests` | 先看手写类型与 zod schema 双写、联合类型未判别、类型断言滥用；改类型必须保持 `pnpm --filter <pkg> typecheck` 与契约测试通过 |
| HTTP 服务层：`apps/agent-runtime/src/service/http/**`、`http-service.ts` | `hono` | 现有路由/中间件/错误映射分层已稳定：中间件顺序、`onError` 映射与请求策略不可在优化中悄悄改变；改动前用 Hono CLI 做请求级验证 |
| 主进程 / IPC / 进程边界：`apps/desktop/src/main/**`、`apps/desktop/src/preload/**` | `electron` | preload 暴露面收敛、IPC 通道校验、窗口与退出时的资源释放 |
| Runtime / 插件 / 数据所有权 / 权限：`apps/agent-runtime/**`、`packages/**` | `security-best-practices` | 与 Battle 的架构检查表配合判断职责位置与信任边界，而不是只做输入校验 |
| 数据层：`apps/agent-runtime/src/database.ts`、`persistence/**`、`repositories.ts` | `sqlite-best-practices` | better-sqlite3 是同步 API：pragma（WAL、`busy_timeout`）、索引与事务边界可按规则核对。schema 变更仍走 `database.ts` 既有的版本化迁移流程，不得用 skill 建议绕过；事务内不做 I/O，避免长事务阻塞事件循环 |
| 可观测性与遥测：`packages/observability/**`、OTel/Phoenix 接入点 | `otel-js`（Node 首选）、`otel-semantic-conventions`、`otel-telemetry-emissions`、`otel-sdk-versions`、`otel-browser`（渲染进程） | 项目已有 OTel + Phoenix：不要引入第二套 TracerProvider 初始化；保持 `traceparent` 透传与既有 span 命名，属性/事件名按 semantic-conventions 与 emission 字典核对，SDK 版本升级先查 `otel-sdk-versions` 兼容矩阵 |
| 先定位根因（行为不符、回归、profile 异常） | `systematic-debugging` | 禁止先改后猜；先复现、再收缩 |
| 写改动 | `test-driven-development`、`typescript-tests` | 先写会失败的定向测试；TS/TSX 测试设计、mock 与隔离按 `typescript-tests` 的口径 |
| 收尾声明与门禁 | `verification-before-completion`、`verification`、`verify-security`、`verify-quality`、`verify-patterns`、`verify-language` | 没跑过命令就不要声称通过；`verification` 套件（安全/质量/模式/语言）用来做提交前自查，但它**不能替代**本仓库要求的真实 `typecheck`/`lint`/`test` 输出 |

已评审、按需再装（当前未安装）：`uiverify`（Playwright/Vitest 视觉回归）、`react-frontend-skills`（React 19 前端架构，与已装的 vercel 两件套重叠）、`apple-design-skill`（Apple HIG 界面评审，本项目用 antd/Radix，收益有限）。`ollygarden` 还有 collector/OTTl/Go/Python 等 13 个 skill 未装，涉及 collector 配置时再补。本表只写已安装的 skill，避免加载失败。

## 本仓库硬约束（非显然）

- 迭代期只跑与改动直接相关的定向测试（`pnpm vitest run <file>`、`pnpm typecheck`）。`pnpm test`、`pnpm lint`、e2e 全量属于**提交动作**，未准备提交时不得运行。
- 测试归属：包内逻辑测试放该包自己的 `tests/`；根 `tests/` 只放根级脚本与跨包边界测试，判定见 [test-placement.md](../../../docs/testing/test-placement.md)。
- 同一工作区可能有多条会话并发写入：动手前确认目标文件近期没被其他会话改过；提交只暂存本变更文件。
- 优化结论必须有测量：渲染计数、基准、profile、包体积或日志数据，以及“行为不变”的等价性断言。没有证据的“更快”不算结论。

## 交付形态

分析按这个顺序给出：现象与测量证据 → 候选改法（至少两个，含被否决方案的代价）→ 收益/成本/风险排序 → 建议先做哪一项及理由。不要交付泛泛的最佳实践清单。
