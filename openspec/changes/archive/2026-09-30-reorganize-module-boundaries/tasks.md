## 1. 契约与迁移入口

- [x] 1.1 按消息、任务、Skill、会话服务拆分 `packages/contracts/src/index.ts`，保留全部既有根导出；以导出清单比对和 `pnpm vitest run packages/contracts/tests/unit/contracts.test.ts` 验证。
- [x] 1.2 将数据库 1–16 号迁移定义原样移入 `apps/local-runtime/src/database/migrations/`，保持 `database.ts` 打开与执行入口；以版本/名称/SQL 比对及数据库迁移定向测试验证。

## 2. 本地会话持久化

- [x] 2.1 在 `rollout/` 下拆分读取逻辑，仍由 `RolloutSessionStore` 持有请求、日志和投影状态；以 `rollout/session-store.test.ts` 的快照、重开和投影重建用例验证。
- [x] 2.2 拆分写入和中断恢复逻辑，所有追加经过 store 的唯一入口；以 `rollout/session-store.test.ts` 和 `stream-session-service.test.ts` 的顺序、水位、恢复幂等及工具不重跑用例验证。

## 3. Agent Runtime

- [x] 3.1 将 Graph 状态、工具调用节点和纯辅助函数整理到 `graph/`，runner 保留生命周期与既有入口；以 Graph、Computer Use 定向测试和导出检查验证。
- [x] 3.2 将 Stream Session 的历史组装、请求创建、轮次执行分离，service 统一管理活动请求和事件交付；以幂等、取消、快照/重连、事件顺序的定向测试验证。

## 4. Desktop renderer

- [x] 4.1 按实际功能归组会话、模型连接、Agent 文件、任务目录、Skill、插件与共享传输服务，并将 mock 与实现同组；以服务、容器、页面定向测试和旧路径引用检查验证。

## 5. 最终验证与交付

- [x] 5.1 检查六项改动、公共导出、迁移清单和工作区边界，确认仅本任务文件待提交；以差异审查和相关定向测试验证。
- [x] 5.2 准备提交时各运行一次 `pnpm typecheck`、`pnpm lint`、`pnpm test`，记录通过/失败/跳过数量及已知无关失败。
- [x] 5.3 对运行时和 Desktop 打包行为运行适用的 `pnpm test:e2e:local`、`pnpm test:e2e:packaged:macos`，记录结果或环境限制。
- [x] 5.4 归档 OpenSpec change，仅提交本任务代码、测试、计划与归档记录；以归档状态、`git status` 和提交内容核查验证。
