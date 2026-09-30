# Tool Runtime / Sandbox 验证记录

验证日期：2026-09-23。所有数据均为去凭据的结果摘要；未保存 API Key、请求头或真实模型的完整请求/响应。

- `corepack pnpm typecheck`、`corepack pnpm lint`、`corepack pnpm test`、`corepack pnpm build`：通过；单测 109 个文件、586 个用例通过。
- `corepack pnpm exec playwright test apps/desktop/e2e/tool-runtime.spec.ts`：6 个用例通过。覆盖真实页面经 WebSocket 的文件读取、模型第二轮回答、重载后任务与双层日志恢复、Shell 一次性审批、拒绝、取消、超时与断线重连。超时用例使用工作区内的 POSIX 命名管道，无网络或写入工具执行。
- `corepack pnpm exec playwright test apps/desktop/e2e/local-runtime.spec.ts apps/desktop/e2e/tool-runtime.spec.ts`：7 个用例通过；额外确认同一会话连续两轮真实文本流与聚合模型日志无回归。
- `ACTION_DRIVER_REAL_SMOKE_PROFILE=<本地已保存配置> corepack pnpm exec playwright test apps/desktop/e2e/real-tool-smoke.spec.ts`：1 个用例通过。测试从本机已保存的“千问模型网关 / qwen3.7-max”复制隔离配置，真实上游返回 `sandbox_fs_read` 调用；沙箱读取测试工作区 README，模型继续生成包含测试标记的最终文本。持久化结果包含成功的 `sandbox.fs.read` 接口日志和至少两轮模型日志。隔离配置在用例结束后删除，原配置未修改。
- 未执行 Figma 校验，遵照用户的既定要求。

安全边界：当前 Sandbox 是工作区路径、命令/参数白名单、环境变量和资源上限约束，不是操作系统级容器隔离。
