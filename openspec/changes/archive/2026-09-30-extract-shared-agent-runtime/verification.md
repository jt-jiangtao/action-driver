## 提交前验证（2026-09-30）

执行环境：macOS arm64。全量门禁使用 Node 24.20.0；最初的本机 `better-sqlite3` 二进制按 Node 20 ABI 115 构建，Node 24 需要 ABI 137。

| 命令 | 结果 |
| --- | --- |
| `pnpm typecheck` | 29 个 workspace 项目通过。 |
| `pnpm lint` | 通过；152 项交互声明验证通过。 |
| `pnpm test` | 2513 通过、117 失败、2 跳过；失败由 Node 24 加载 ABI 115 的本机 `better-sqlite3` 二进制触发。按仓库规则未重复全量命令。 |
| `pnpm rebuild better-sqlite3`（Node 24） | 本机依赖重建通过；随后 `pnpm vitest run apps/local-runtime/tests/unit` 为 635 通过、1 跳过。原先失败的 rollout 与 storage 文件也单独复核通过（7/7）。 |
| `pnpm test:e2e:local` | 7 通过、3 失败。三项失败与更名提交 `ebe7fab2` 前的既有断言差异相同：preload API 键列表、Token Plan 设置控件、图片预览选择器；本次迁移的启动、会话与 Computer Use 用例通过。 |
| `pnpm test:e2e:packaged:macos` | 打包应用启动并认证 Renderer，1/1 通过；`local-runtime` 资源路径、辅助程序签名和捆绑运行时检查通过。 |

迭代期定向验证还包括共享包、供应商包、本地装配、资源 URI、模型网关、插件边界、桌面路径及构建；`apps/local-runtime` 与两个新包合计 738 通过、1 跳过。`git diff --cached --check` 通过。运行时缓存和本机原生模块已由新目录的 `.gitignore` 规则排除，未纳入提交。
