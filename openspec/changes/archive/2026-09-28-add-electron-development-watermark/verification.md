# 验证与交付记录

- Electron 本地提交：593df43ccabaf6ae642534c249cce0423ccb21c2；直属源码和独立构建检出均干净且提交一致。
- 原生策略/AppKit：4/4 通过，覆盖开发默认、其他自有构建参数、宏关闭、绘制、事件穿透、缩放与弱引用释放。
- 自有 Electron 增量构建：363/363 通过；提交同步后的 GN/Ninja 刷新通过。宏关闭的 ElectronNSWindow 实际编译命令定向语法编译通过。未构建完整宏关闭或官方配置二进制。
- 实际 Electron 验收：点击、输入、滚动、导航、内容视图替换、缩放、全屏通过；浅色、深色及实际 ActionDriver 原生窗口截图已检查。
- 匹配的新 bundle 与来源记录已导出激活；运行路径为 thridparty/build/electron/Electron.app/Contents/MacOS/Electron。旧匹配对保留在 thridparty/build/electron/backup-ojeWUo3HhPBp。
- 共享来源/启动/导出测试：23/23 通过；导出格式整理及去除未提交 bootstrap 模块依赖后，回滚/并发测试再次 4/4 通过，定向 eslint 通过。
- 独立最终审查：未发现阻止提交的重要缺陷；审查未重复完整构建，未独立复验原生截图。

## 一次提交前全量关口（2026-09-28）

- pnpm typecheck：通过。
- pnpm lint：失败 1 项，scripts/lib/browser-forks/runner.test.mjs 的 no-empty；该文件属于未交付 bootstrap，未纳入本次提交。
- pnpm test：1228 通过、4 失败、2 跳过。失败为三个 CUA runtime 用例及 SettingsPage 独立测试状态用例；本次未修改这些文件。
- pnpm test:e2e:local：5 通过、3 失败、1 跳过。失败为 Computer Use helper ENGINE_UNAVAILABLE、Token Plan 图片接口控件缺失、宽图预览控件缺失，均不属于原生水印修改范围。
- 自有桌面宿主定向 E2E：1/1 通过，确认实际宿主路径、版本、Renderer 认证及 utility process SQLite。
- 首次 macOS 打包验证在复制运行时阶段失败：Agent 并行运行本地与打包构建，共享输出被重新生成，ditto 遇到文件消失。此为验证调度错误。停止并行构建后，仅恢复打包阶段（保留日志），不重复全量 typecheck/lint/test/local。

日志位于忽略目录 thridparty/logs/watermark-precommit，截图位于 thridparty/build/verification/watermark；二进制和测试产物不进入 Git。

## 交付边界

用户明确要求本地提交与归档；全量关口已执行，失败按范围公开，不将无关修复混入本任务。原生水印相关定向检查必须通过，打包恢复结果追加在下方。主仓库保留其他并行任务的未提交改动；不合并、不推送。Electron 及 Playwright 的自有提交尚未确认可从远端拉取，当前是本地检查点，不宣称新机器递归 clone 已可复现。

- 打包阶段恢复：1/1 通过，实际 packaged 宿主路径、版本、架构、来源记录及 Renderer/Runtime 认证已核验；packaged-actiondriver.png 原生窗口截图已视觉检查，水印清晰可见。恢复脚本仅作为本地诊断产物，不提交。
