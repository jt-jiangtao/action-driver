# 验证记录

执行环境：2026-09-30，macOS arm64；使用 `/opt/homebrew/bin/node`（Node 24）与 `pnpm`，以匹配仓库内 `better-sqlite3` 原生模块 ABI。

## 结构与定向验证

- Contracts 根入口 54 个导出名称与变更前一致；16 个数据库迁移的版本、名称及 SQL 正文逐项一致。
- Contracts、数据库、Rollout、Graph、Stream Session、Desktop 各自定向测试及包类型检查通过；Desktop 服务、容器、页面定向测试为 27 个文件、209 个用例通过。
- `openspec validate reorganize-module-boundaries --strict` 通过；旧 Desktop 服务路径引用搜索与 `git diff --check` 通过。
- 独立静态审查未发现可操作的回归问题，重点检查了流事件顺序、Rollout 单一状态所有者、Graph 工具依赖及 Desktop 引用。

## 提交前全量验证

| 命令 | 结果 |
| --- | --- |
| `pnpm typecheck` | 通过，29 个 workspace 项目。 |
| `pnpm lint` | 通过，含 152 项端到端交互声明验证。 |
| `pnpm test` | 439 个测试文件通过、2 个跳过；2634 个用例通过、2 个跳过；0 失败。 |
| `pnpm test:e2e:local` | 构建通过；10 个用例中 7 通过、3 失败。 |
| `pnpm test:e2e:packaged:macos` | 打包、隔离安装及启动验证通过；1 个用例通过。 |

`test:e2e:local` 的三个失败位于未改动的 `apps/desktop/tests/e2e/local-runtime.spec.ts`：

1. preload 键名断言未列出 `pluginContributions`；该 API 已存在于变更前的 `desktop-api.ts`。
2. Token Plan 设置用例定位名为 `wan2.7-image 生图接口` 的 combobox；失败现场仅有该模型行及测试/启用控件。设置页面源码与 E2E 用例在本变更中均未修改，搬迁的模型服务主体仅调整导入路径。
3. 图片预览用例定位 `.image-preview img[alt="wide-image.png"]`；失败现场显示预览 dialog 及操作控件，但没有匹配的 img。图片预览组件与 E2E 用例在本变更中均未修改，失败发生在发送或恢复会话前。

以上失配未在本次结构重构中改写产品行为或扩展 E2E 用例范围。全量验证命令按仓库要求只运行一次；失败原因通过 Playwright 错误现场、`HEAD` 源码和本次差异核对。
