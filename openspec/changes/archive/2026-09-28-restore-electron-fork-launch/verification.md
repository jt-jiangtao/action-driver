## 验证记录

- 根因：旧开发进程运行 `node_modules/electron/dist/Electron.app`；当前分支的 `dev` 脚本直接调用 `electron-vite dev`，未选择已有 Fork。
- `node --test scripts/lib/electron-fork.test.mjs`：14/14 通过；本机真实来源记录与 Fork 产物校验通过。
- `node --test scripts/lib/desktop-electron-launch.test.mjs`：5/5 通过。
- `node --test scripts/lib/export-electron-fork.test.mjs`：4/4 通过。
- `node --test scripts/lib/packaged-electron-host.test.mjs`：1/1 通过；验证复制后可执行文件哈希与包内来源记录。
- `node --test thirdparty/electron/action-driver/watermark/native.test.mjs`：4/4 通过。
- `pnpm exec playwright test apps/desktop/e2e/electron-fork-runtime.spec.ts --timeout=20000`：1/1 通过；原生窗口截图 `thirdparty/build/verification/watermark/development-action-driver.png` 显示实际首页与平铺水印。
- 当前开发主进程 PID 6671 的路径为 `thirdparty/build/electron/Electron.app/Contents/MacOS/Electron`。
- `pnpm lint`：通过，149 条交互声明通过校验。
- `pnpm typecheck`：首次全量运行发现本次新增 E2E 的两处类型错误；修正后 `pnpm --filter @action-driver/desktop typecheck` 通过。按仓库规则未重复全量运行。
- `pnpm test`：389 个测试文件通过、13 个失败、2 个跳过；2349 个测试通过、29 个失败、2 个跳过。失败集中在当前工作区其他未提交的 Runtime、浏览器与 UI 变更，水印修复的定向测试均通过。
- `pnpm test:e2e:packaged:macos`：Fork 校验、宿主复制与 Computer Use Helper 签名检查通过；随后 JS Runtime 探针因缺少 `dist/resources/browser-documentation.json` 失败，未进入完整 packaged Playwright 验证。该资源属于并行 Runtime 改动；未扩大本次修复范围。

## 提交边界

工作区包含其他任务的大量未提交改动。提交只选取本变更的启动、校验、打包宿主、相关 E2E、文档及 OpenSpec 文件；其他改动保留在工作区。
