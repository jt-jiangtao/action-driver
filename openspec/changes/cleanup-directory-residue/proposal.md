## Why

上一轮目录划分审查逐条核实了仓库中的目录与引用残留。`apps/agent-runtime/vendor/` 已按既有裁决删除，但仓库里仍有 6 处指向它的陈旧引用和 1 处已失效的 Prettier 忽略项，读者按文档给出的"证据根"无法核对任何文件；`packages/runtime-protocol/` 只剩一个空的 `node_modules` 残留目录；`packages/cua`、`packages/cua-parity`、`packages/cua-repl`、`packages/sky` 四个包缺少 `description`，职责边界只能靠通读源码推断；根 `tests/` 已经收敛为"根脚本测试 + 跨包边界测试 + 共享 setup"三类内容，但这条边界规则没有写进任何仓库文档。

这些都属于低风险、可逆、机械性的执行型清理：不改变产品行为、公共接口、依赖版本或运行边界。另外两项改动触及仓库边界，必须先 Battle 并由用户裁决：`packages/back/` 的最终位置（B1）与 `thridparty/` 的拼写改名（B2）。

## What Changes

- **执行型清理（A）**
  - 把 `analysis/codex-cua/inventory-browser-desktop.mjs` 中已不存在的内嵌基准路径改指向 `packages/back/codex-cua/...` 备份，使脚本重新可运行；删除 `eslint.config.mjs`、`vitest.config.ts`、`.gitignore`、`.prettierignore` 中指向已删除目录的失效规则（保留 `packages/back/**` 的例外）。
  - 把 `docs/codex-cua-platform-gaps.md` 的"证据根"改指向 `packages/back/...` 对应路径并注明这是历史原件备份；更正 `packages/back/README.md` 中"生产运行路径仍使用 vendor"等与事实相反的表述。
  - 删除被 `replace-agentd-with-local-langgraph-runtime` 取代的 `packages/runtime-protocol/` 残留目录，并确认全仓没有脚本、配置或文档依赖它。
  - 为 `packages/cua`、`packages/cua-parity`、`packages/cua-repl`、`packages/sky` 补写准确的 `description`：先读源码确认职责，再按实际能力描述，不复述包名。
  - 把根 `tests/` 的归属规则写入仓库文档，并在 `AGENTS.md` 的测试章节登记该规则。
- **已裁决并实施（B）**：`packages/back/` 移到 `thirdparty/backup/`（B1，用户裁决为方案 3）；`thridparty/` 一次性改名为 `thirdparty/`（B2，用户裁决为方案 2）。两次改动同步更新 `.gitmodules`、`.gitignore`、`eslint.config.mjs`、`vitest.config.ts`、构建脚本、配置、测试与现行文档中的路径引用。

## Capabilities

### New Capabilities

无。本变更只清理残留、补齐包元数据与文档规则，不改变任何可观察行为，因此 `.openspec.yaml` 设置 `skip_specs: true`。

### Modified Capabilities

无。

## Battle Status

- 类型：混合。A 为执行型（低风险、可逆、机械，且完全处于既有已批准范围内）；B1、B2 为架构型决策（仓库布局与 Git submodule 路径边界）。
- A：无需 Battle，已按协议公开分类依据并直接推进。
- B1、B2：**Battle 已完成并已由用户裁决（2026-09-30）**。Agent 推荐的 B1 方案 2（顶层 `vendor-backup/`）与 B2 方案 2（一次性改名）中，用户选择 **B1 方案 3（`thirdparty/backup/`）**、**B2 方案 2（一次性改名）**；覆盖 Agent 推荐项的已知代价记录在 `design.md` 的 Risks / Trade-offs。
- 未解决的关键分歧：无。B2 遗留的 Fork 仓库内部 `thridparty` 引用属于外部仓库，需在对应 Fork 中另行修正，已作为已知代价记录。
- 重开条件：出现新证据（例如 workspace 工具链改变对无 `package.json` 目录的处理、submodule 迁移在真实工作区失败，或 Fork 仓库内部引用被同步修正）。

## Impact

- 修改文件：`analysis/codex-cua/inventory-browser-desktop.mjs`、`analysis/codex-cua/**` 证据与校验脚本、`eslint.config.mjs`、`vitest.config.ts`、`.gitignore`、`.prettierignore`、`.gitmodules`、`docs/codex-cua-platform-gaps.md`、`thirdparty/backup/README.md`、四个包的 `package.json`、`AGENTS.md`、`README.md`、`config/**`、`scripts/**`、`packages/{cua,sky,cua-repl,cua-parity,browser-runtime,browser-desktop}/**` 中的离线对照引用、`tests/unit/scripts/**`、`apps/desktop/tests/e2e/electron-fork-runtime.spec.ts`，以及新增的测试归属文档。
- 删除：`packages/runtime-protocol/`（未被版本控制跟踪，仅含空 `node_modules`）。
- 目录改名/移动：`thridparty/` → `thirdparty/`（含两个 Git submodule 路径）、`packages/back/` → `thirdparty/backup/`。
- 不改变产品行为、公共接口、依赖版本、构建工具链或持久化数据；`pnpm-workspace.yaml` 的 `packages/*` glob 不再包含非包备份目录。
