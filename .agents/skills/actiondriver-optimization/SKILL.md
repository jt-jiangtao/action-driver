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
| 主进程 / IPC / 进程边界：`apps/desktop/src/main/**`、`apps/desktop/src/preload/**` | `electron` | preload 暴露面收敛、IPC 通道校验、窗口与退出时的资源释放 |
| Runtime / 插件 / 数据所有权 / 权限：`apps/agent-runtime/**`、`packages/**` | `security-best-practices` | 与 Battle 的架构检查表配合判断职责位置与信任边界，而不是只做输入校验 |
| 先定位根因（行为不符、回归、profile 异常） | `systematic-debugging` | 禁止先改后猜；先复现、再收缩 |
| 写改动与收尾声明 | `test-driven-development`、`verification-before-completion` | 先写会失败的定向测试；没跑过命令就不要声称通过 |

## 本仓库硬约束（非显然）

- 迭代期只跑与改动直接相关的定向测试（`pnpm vitest run <file>`、`pnpm typecheck`）。`pnpm test`、`pnpm lint`、e2e 全量属于**提交动作**，未准备提交时不得运行。
- 测试归属：包内逻辑测试放该包自己的 `tests/`；根 `tests/` 只放根级脚本与跨包边界测试，判定见 [test-placement.md](../../../docs/testing/test-placement.md)。
- 同一工作区可能有多条会话并发写入：动手前确认目标文件近期没被其他会话改过；提交只暂存本变更文件。
- 优化结论必须有测量：渲染计数、基准、profile、包体积或日志数据，以及“行为不变”的等价性断言。没有证据的“更快”不算结论。

## 交付形态

分析按这个顺序给出：现象与测量证据 → 候选改法（至少两个，含被否决方案的代价）→ 收益/成本/风险排序 → 建议先做哪一项及理由。不要交付泛泛的最佳实践清单。
