## Context

参见 `proposal.md` - Why。当前事实（均为只读核实结果）：

- `apps/agent-runtime/vendor/` 已不存在；原件按原目录结构备份在 `packages/back/`，`packages/back/backup-manifest.json` 记录来源与 1118 个条目的哈希/大小。`packages/back/codex-cua/@oai/cua/dist/lib/js/oai_js_browser/dist/skill/` 确实存在，且与 `analysis/codex-cua/desktop-inventory.json` 已记录的 4 个内嵌条目字节一致。
- `analysis/codex-cua/inventory-browser-desktop.mjs` 是 `desktop-inventory.json` 与 `desktop-source-map.md` 的生成器，被 `packages/browser-desktop/docs/source-mapping.md` 与 `reconstruct-codex-cua-packages` 的 55.2 证据引用。
- `packages/runtime-protocol/` 无 `package.json`、无 `src`、无受版本控制的文件（`git ls-files packages/runtime-protocol` 为空），只剩空 `node_modules`；`pnpm-lock.yaml`、根 `node_modules` 与全仓源码都没有对它的引用。
- `packages/runtime-contracts/src` 现有 `stream-protocol.ts`、`tool-protocol.ts`、`computer-use-protocol.ts` 等，不含 RPC/MessagePort 符号，`serve-runtime-over-http` 11.2 提到的"私有 RPC 协议"在本轮无需额外删除。
- `packages/back/` 体积 24 MB、1071 个受跟踪文件；它位于 `pnpm-workspace.yaml` 的 `packages/*` glob 之下，但没有 `package.json`；其 `dist/`、`node_modules/` 依赖 `.gitignore` 的 `!packages/back/**` 反排除才能入库。（2026-09-30 已裁决并移至 `thirdparty/backup/`。）
- `thridparty/` 承载两个 Git submodule（`thridparty/playwright`、`thridparty/electron`）、`thridparty/package.json` 包边界，以及被忽略的本地产物（`build/`、`tools/`、`downloads/`、`logs/`）。两个 submodule 的工作树内部也写死了 `thridparty/...` 路径。仓库内没有 CI 配置文件（无 `.github/workflows` 等）。（2026-09-30 已裁决并改名为 `thirdparty/`。）
- 两个 submodule 的 gitdir 记录在 `.git/modules/{playwright,electron}`（按 submodule 名而非路径命名），因此改名后只需 `git submodule sync --recursive`，无需迁移 `.git/modules` 目录。

## Goals / Non-Goals

**Goals:**

- 清除所有指向已删除 `apps/agent-runtime/vendor/` 的失效引用，使文档中的证据路径可被读者实际核对。
- 删除 `packages/runtime-protocol/` 残留，补齐四个 CUA 系列包的职责描述，并把根 `tests/` 的边界规则固化为可继承的文档。
- 为 B1、B2 产出可直接裁决的 Battle 结论（含替代方案、影响面、回滚方案与推荐）。

**Non-Goals:**

- 不实施 B1、B2 的目录移动或 submodule 改名。
- 不修改任何历史计划/设计文档（`docs/superpowers/plans/**`、`openspec/changes/*/design.md`）的正文；它们属于历史记录，只在确认真实冲突时单独记录。
- 不重构 `packages/back` 或 CUA 系列包的实现代码，不改变其导出、测试语义与构建产物。

## Decisions

### A-1 vendor 引用的处理方式

- **当前方案**：保留 `analysis/codex-cua/inventory-browser-desktop.mjs`，把 `embeddedRoot` 改指向 `packages/back/codex-cua/@oai/cua/dist/lib/js/oai_js_browser/dist/skill`；另外 4 处配置/忽略规则直接删除；文档改指向备份并标注"历史原件备份"。
- **替代方案**：删除该脚本及 `desktop-inventory.json`，理由是基准已无对照对象。
- **选择理由**：脚本仍产出被 `desktop-source-map.md`、`packages/browser-desktop/docs/source-mapping.md` 和 `reconstruct-codex-cua-packages` 55.2 引用的证据；备份路径存在且字节一致，改路径后脚本可重新生成与原提交一致的清单。删除会破坏既有证据链，属于超出本次清理范围的证据销毁。
- **裁决**：执行型，直接采用当前方案。

