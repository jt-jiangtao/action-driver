# Runtime 启动失败修复记录

- 分类：执行型；恢复已批准的本地 Runtime 启动，保持进程边界、插件版本与三次重启策略。
- 原因：内置插件缓存中的旧代码使用下划线工具名称，新 manifest 使用点分隔名称，触发 Undeclared contribution。五个版本目录已备份后重建，数据库和插件私有数据保留。
- 修改：保留 runtime.failed 原因；捕获自动重启的 readiness Promise；捕获主进程启动失败并正常关闭应用。
- 数据副本重现退出码 1，缓存修复后 ready / 退出码 0；真实用户数据窗口启动、Runtime HTTP 200。allocator 提示在健康启动中仍出现，未将其认定为退出原因。
- 备份：~/Library/Application Support/ActionDriver/data/plugins/cache-backups/20260928-011432。

## 提交前验证（2026-09-28，仅运行一次全量关口）

- pnpm typecheck：通过。
- pnpm lint：通过，146 项交互声明有效。
- pnpm test：1229 通过、3 失败、2 跳过；197 文件通过、1 失败、2 跳过。失败均在 apps/agent-runtime/src/computer-use/cua-runtime.test.ts，涉及工具查找 undefined.executor 与应用授权等待超时；这些测试不加载修改的 Electron supervisor。
- pnpm test:e2e:local：6 通过、2 失败、1 跳过。失败为设置中 Token Plan 图片 API 持久化与宽图片恢复展示；同样问题在此前 Electron 替换验证中已出现，窗口与 Runtime HTTP 测试通过。
- 修复对应 runtime-supervisor.test.ts：12/12 通过，全量运行无该文件错误；此前 TDD 已观察具体原因丢失与未捕获拒绝。
- 自编译 Electron 定向 E2E：1/1 通过，验证真实宿主、Runtime 认证与 SQLite 读写。
- 本次没有打包配置修改；不重复打包验收。已确认桌面定向 typecheck、构建、OpenSpec strict 与差异检查通过。
- 仅提交三个桌面代码／测试文件及本记录，不提交其他并行修改、Fork 指针、构建链路或替换入口文件。
