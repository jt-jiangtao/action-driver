# 验证记录

- `pnpm exec openspec validate verify-token-plan-image-endpoints --strict`：通过。
- Token Plan 相关定向 Vitest：6 个文件、86 个用例通过。
- 本地运行时重启场景定向 Playwright E2E：1 个用例通过。
- 提交前一次性执行 `pnpm typecheck`：通过；`pnpm lint`：通过。
- 提交前一次性执行 `pnpm test`：443 个测试文件中 433 通过、8 失败、2 跳过；2662 个用例中 2645 通过、15 失败、2 跳过。失败出现在未修改的 `packages/browser-runtime`、`packages/cua`、`packages/sky` 等测试中，包括当前 Node 环境缺少 `URL.parse`、第三方 Statsig SDK 的 ESM 加载错误和浏览器运行时断言差异；本次改动相关测试通过。
- 实现验证使用本地模拟响应，没有再次使用真实 API 密钥或产生真实生图请求。
