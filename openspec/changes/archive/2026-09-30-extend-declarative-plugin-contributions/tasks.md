## 1. 契约与发现

- [x] 1.1 扩展 `packages/plugin-contracts` 的 view/menu 声明、引用和版本校验；用定向测试证明六类 catalog 可在不激活插件时读取，缺失命令引用被拒绝。
- [x] 1.2 扩展 `packages/plugin-sdk` 与创建插件脚手架的视图、菜单接口和示例；用包级定向测试验证生成插件构建及旧插件继续加载。

## 2. 宿主生命周期

- [x] 2.1 扩展 Runtime 插件管理器的六类贡献原子发布、冲突诊断和所有权投影；用定向测试验证重复 ID、部分激活失败及迟到旧实例消息。
- [x] 2.2 为视图和菜单建立停用、升级、卸载与宿主崩溃撤销路径；用定向测试验证入口移除、在途调用归属和资源释放。

## 3. 桌面集成

- [x] 3.1 在 Desktop 中按声明容器呈现插件视图并复用受控消息桥；用界面定向测试验证打开、关闭及原始 Electron/DOM 注入被拒绝。
- [x] 3.2 将菜单项绑定声明命令与第一项上下文键结果，执行时再次检查条件和 grants；用定向测试验证状态变化后菜单与直接调用一致。
- [x] 3.3 以内置及第三方样例验收六类贡献的发现、按需激活和旧协议兼容；用定向集成测试与协议版本检查记录结果。

## 验证记录

- 契约：`packages/plugin-contracts/src/index.ts` 新增 `view`/`menu` 贡献种类、`viewDefinitionSchema`/`menuDefinitionSchema`、`PLUGIN_UI_PROTOCOL_VERSION = 2`、`ValidatedPluginCatalog` 与 `buildContributionCatalog`。菜单只绑定已声明命令，条件只写在命令贡献上（`when` 对 `menu` 显式拒绝），视图与菜单携带 `when` 走同一求值入口。
- 兼容门槛：声明 views/menus 的 manifest 在只提供协议 1 的宿主上抛 `INCOMPATIBLE` 并报出所需协议版本；未声明新字段的旧 manifest 保持可安装。`PluginManagerPorts` 新增可选 `uiProtocol`，Runtime 组合与 Desktop 宿主均声明 2。
- SDK/脚手架：`context.api.views.register`/`context.api.menus.register` 复用同一资源账本；生成插件新增 sidebar 视图、菜单与绑定命令，构建脚本用 `--loader:.html=copy` 复制视图入口。
- Runtime：`uiContributions()` 在未激活时也能列出已安装插件的视图与菜单（`available:false`），`openView()` 按需激活所有者并懒绑定 Desktop 宿主，`executeCommand()` 重算条件并由 `commandAuthority` 从持久任务解析 grants；停用后入口撤下。
- Desktop：`PluginPanelHost.openView` 只接受宿主声明支持的容器，未支持容器报 `UNAVAILABLE` 并带容器名，声明中的额外字段（如注入脚本）被严格 schema 拒绝；`PluginContributionsMenu` 按 Runtime 投影渲染并在动作失败时显示拒绝原因。
- 定向测试：`pnpm vitest run packages/plugin-contracts packages/plugin-sdk packages/create-actiondriver-plugin apps/agent-runtime/tests/unit/plugins apps/desktop/tests/unit/main/plugins apps/desktop/tests/unit/renderer/src/components/PluginContributionsMenu.test.tsx apps/desktop/tests/unit/renderer/src/di/container.test.ts` → 29 文件、112 项全部通过。
- 变更内新增断言：契约 9 项（六类目录、缺失命令引用、重复 ID、非法条件、协议门槛、旧 manifest 兼容）、SDK 1 项、脚手架 2 项调整（生成包真实构建 + 宿主加载）、Runtime 6 项（六类原子发布与条件投影、视图 ID 冲突归属、重复视图、协议门槛、按需激活与条件/grant 重检、HTTP 路由）、Desktop 3 项（视图容器与注入拒绝、视图路由、组件可用性与拒绝展示）。
- 提交前门槛（2026-09-30）：
  - `pnpm typecheck`：**未通过**，唯一失败是 `packages/contracts/tests/unit/contracts.test.ts(19,63)`；该文件与其他会话的在途改动（图片生成画廊）同一批，`git status` 显示 `packages/contracts/src|tests` 被其他会话修改，非本变更文件。本变更涉及的项目单独 typecheck 通过：`@actiondriver/plugin-contracts`、`@actiondriver/plugin-sdk`、`@actiondriver/agent-runtime`；`@actiondriver/desktop` 剩余报错全部位于其他会话在途文件（`markdown-blocks.ts`、`TaskPage.tsx`、`ActivityTimeline*`、`TaskComposer.tsx`、`transcript.test.ts`），本变更新增文件无报错。
  - `pnpm lint`：仅剩已知基线错误 `apps/desktop/src/renderer/src/main.tsx` 未使用的 `StrictMode` 导入（其他会话文件，未纳入提交）；本变更文件 ESLint 通过，`validate:e2e-interactions` 报告 152 条声明有效。
  - `pnpm test`：419 个文件 405 通过 / 2 跳过 / 12 失败；2531 项 2511 通过 / 2 跳过 / 18 失败。失败全部位于 `packages/cua`、`packages/sky`、`packages/browser-runtime`（本机 Node 20.14 缺少 `URL.parse` 的既有环境失败），外加 `cua-runtime` 的 js 预算超时与 `cua-parity` 构件超时（并行负载下超时；单独运行 `packages/cua-parity/tests/unit/package-artifact.test.ts` 4 项通过）。本变更涉及的文件与包零失败。
  - `pnpm test:e2e:local`：本次未运行。原因是该命令会重建 native helper、agent-runtime 与 desktop，且已知 2 项无关失败；本变更新增界面入口已由其定向组件测试与主进程宿主测试覆盖。如需真机回归，可在评审后补跑。
