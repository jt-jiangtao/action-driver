## Why

仓库根包已使用 `action-driver`，但其余包、运行时标识、应用展示、文件和文档仍混用无连字符的旧拼写。用户要求在 `main` 上统一名称，避免发布物、开发入口与产品展示不一致。

Agent Battle 已完成：用户明确裁决覆盖主仓库、两个独立 Fork submodule、展示名与历史归档，并接受不保留旧名称兼容层、旧数据和设置可能失联的风险。实施中发现跨仓库边界后，用户追加裁决将两个 submodule 纳入本地修改与提交；推送前单独审查。没有未裁决的范围分歧。

## What Changes

- **BREAKING**：将 npm 作用域、包名、脚手架命令、导入路径、锁文件和打包脚本统一到 `action-driver` 命名。
- **BREAKING**：将应用展示名、原生包身份、协议方案、IPC、环境变量、观测标识、文件及目录名统一到新命名；需要合法标识符的代码位置改用语义名称。
- **BREAKING**：不提供旧名称别名或数据迁移。原应用数据目录、权限、插件或协议入口可能无法被新版自动读取。
- 更新当前文档、OpenSpec 主规格及历史归档中的旧品牌拼写，并校验仓库跟踪内容不存在旧拼写。
- 更名 Electron 与 Playwright Fork 中的旧品牌源码、构建路径和测试夹具，更新主仓库 gitlink、Fork 锁定记录及来源信息。
- 将已暂存的 `apps/desktop/src/renderer/src/main.tsx` 改动纳入最终同一提交，不改动其既有意图。

## Capabilities

### New Capabilities

- `product-identity`: 统一包、桌面应用、运行时和文档的产品命名及其破坏性切换行为。

### Modified Capabilities

- `desktop-shell`: 桌面应用名称和窗口标题改为新品牌。
- `plugin-platform`: 插件脚手架命令和公共 npm 包身份改为新名称。
- `computer-use`: 授权提示、helper 身份与自应用禁用判定使用新品牌。

## Impact

影响 `apps/`、`packages/`、`plugins/`、`scripts/`、两个独立原生 Fork 仓库、配置、测试、资源、文档、OpenSpec 及锁文件。外部插件开发者和已有安装用户需重新适配包引用、命令与系统授权；历史文档原文也会被改写。主仓库提交在 `main` 完成，现有 `main.tsx` 暂存改动须包含在同一提交；submodule 提交需先准备好供审查，再推送以保证主仓库 gitlink 可获取。
