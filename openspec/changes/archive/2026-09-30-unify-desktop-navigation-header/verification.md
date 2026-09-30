# 验证记录

- `pnpm vitest run apps/desktop/tests/unit/renderer/src/App.test.tsx apps/desktop/tests/unit/renderer/src/App.streaming.test.tsx apps/desktop/tests/unit/renderer/src/models/app-navigation-history.test.ts apps/desktop/tests/unit/renderer/src/pages/AgentSettingsPages.test.tsx`：4 个文件、52 个测试通过；仅有既有 Ant Design `Image.rootClassName` 弃用警告。
- `pnpm --filter @action-driver/desktop typecheck`：通过。
- `pnpm validate:e2e-interactions`：154 项交互声明校验通过。
- `pnpm exec eslint`（本次受影响的 TypeScript 与 TSX 文件）：通过。
- `pnpm --filter @action-driver/desktop build:visual`：通过。
- `pnpm exec playwright test apps/desktop/tests/e2e/sidebar-collapse.spec.ts -g 'keeps application controls fixed'`：1 个定向 E2E 通过；验证 1440×900 与 1024×700、顶部三列和设置页同色、折叠与切页坐标、浏览器内容视口及拖拽区。
- `openspec validate unify-desktop-navigation-header --strict` 与 `git diff --check`：通过。

原生 Electron 定向测试曾尝试启动，但当前环境中测试进程未创建窗口；上述坐标检查改由同一视觉构建产物在 Chromium 中运行。其他未提交规划文件未纳入本次改动。

## 截图反馈后的紧凑顶栏复验

- 用户要求缩短过高的顶部、缩小按钮并让 macOS 红黄绿按钮对齐；共享高度改为 44px，应用导航按钮改为 28px、中心 y=22。旧 Electron fork 的 Cocoa 布局在 macOS 27 上查找两层父视图得到空值，导致原生位置参数无效。修复后，用户截图显示 y=17 比箭头低约 2px；最终将边距设为 y=15，14px 高原生按钮的中心因此为 y=22。屏幕共享标识遮挡了最终截图中的原生按钮，最终位置依据原生几何计算和用户对前一版的可见反馈确认。
- `corepack pnpm vitest run apps/desktop/tests/unit/main/window-options.test.ts`：旧版本曾 1/1 通过；最终 y=15 修改后，按用户要求不再运行单元测试。
- `corepack pnpm --filter @action-driver/desktop typecheck` 与 `build:visual`：通过。
- `corepack pnpm exec playwright test apps/desktop/tests/e2e/sidebar-collapse.spec.ts -g 'keeps application controls fixed'`：1/1 通过；测得导航按钮 28×28、中心 y=22，各页面顶部为 44px，折叠和切页坐标保持一致。
- 原生 Electron fork `91695a0efd441d88059db5211c45be23b7a0f060` 编译通过：`ninja -C out/Action-Driver -j8 electron`；`node scripts/export-electron-fork.mjs` 通过，更新源提交、锁文件与本地导出记录。原生窗口实际运行并收到用户截图反馈；旧版嵌套标题栏路径保留。

## 提交前检查

- 此前按仓库提交流程执行一次全量 `pnpm typecheck`、`pnpm lint`：均通过。
- 同一轮执行一次全量 `pnpm test`：2673 通过、17 失败、2 跳过，共 450 个文件；失败集中在当前 Node 20 环境缺少 `Promise.withResolvers`、`URL.parse` 及既有 SQLite migration 版本差异等，与本次顶栏和原生按钮改动无关。按仓库“同一提交不得重复运行全量验证”要求没有重跑；用户随后明确要求不再运行单元测试并直接提交归档。