### A-2 `packages/runtime-protocol/` 清理

- **当前方案**：直接 `rm -rf packages/runtime-protocol`。
- **替代方案**：保留目录，等待 `serve-runtime-over-http` 11.2 一并处理。
- **选择理由**：该目录已无任何受版本控制的文件、无 `package.json`/`src`，且被全仓引用检查证明无消费者；`serve-runtime-over-http` 11.2 已把它登记为待清理残留，本轮即为其归档动作。由于未被 Git 跟踪，删除不产生版本控制差异，也不影响回滚。
- **裁决**：执行型，直接采用当前方案。

### A-3 四个包的 `description`

- **当前方案**：读取各包源码后按实际职责写一句描述。
- **替代方案**：复制包名或同类包的原描述。被否决：既无法表达重建包的独立职责，也会把 `@oai/*` 的产品定位错误地带入 `@actiondriver/*`。
- **裁决**：执行型，直接采用当前方案。描述内容见 tasks 2.1–2.4。

### A-4 根 `tests/` 规则的归属

- **当前方案**：在 `docs/testing/test-placement.md` 写入完整规则，并在 `AGENTS.md` 的"测试与提交"章节加一条指向该文档的规则句。
- **替代方案一**：只改 `AGENTS.md`。缺点是规则细节会挤占治理文档，且与既有 `docs/testing/e2e-interaction-contracts.md` 的文档分工不一致。
- **替代方案二**：只加文档、不改 `AGENTS.md`。缺点是所有 Agent 都会读 `AGENTS.md`，不登记则规则难以被发现。
- **裁决**：执行型，采用当前方案。

### B1 `packages/back/` 的位置（决策型，待裁决）

- **当前方案（用户提出核实的现状）**：`packages/back/` 位于 `pnpm-workspace.yaml` 的 `packages/*` glob 之下，靠 `.gitignore` 的 `!packages/back/**` 才能入库；README 自述"不注册为实现 workspace 包"。
- **挑战**：该目录没有 `package.json`，pnpm 实际会忽略它，因此它今天不是功能性缺陷；真实问题是语义错位（`packages/` 表示"workspace 包"，此处却是非包的 24 MB 原件备份）、与同为 `packages/` 下的真实包 `packages/browser-desktop` 名称高度混淆，以及每新增一个忽略规则都要为它维护一条反排除。
- **替代方案（均为真实可执行）**：
  1. **保持 `packages/back/` 原地**：零迁移成本，但保留语义错位与名称混淆，问题不会消失。
  2. **移到顶层 `vendor-backup/`**：彻底离开 workspace glob；`.gitignore` 只需把 `!packages/back/**` 换成 `!vendor-backup/**`；`eslint.config.mjs` 改一条 ignore；`vitest.config.ts` 需新增一条 exclude（当前未排除 `packages/back`，只是它不含测试文件）；`packages/cua-parity` 的两处离线对照路径与文档、`backup-manifest.json` 的 `destination` 需要同步。
  3. **移到 `thirdparty/backup/`**（依赖 B2 改名）：语义上与原 vendor 同为第三方原件，但该目录当前的含义是"Fork submodule + 本机构建产物"，且 `thridparty/*` 被整体忽略、只例外两个 submodule；把不可变的受跟踪备份与可重建的本地产物混在同一忽略父目录下，会削弱"工具链与构建产物只留本地"这条规则的清晰度，并新增 `!thirdparty/backup/**`。
  4. **移到 `docs/reference/backup/`**：读者最接近证据；但 24 MB 的 `dist/`、`node_modules/`、WASM 二进制放进 `docs/` 会被 Markdown/文档工具扫描，且与"文档正文"的语义同样错位。
