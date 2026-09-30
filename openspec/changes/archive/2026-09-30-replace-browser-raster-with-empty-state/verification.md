## 验证记录（2026-09-30）

- TDD 定向测试：修改测试后首次运行 `pnpm vitest run apps/desktop/tests/unit/renderer/src/components/BrowserPanel.test.tsx`，旧实现因分栏缺少“开始浏览”而失败（1 失败、10 通过）；实现后再次运行，11/11 通过。
- 相关单元测试：`pnpm vitest run` 指定 BrowserPanel、MockTaskCatalog 和 pages 三个测试文件，45/45 通过。pages 中仍有 Ant Design `rootClassName` 弃用警告，与本变更无关。
- 构建：`pnpm --filter @action-driver/desktop build` 与 `build:visual` 均通过。渲染产物目录约 7,424 KiB，不再包含 `hotel-search` 图片；被删除源图片为 1,823,683 字节。
- 视觉 E2E：`pnpm exec playwright test apps/desktop/tests/e2e/app.spec.ts --update-snapshots` 的首页及任务页用例通过，更新了 `task-split-1440x900.png` 基准；放大和折叠布局及控制状态在同一用例中通过。设置页用例因既有 `getByText('失败')` 匹配 7 个元素而失败；最小窗口用例被全局 `afterAll` 视觉契约汇总断言连带标为失败。初次运行还因已有开发应用占用同一 Electron 用户数据目录而崩溃，已将此视觉测试的用户数据改为独立临时目录，重新运行后任务页用例通过。
- 提交门禁：`pnpm typecheck` 通过；`pnpm lint` 通过，校验 152 项交互声明；`pnpm test` 首次一次性运行：2515 通过、129 失败、2 跳过。失败输出大量指向现有 `better-sqlite3` 原生模块按 ABI 137 编译，而测试 Node 20.14.0 需要 ABI 115。随后使用 `corepack pnpm rebuild better-sqlite3` 恢复 Node 绑定，并定向复跑原失败的两个数据库测试文件，6/6 通过；依据仓库“同一提交不得重复运行全量验证”规则未再次运行 `pnpm test`，所以不宣称全量测试通过。
- `openspec validate replace-browser-raster-with-empty-state --strict` 与 `git diff --check` 通过。提交只包含本变更；并行产生的 `openspec/changes/verify-token-plan-image-endpoints/` 不纳入提交。
