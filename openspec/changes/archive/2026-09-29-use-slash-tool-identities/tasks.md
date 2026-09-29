## 1. 公共工具身份契约

- [x] 1.1 在 `packages/plugin-contracts` 与 `packages/runtime-contracts` 中定义并校验斜杠工具 ID，更新 `createToolIdentity` 和 SDK 导出；定向测试验证内置及第三方合法 ID、点号拒绝、版本独立和模型名保持下划线。
- [x] 1.2 移除旧工具 ID 与旧模型名别名表及调用方的规范化路径；定向 Registry、Policy Gate 测试验证旧点号 ID、旧 grants 和旧模型别名均不可调用，新 ID 可按版本执行。

## 2. 插件与运行时切换

- [x] 2.1 同步更新全部内置工具插件的 manifest、catalog、presentation 键和 `onTool:` 激活条件；逐插件定向测试验证声明与目录一致、激活后仅发布斜杠 ID。
- [x] 2.2 更新 Runtime 能力端口、grants、工具活动摘要、持久化恢复投影与特殊工具判断；定向测试验证新工具授权、执行、事件和重载，并确认旧记录不会触发执行。
- [x] 2.3 更新插件脚手架与公共 SDK 示例；生成并加载夹具插件，验证输出的工具 ID 为斜杠形式、模型名仍为下划线且旧点号第三方工具声明明确失败。
- [x] 2.4 使用带旧内置安装目录的夹具启动新版 Runtime，验证同版本包内容刷新、清单与代码一致、私有数据保留以及旧第三方包失败状态可诊断。

## 3. 桌面展示与交付

- [x] 3.1 更新 Desktop 工具类型判断、卡片、图片画廊与 Computer Use 引导；组件定向测试验证新 ID 展示与旧未知 ID 的通用回退。
- [x] 3.2 扫描生产代码中的点号工具 ID 常量和旧别名调用，修正遗漏并用定向测试验证 Browser、Computer、Command、Web、Skills 和 Image Generation 的发现及授权。
- [x] 3.3 验证 OpenSpec delta 与真实 Electron 工具调用链；准备提交时按仓库治理一次性运行 `pnpm typecheck`、`pnpm lint`、`pnpm test` 及必要的本地 E2E，只提交本变更相关文件并记录结果。

### 验证记录（2026-09-29）

- `openspec validate use-slash-tool-identities --strict` 通过；同步后的 `openspec validate --specs` 为 23 passed、0 failed。
- `corepack pnpm typecheck` 与 `corepack pnpm lint` 通过。
- 提交门禁只运行一次 `corepack pnpm test --maxWorkers=1`：2357 passed、36 failed、2 skipped（403 个测试文件）。其中 11 项为本变更遗漏的旧点号插件夹具，修正后定向运行 11/11 通过；其余 25 项为隔离工作树中的测试环境或超时问题：HTTP/MCP 在 Node 环境 24/24 通过，supervisor 在 Node 环境 5/5 通过，补齐运行依赖后 sandbox 9/9 通过，日志测试以 15 秒超时 9/9 通过。未重复运行全量测试，因此不将全量测试记为通过。
- 全部直接改动测试先前定向运行 428/428 通过；真实 Electron Computer Use 工具调用链定向 E2E 1/1 通过。
- 提交前检查 `git diff --check`、旧点号工具 ID 扫描与暂存边界；本提交只包含该变更文件。