- **比较**：方案 2 的配置改动最少且语义最清晰（一个顶层备份目录，名字直接表达"第三方原件备份"）；方案 3 引入两级例外且与本地构建产物混放；方案 4 会把二进制塞进文档树；方案 1 不解决问题。四个方案对 `packages/cua-parity` 离线对照测试的影响都只是改路径常量，不影响断言语义。
- **Agent 推荐**：**方案 2（顶层 `vendor-backup/`）**，并以一次提交完成路径、配置、测试常量、文档与 `backup-manifest.json` 的同步。
- **风险**：历史 OpenSpec 与 `docs/superpowers/**` 中的旧路径不再指向现存文件（这些属于历史记录，不改写）；`thirdparty/backup/README.md` 与 `docs/codex-cua-platform-gaps.md` 等现行文档必须在本轮同步，否则会重新产生"无法核对的证据路径"。
- **裁决（2026-09-30，用户）**：**方案 3 —— 移到 `thirdparty/backup/`**（覆盖 Agent 推荐的方案 2）。
- **已知代价（用户覆盖项）**：备份位于 `thirdparty/` 之下，该目录的既有语义是"Fork submodule + 本机构建产物"。为让受跟踪备份与忽略的本地产物共存，`.gitignore` 需要 `/thirdparty/*` 加 `!/thirdparty/playwright/`、`!/thirdparty/electron/`、`!/thirdparty/backup/`、`!/thirdparty/backup/**` 四条规则；同时 `thirdparty/**` 已被 ESLint 与 Vitest 覆盖，无需再为备份单列规则。迁移影响：`.gitignore`、`eslint.config.mjs`、`vitest.config.ts`、`config/**`、`scripts/**`、`packages/cua-parity` 等 55 个现行文件的离线对照路径，以及 `backup-manifest.json` 的 `destination`。
- **实施结果**：目录已迁移；`thirdparty/backup/` 下 1071 个受跟踪文件全部保留，其它本地产物（`build/`、`tools/`、`downloads/`、`logs/`、`package.json`）仍按 `.gitignore` 忽略。

### B2 `thridparty/` → `thirdparty` 改名（决策型，待裁决）

- **当前方案**：把 `thridparty` 改名为 `thirdparty`，同步 `.gitmodules` 的两个 submodule `path` 与全仓引用。
- **挑战**：这条路径不是普通目录，而是两个 Git submodule 的挂载点。改名会同时影响 `.gitmodules`、`.gitignore`（`/thridparty/*` 与两条 `!`）、`eslint.config.mjs`、`vitest.config.ts`、`config/browser-forks.lock.json`、`config/electron-fork.json`、`scripts/build-browser-forks.mjs` 与 `scripts/lib/browser-forks/{prepare,sync,build,pipeline,inputs}.mjs`、`scripts/lib/electron-fork.mjs`、`scripts/lib/export-electron-fork.mjs`、`docs/development/browser-forks.md`、`docs/development/electron-watermark.md`、`README.md`、`tests/unit/scripts/lib/**`、`apps/desktop/tests/e2e/electron-fork-runtime.spec.ts`，以及被 `.gitignore` 排除的本地产物路径（`build/`、`tools/`、`downloads/`、`logs/`）。
- **真实约束**：两个 submodule 的**工作树内部**也写死了 `thridparty/...` 路径（如 `thridparty/electron/action_driver/watermark/verify-electron.mjs`、`thridparty/playwright/action_driver/baseline/README.md`）。这些文件属于 `jt-jiangtao/playwright`、`jt-jiangtao/electron` 两个独立仓库，本仓库无法修复；改名后它们指向的路径会失效。仓库内没有 CI 配置，因此影响面是本机开发者工作区与本地产物。
- **替代方案**：
  1. **不改名**：零风险，但保留拼写错误，且未来每处新增引用都会复制该错误。
  2. **一次性改名**：`git mv thridparty thirdparty` + 更新 `.gitmodules` + `git submodule sync --recursive` + 迁移 `.git/modules/{electron,playwright}` + 更新全部引用与本地路径；单次完成、无长期双名状态，但要求每个已有工作区按文档执行迁移，否则 submodule 命令会因 gitdir 路径不匹配而失败。
  3. **分两步：先改引用与目录并保留兼容软链**：step 1 完成改名与全部仓库内引用更新，同时放置 `thridparty -> thirdparty` 软链（不追踪），让 Fork 工作树内部的旧引用和尚未迁移的本地脚本继续可用；step 2 在浏览器 Fork 构建与 Electron 启动流程于真实工作区验证通过、且 Fork 仓库内部引用被修正后删除软链。
