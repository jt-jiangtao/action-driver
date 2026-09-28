## 1. 建立候选与入口证据

- [x] 1.1 从 `git ls-files` 枚举 `apps/`、`packages/`、`plugins/`、`scripts/` 的代码，汇总根目录与工作区 `package.json`、`plugin.json`、Electron Vite、Swift Package、测试配置和资源复制脚本所声明的入口；将候选、消费者与保留/删除理由记录到本变更的 `audit.md`，核对总数和 Git 状态。
- [x] 1.2 对零静态入边及仅测试引用的候选逐项运行 `rg` 反查包导出、字符串路径、动态导入、测试夹具和活跃 OpenSpec 依赖；确认 `apps/desktop/src/shared/detail-bounds.ts` 的删除依据，并在 `audit.md` 中标出排除项，验证每个待删文件都有独立理由。

## 2. 清理无用代码

- [x] 2.1 删除桌面端和运行时中核实无用的代码、专属死测试与直接关联的导出/配置；针对所改模块运行 `pnpm vitest run <相关测试文件>` 及对应工作区 `typecheck`，记录结果。
- [x] 2.2 删除共享包、插件和脚本中核实无用的代码及专属死测试；核对所有 `exports`、`bin`、插件清单和动态资源路径，针对所改模块运行定向测试与对应工作区 `typecheck`，记录结果。
- [x] 2.3 清理文件内部已无消费者的私有符号、导出和失效分支，并删除 `apps/`、`packages/`、`plugins/`、`scripts/` 下因此形成且无需占位的空源码目录；用 `rg` 与 `find` 复查引用和空目录，确认没有修改备份、子模块、本地配置及忽略产物。

## 3. 集成验证与交付

- [x] 3.1 审查 `git diff`、`audit.md` 与活跃 OpenSpec 变更，确认每个删除项可追溯、未改变现行公共契约；运行受影响构建或本地启动的定向检查，记录结果。
- [x] 3.2 准备提交时按 `AGENTS.md` 一次性运行 `pnpm typecheck`、`pnpm lint`、`pnpm test`，涉及界面或运行时的删除再按需运行相应 E2E；记录通过/失败数量与已知无关失败，检查 `git diff --check`，仅提交本次改动。
- [x] 3.3 固定 Node v24.20.0，对照未修改基线与清理分支的失败用例；按根因修复可复现的失败，逐项记录定向测试与影响范围。
- [x] 3.4 准备修复提交时一次性运行 `pnpm typecheck`、`pnpm lint`、`pnpm test`，记录通过/失败数量并复核差异；只提交本次裁决范围内的变更。
- [x] 3.5 完成验证后按 OpenSpec 流程归档本变更，确认归档记录与最终代码状态一致。
