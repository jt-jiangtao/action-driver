## 1. 来源与解析

- [x] 1.1 审查书面设计后形成 Superpowers 执行计划并确认执行方式；交付具体文件、测试和顺序。
- [x] 1.2 建立可跟踪的 Electron 构建来源与产物记录、共享解析器；用有效产物、缺失、篡改、版本和架构不匹配定向测试验证，并确认不回退。

## 2. 本地入口

- [x] 2.1 接入 desktop dev/preview 启动包装脚本；验证 electron-vite 收到自有路径、参数和退出状态正常，实际产品主进程报告自有 process.execPath。
- [x] 2.2 所有本地 Electron E2E 使用共享解析入口；静态审查无遗漏，通过定向桌面启动测试证明使用自有宿主且安全桥接可用。
- [x] 2.3 在自有 Electron 的 utility process 验证 SQLite 模块加载与读写，必要时走现有 ABI 构建链；证明 pnpm Node binding 未被覆盖。

## 3. 打包

- [ ] 3.1 修改 macOS 包制作来源并携带构建记录；验证自有 bundle 被复制、路径重命名和签名检查仍通过，包内实际版本和来源一致。
- [x] 3.2 更新复现文档、缺失产物准备提示与平台限制；审查标准开发、预览、测试及打包命令均可复现，不宣称未运行平台通过。

## 4. 验收与交付

- [x] 4.3 修复本地旧内置插件缓存导致的启动失败：备份并重建受影响版本目录，保留数据库与插件私有数据；保留 runtime.failed 原因、捕获主进程启动与自动重启失败，并定向验证。

### 4.3 定向验证记录（2026-09-28）

- 执行型修复：保持既有进程边界与重启次数；不修改插件版本或全局同版本发布语义，遵循 preserve-dotted-tool-names 的已裁决开发方案。
- 原因：五个内置插件版本未变化，本机 installed 缓存仍含旧下划线名称代码，但 current manifest 已使用点分隔名称，导致 `PROTOCOL_ERROR: Undeclared contribution tools.local.command.shell.run`。
- 数据副本复现退出码 1；移走副本中过期版本目录后 ready、退出码 0。allocator 提示在健康进程中仍出现，不是此次退出根因。
- 本机五个版本目录移至 `~/Library/Application Support/ActionDriver/data/plugins/cache-backups/20260928-011432`；数据库及插件私有 data 保留，正常启动重新生成缓存。
- TDD：定向测试先观察到原因丢失和未捕获拒绝；修复后 `pnpm exec vitest run apps/desktop/src/main/runtime-supervisor.test.ts` 12/12，通过且无未捕获拒绝。
- `pnpm --filter @actiondriver/desktop typecheck`、桌面 electron-vite build 通过；`pnpm exec playwright test apps/desktop/e2e/electron-fork-runtime.spec.ts` 1/1 通过。
- 真实原有用户数据启动：窗口创建成功，认证 Runtime HTTP 请求返回 200，五个版本目录已重新生成。
- 本次未提交，不执行全量测试；其他并行任务改动保留。

- [ ] 4.1 提交前一次运行 typecheck、lint、test，并追加 local 与 packaged macOS E2E；记录数量、来源断言和已知基线失败，迭代期仅定向验证。
- [ ] 4.2 运行 OpenSpec strict、差异校验与适用代码审查；只提交本次替换及规划，不混入基线旧改动和 docs/explorations，验收完成后归档。