- **比较**：方案 1 保留已知错误；方案 3 在过渡期仍保留"两个名字"，且软链与 submodule 路径解析叠加会引入新的排障成本；方案 2 一次到位、状态唯一，代价是需要一份明确的本机迁移步骤。由于受跟踪内容只有两个 submodule 引用，回滚只需反向改名与 `git submodule sync`。
- **Agent 推荐**：**方案 2（一次性改名）**，并交付本机迁移步骤与回滚步骤；若用户希望避免任何 submodule 状态迁移，则退化为方案 1（明确接受拼写错误长期保留）。
- **风险 / 回滚**：Fork 仓库内部的 `thridparty` 字符串无法在本仓库修复，改名后会指向不存在路径，需在这两个 Fork 仓库中另行修正；本地产物（`build`、`tools`、`downloads`、`logs`）整体随目录改名移动，脚本已同步指向新路径。回滚方案：把 `.gitmodules` 的 `path` 与目录名改回 `thridparty`，执行 `git submodule sync --recursive`。
- **裁决（2026-09-30，用户）**：**方案 2 —— 一次性改名**，不保留兼容软链。
- **已知代价（用户覆盖项）**：两个 Fork 仓库工作树内部的 `thridparty/...` 引用（`thirdparty/electron/action_driver/watermark/verify-electron.mjs`、`thirdparty/playwright/action_driver/baseline/README.md`）在本仓库不可修改，改名后会指向不存在的路径，需在 `jt-jiangtao/playwright`、`jt-jiangtao/electron` 中另行修正；`docs/superpowers/**` 与已归档 OpenSpec 记录保留历史路径原文。
- **实施结果**：目录改名完成，`.gitmodules`、`.gitignore`、ESLint/Vitest 忽略、`config/**`、`scripts/**`、`README.md`、`docs/development/**`、`tests/unit/scripts/**`、`apps/desktop/tests/e2e/electron-fork-runtime.spec.ts` 全部指向 `thirdparty`；`git submodule sync --recursive` 后两个 submodule 在 `thirdparty/{playwright,electron}` 正常解析，`.git/modules` 无需迁移。

## Risks / Trade-offs

- [删除 `packages/runtime-protocol/` 的 `node_modules` 与其它 `node_modules` 共享软链] → 删除前确认根 `node_modules` 无指向该目录的链接；核实结果显示无引用，删除后重跑定向测试。
- [改 `embeddedRoot` 后生成物与已提交清单漂移] → 改路径后立即重跑脚本，确认 `analysis/codex-cua/desktop-inventory.json` 无 diff；有 diff 则说明备份与基准不一致，改为报告而不是覆盖。
- [补 `description` 时照抄包名或原 `@oai/*` 定位，产生新的误导] → 先读各包 `src/index.ts` 与 `docs/`，按实际导出能力描述。
- [B1 把受跟踪备份放进 `thirdparty/`，与该目录"本地产物保持忽略"的既有语义部分重叠] → 用显式的四条 `.gitignore` 规则区分 Fork submodule、备份与忽略产物，并在 `thirdparty/backup/README.md` 说明位置裁决；已用 `git status` 确认无误纳入本地产物。
- [B2 一次性改名后 Fork 仓库内部引用失效] → 该代价已公开并由用户接受；本仓库不改写历史记录，修正需在对应 Fork 仓库进行。
- [用户覆盖 Agent 推荐] → B1 采用方案 3 而非推荐的方案 2，接受的已知代价见上；不再重复争论，除非出现新证据（例如备份与本地构建产物在同一忽略父目录下产生实际冲突）。

## Migration Plan

- 本变更（A）不涉及部署迁移，只需同步删除本地残留目录并确认配置文件不再引用已删除路径。
- B1、B2 已按用户裁决执行：`git mv` 完成改名与移动，`git submodule sync --recursive` 恢复 submodule 解析，全仓现行路径引用同步更新。
- 其它开发者同步步骤：拉取本提交后执行 `git submodule sync --recursive`（`.git/modules/{playwright,electron}` 无需迁移）；本地产物目录随 `thirdparty` 改名整体移动，无需重新准备。
- 回滚：把 `.gitmodules` 的 `path` 与目录名改回 `thridparty`、`packages/back`，执行 `git submodule sync --recursive`，并还原路径引用。

## Open Questions

无。
