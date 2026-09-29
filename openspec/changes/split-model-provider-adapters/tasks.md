## 1. 公共失败规则

- [x] 1.1 固定两个协议的失败分类、超时和凭据脱敏断言；运行 `pnpm vitest run apps/agent-runtime/tests/unit/provider-adapters.test.ts`。
- [x] 1.2 抽取共享 HTTP 失败映射、响应分类、重试判断及脱敏工具；运行适配器定向测试。

## 2. 协议模块

- [x] 2.1 移出 OpenAI 兼容实现及 SDK 专属错误映射，保留流式 tool call 聚合与图像转换；运行适配器定向测试。
- [x] 2.2 移出 Anthropic 实现，保留公共 façade、工厂与类型导出；运行适配器定向测试及 TypeScript 检查。

## 验证记录

- 拆分结果：`provider-adapters.ts` 814 行 → façade 43 行；新增 `provider-types.ts`（类型与常量）、`provider-failures.ts`（响应分类、重试判断、凭据脱敏）、`provider-http.ts`（HTTP 发送与完成失败封装）、`openai-compatible-adapter.ts`、`anthropic-adapter.ts`。公共导出集合不变，`service.ts`、`capability-probes.ts` 无需迁移。
- 定向测试：新增 5 项跨协议一致性断言（401/429/503/404/422 的失败码与凭据脱敏在两个协议上一致）。`pnpm vitest run apps/agent-runtime/tests/unit/provider-adapters.test.ts` 37 项通过；连同 `model-connection-service`、`capability-probes`、`model-gateway`、`tests/unit/model-provider-boundary` 共 56 项通过。
- `pnpm typecheck` 通过（含 `apps/agent-runtime`、`packages/cua-repl` 等全部项目）。
- `pnpm lint` 仅报工作区既有未提交文件 `apps/desktop/src/renderer/src/main.tsx` 的未使用 `StrictMode` 导入（非本次改动，未纳入提交）；本次改动文件 ESLint 无错误。
- `pnpm test`：2477 项中 2464 通过、2 跳过、11 失败，失败全部位于未改动的 `packages/cua`、`packages/sky`、`packages/browser-runtime`（Node 20.14 无 `URL.parse`，既有环境失败；`git status` 确认这些路径无改动）。
