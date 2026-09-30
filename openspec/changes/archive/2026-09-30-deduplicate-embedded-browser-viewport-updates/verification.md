# 验证记录

- 测试先行：`embedded-host.test.ts` 新断言在旧实现上失败，重复视口后 `setBounds` 实际 2 次、期望 1 次；页签生命周期断言在旧实现上通过。
- 实施后：`corepack pnpm vitest run apps/desktop/tests/unit/main/browser-session/embedded-host.test.ts`，4/4 通过。
- 边界定向验证：`corepack pnpm vitest run apps/desktop/tests/unit/main/browser-session/manager.test.ts apps/desktop/tests/unit/renderer/src/components/BrowserPanel.test.tsx`，12/12 通过。
- `openspec validate deduplicate-embedded-browser-viewport-updates --strict` 通过；`git diff --check` 通过。
- 提交前完整验证（各一次）：`corepack pnpm typecheck` 通过；`corepack pnpm lint` 通过；`corepack pnpm test` 为 2643 通过、15 失败、2 跳过（443 个文件中 433 通过、8 失败、2 跳过）。
- 完整测试的 15 个失败均位于本变更未修改的测试文件：`apps/local-runtime/tests/unit/database.test.ts`（并行迁移版本修改），以及 `packages/cua`、`packages/browser-runtime`、`packages/sky` 的测试。工作区其他会话仍有未提交修改；本变更不改动或暂存它们。
- 此次计数证明相同视口请求的原生视图方法调用减少；没有运行时 IPC 频率或帧率数据，因此不声明端到端性能收益。
