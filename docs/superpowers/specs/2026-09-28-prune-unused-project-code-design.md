# 全仓无用代码清理设计

## 目标与成功标准

清理 ActionDriver 受 Git 跟踪的无用源码、失效的专属测试和空源码目录，保持现行产品行为、公共契约和数据不变。成功标准是每个删除项都有入口与引用证据，受影响模块的定向验证及提交前规定的全量验证通过，明确备份和本地产物保持原状。

## 范围

审查 `apps/`、`packages/`、`plugins/`、`scripts/`。保留 `packages/back`、Git 子模块、文档和设计资产、未跟踪的 `.env.local`、依赖安装与被忽略的构建缓存。仅清理源码区域内不承担占位用途的空目录。现有 OpenSpec 能力要求不变；详细范围与 Battle 裁决见 `openspec/changes/prune-unused-project-code/proposal.md`。

## 方法

从 `package.json` 的脚本、`exports`、`bin`，插件清单，Electron Main/Preload/Renderer 入口，Swift Package 入口，资源复制脚本及测试配置建立可达性根。静态导入图只产生候选；逐项核对动态导入、字符串路径、再导出、测试夹具与活跃 OpenSpec 计划。删除仅测试引用的旧实现时，确认对应测试已不再证明现行行为。把每项的保留或删除理由记入变更审计记录。

已确认的首个候选为 `apps/desktop/src/shared/detail-bounds.ts`，目前没有代码引用；实施时仍须复核构建和字符串入口。初筛中的 147 个零静态入边文件含真实入口，不能整批删除。

## 验证与恢复

按目录组运行定向测试与工作区类型检查；完整 `pnpm typecheck`、`pnpm lint`、`pnpm test` 只在准备提交时按仓库规范执行一次。涉及桌面运行时的变动追加相应构建或 E2E 检查。删除失败时按组恢复 Git 文件并修正审计结论。不得执行全仓清缓存或 `git clean`。

## 风险与裁决

用户在了解动态入口误删风险后选择更激进的全域代码清理，并明确“只删代码”。相对保守方案，本方案覆盖文件内部无用符号与仅失效测试引用的旧链路，要求更严格的入口核查和验证。任何实际公共接口、产品行为或数据格式变化都超出此裁决，需暂停并重新 Battle。技术决策、替代方案和风险详见 `openspec/changes/prune-unused-project-code/design.md`。
