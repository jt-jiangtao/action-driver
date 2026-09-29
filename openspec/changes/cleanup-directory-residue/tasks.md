## 1. vendor 陈旧引用清理（执行型）

- [x] 1.1 把 `analysis/codex-cua/inventory-browser-desktop.mjs` 的 `embeddedRoot` 改指向 `packages/back/codex-cua/@oai/cua/dist/lib/js/oai_js_browser/dist/skill`，运行 `node analysis/codex-cua/inventory-browser-desktop.mjs` 并确认 `analysis/codex-cua/desktop-inventory.json` 无 diff。（已执行脚本，`desktop-inventory.json` 无 diff，4 个内嵌条目与备份逐字节对照；该路径在 7.4 迁移后为 `thirdparty/backup/codex-cua/...`）
- [x] 1.2 删除 `eslint.config.mjs` 的 `'apps/agent-runtime/vendor/**'` 忽略项，运行 `corepack pnpm lint` 确认无新增告警。（已在提交前门禁运行）
- [x] 1.3 删除 `vitest.config.ts` 的 `test.exclude` 中 `'apps/agent-runtime/vendor/**'`，运行相关定向测试确认收集结果不变。
- [x] 1.4 删除 `.gitignore` 中 `apps/agent-runtime/vendor/codex-cua/**` 的两条 `!` 反排除规则及注释，保留 `!packages/back/**`；用 `git check-ignore --no-index --quiet` 确认 `packages/back` 内的 `dist/` 与 `node_modules/` 未被忽略，`git ls-files packages/back` 仍为 1071。（该反排除规则在 7.2/7.4 中改为 `!/thirdparty/backup/**`，受跟踪文件数不变）
- [x] 1.5 删除 `.prettierignore` 中已失效的 `apps/agent-runtime/vendor/`，运行 `corepack pnpm lint` 确认格式检查不受影响。（已在提交前门禁运行）
- [x] 1.6 把 `docs/codex-cua-platform-gaps.md` 中三处 `apps/agent-runtime/vendor/...` 证据根改指向 `packages/back/...` 对应路径，并注明该目录是历史原件备份、原 vendor 已删除；逐条确认新路径真实存在。
- [x] 1.7 更正 `packages/back/README.md` 中"当前生产运行路径仍使用 vendor""不删除原 vendor""生产接线不变"等与事实相反的表述，说明原 vendor 已删除、生产已切换为 `@actiondriver/*` 自有实现、备份仅用于离线对照。
- [x] 1.8 用 `rg -n "agent-runtime/vendor"`（排除 `.git`）确认仓库内不再有待处理的现存引用，仅历史 OpenSpec/计划文档允许保留原文。（剩余命中全部为历史记录或明确说明删除事实的现行文档）

## 2. `packages/runtime-protocol/` 清理（执行型）

- [x] 2.1 核对 `packages/runtime-protocol/` 无受跟踪文件、无 `package.json`/`src`，且 `pnpm-lock.yaml`、根 `node_modules`、源码与配置均无引用后删除该目录。（`git ls-files` 为空、目录 0B，已删除）
- [x] 2.2 复核 `packages/runtime-contracts/src` 不含私有 RPC/MessagePort 协议符号；在交付说明中记录 `serve-runtime-over-http` 11.2 的残余范围。（`src` 仅含 stream/tool/computer-use 等协议，无 RPC/MessagePort 符号）
- [x] 2.3 确认 `docs/superpowers/plans/2026-09-20-establish-runtime-foundations.md` 等历史计划文档保留原文且不与当前事实冲突（仅记录结论，不改写历史文档）。（历史计划描述的是当时的 Go/gRPC 方案，现状差异已由 `replace-agentd-with-local-langgraph-runtime` 与 `serve-runtime-over-http` 记录，不改写）

## 3. CUA 系列包 `description`（执行型）

- [x] 3.1 读 `packages/cua` 源码后补写 `description`，描述其重建的 CUA 会话/发现/文档能力；用 `node -e` 解析 `package.json` 确认 JSON 合法。
- [x] 3.2 读 `packages/cua-parity` 源码后补写 `description`，描述其离线基准/接口对照与差异报告职责；确认 JSON 合法。
- [x] 3.3 读 `packages/cua-repl` 源码后补写 `description`，描述其指令装配与平台宿主启动职责；确认 JSON 合法。
- [x] 3.4 读 `packages/sky` 源码后补写 `description`，描述其 macOS 计算机使用客户端职责；确认 JSON 合法。

## 4. 根 `tests/` 归属规则（执行型）

- [x] 4.1 新增 `docs/testing/test-placement.md`，写入规则：根 `tests/` 只放根级脚本测试与包与包之间的边界测试，任何单包内部逻辑测试必须放在该包自己的 `tests/` 目录。
- [x] 4.2 在 `AGENTS.md` 的"测试与提交"章节增加一条指向 `docs/testing/test-placement.md` 的规则句，确认不改变既有测试与提交约束。

## 5. B 类 Battle 记录（决策型）

- [x] 5.1 在 `design.md` 记录 B1（`packages/back/` 位置）的当前方案、四个替代方案、比较、推荐与风险，核实 `.gitignore`、`eslint.config.mjs`、`vitest.config.ts`、`packages/cua-parity` 离线对照测试与 `backup-manifest.json` 的迁移影响。
- [x] 5.2 在 `design.md` 记录 B2（目录名拼写错误）的当前方案、三个替代方案、比较、推荐、submodule 内部引用约束与回滚方案。
- [x] 5.3 向用户提交 B1、B2 的明确裁决请求；未获裁决前不执行任何目录移动、`.gitmodules` 修改或兼容软链创建。（已取得裁决：B1=方案 3 `thirdparty/backup/`，B2=方案 2 一次性改名）

## 7. B 类实施（已裁决）

- [x] 7.1 把错拼的目录名改名为 `thirdparty`；`git mv` 同步更新 `.gitmodules` 的两个 submodule `path`；执行 `git submodule sync --recursive` 并用 `git submodule status`、`git -C thirdparty/{playwright,electron} status` 验证两个 submodule 在新路径正常解析。
- [x] 7.2 更新 `.gitignore` 中旧目录名的 `/*` 忽略与两条 submodule 反排除为 `/thirdparty/*`，并新增 `!/thirdparty/backup/`、`!/thirdparty/backup/**`；用 `git status` 确认 `thirdparty/{README.md,package.json,build,downloads,tools}` 仍被忽略、备份文件仍受跟踪。
- [x] 7.3 更新仓库内全部现行旧目录名引用（`.gitignore`、`eslint.config.mjs`、`vitest.config.ts`、`config/**`、`scripts/**`、`README.md`、`docs/development/**`、`docs/testing/test-placement.md`、`tests/unit/scripts/**`、`apps/desktop/tests/e2e/electron-fork-runtime.spec.ts`），并确认剩余命中仅为历史记录与 Fork 仓库内部内容。
- [x] 7.4 `git mv packages/back thirdparty/backup`，更新 `backup-manifest.json` 的 `destination`、`thirdparty/backup/README.md` 与全部现行 `packages/back` 引用（`analysis/codex-cua/**`、`packages/{cua,sky,cua-repl,cua-parity,browser-runtime,browser-desktop}` 的离线对照测试与文档、`eslint.config.mjs`、`docs/codex-cua-platform-gaps.md`），共 55 个现行文件。
- [x] 7.5 运行离线对照与证据校验：`node analysis/codex-cua/inventory-browser-desktop.mjs` 后 `analysis/codex-cua/desktop-inventory.json` 无 diff；`node analysis/codex-cua/verify-browser-resource-provenance.mjs`、`python3 analysis/codex-cua/verify-macos-module-mapping.py`、`python3 analysis/codex-cua/verify-duplicated-sky.py` 全部通过，基准未漂移。
- [x] 7.6 运行 CUA 系列包定向测试与脚本测试，确认迁移后的 `thirdparty/backup` 路径可用（Node v24.20.0）：`vitest run packages/{cua-parity,cua,sky,cua-repl,browser-runtime,browser-desktop}/tests` 185 文件 / 1105 用例全通过；`node --test tests/unit/scripts/**/*.test.mjs` 60 用例全通过。
- [x] 7.7 准备提交时一次性运行 `corepack pnpm typecheck && corepack pnpm lint && corepack pnpm test` 并记录结果：typecheck 除他人未提交的 `packages/plugin-contracts` 外全部通过；`pnpm lint` 对本改动文件通过，仓库级 lint 因他人正在编辑 `packages/plugin-contracts` 的文件竞态失败；`pnpm test`（Node v20.14.0）2482 用例中 12 失败 / 2468 通过，失败均为既有 Node 版本差异，`apps/agent-runtime` computer-use cua-runtime 单项受并发负载超时、单跑 23/23 通过。
- [x] 7.8 确认迁移后备份与忽略状态：`git ls-files thirdparty/backup` 仍为 1071；`git check-ignore --no-index --quiet thirdparty/build` 返回已忽略、`thirdparty/backup/.../dist/index.js` 返回未忽略；`git submodule status` 在 `thirdparty/{electron,playwright}` 正常解析。

## 6. 验证与交付

- [x] 6.1 运行 `openspec validate cleanup-directory-residue --strict` 确认变更产物合法。（通过）
- [x] 6.2 运行与本次改动直接相关的定向测试（`corepack pnpm vitest run tests/unit/scripts packages/cua-parity/tests` 等）与 `corepack pnpm typecheck`。（定向测试通过；无法通过项均为 Node v20.14.0 环境差异，在约定的 v24.20.0 下通过）
- [x] 6.3 准备提交时一次性运行 `corepack pnpm typecheck && corepack pnpm lint && corepack pnpm test`，把命令、通过/失败数量与已知无关失败写入提交信息或本变更记录。结果：
  - `corepack pnpm typecheck`（Node v24.20.0）：通过。
  - `corepack pnpm lint`（Node v24.20.0）：失败 1 项，仅为 `apps/desktop/src/renderer/src/main.tsx:1:10 'StrictMode' is defined but never used`，来自他人未提交改动；本次改动文件单独 lint 无错误。
  - `corepack pnpm vitest run packages/cua/tests packages/cua-parity/tests packages/sky/tests packages/cua-repl/tests`（Node v24.20.0）：44 文件 / 215 用例全部通过。
  - `corepack pnpm test`（Node v20.14.0，本机原生 ABI 匹配）：2479 用例中 12 失败 / 2465 通过，失败文件为 `packages/cua/tests/unit/{tab-reference,browser-session}.test.ts`、`packages/sky/tests/unit/sdk-integration.test.ts`、`packages/browser-runtime/tests/unit/service-{cdp,downloads,native-runtime,page-waits,command-security}.test.ts`，原因均为 Node 版本差异（对照原件使用 `Promise.withResolvers`/`URL.parse` 等 Node 22+ API），与本次改动无关。
  - `corepack pnpm test`（Node v24.20.0）：不可用，20 文件 / 116 用例失败，主要由 `better-sqlite3` 原生绑定 ABI 不匹配（`NODE_MODULE_VERSION 115` vs `137`）与其它工作流未提交的 desktop/Skills 改动引起，非本次改动引入。
- [x] 6.4 提交只包含本次任务改动，排除他人未完成的 `apps/desktop/src/renderer/src/main.tsx`、`apps/agent-runtime/src/{repositories,stream-session-service}.ts` 与新增 `src/{persistence,stream}/`、`openspec/changes/` 下其它未归档 change 与 `docs/superpowers/specs/` 下多个设计文档，并在交付说明中列出这些未提交文件。

## 8. 追加清理：统一残留的旧路径与拼写（用户 2026-09-30 追加要求）

- [x] 8.1 把 `docs/superpowers/**`、其它未归档与已归档 OpenSpec 记录中剩余的错误拼写统一替换为 `thirdparty`，`packages/back` 统一替换为 `thirdparty/backup`（共 30 个文件）；仅替换路径标识，不改写叙事与历史结论。
- [x] 8.2 修正把包版本写成路径的错误：`packages/browser-desktop/docs/source-mapping.md` 与 `analysis/codex-cua/desktop-source-map.md` 的 `@oai/browser-desktop@0.1.1` 改为实际目录 `@oai/browser-desktop/`。
- [x] 8.3 补齐 `.prettierignore` 的 `thirdparty/` 忽略（与 ESLint、Vitest 的 `thirdparty/**` 保持一致），并把 `packages/cua-parity/tests/unit/package-artifact.test.ts` 的产物路径守卫补上 `backup`。
- [x] 8.4 复核剩余命中：本仓库内已无错拼串（`thirdparty/backup/README.md` 仅保留迁移前的旧路径名，不属于拼写错误）；当时仍剩两个 Fork 工作树内的 14 处，由 9.x 处理。
- [x] 8.5 运行 `openspec validate` 与相关定向测试，确认文档与守卫改动未破坏变更合法性或测试。
- [x] 8.6 按用户追加要求，把本变更记录中剩余的 28 处错拼串全部改写为「旧目录名」指代（design/proposal/tasks），使主仓库内不再能搜到该拼写错误。

## 9. 追加清理：修正 Fork 仓库中在用的脚本与文档（用户 2026-09-30 追加要求）

- [x] 9.1 修正 `thirdparty/electron/action_driver/watermark/verify-electron.mjs`（水印验证入口，3 处路径）并提交到 `jt-jiangtao/electron`：`8b6c1f84f6c20f79b7176ccf868cf9e7615e9384`。
- [x] 9.2 修正 `thirdparty/playwright/action_driver/baseline/README.md`（Fork 基线复现文档，11 处路径）并提交到 `jt-jiangtao/playwright`：`7f98443fcd7ffc902aa42e0eeae040e8806bcf28`。
- [x] 9.3 两个提交都推送到各自 `origin` 的 `codex/fork-baseline` 分支，使递归拉取主仓库即可取得对应提交（此前两个 baseline 分支只存在于本机）。
- [x] 9.4 更新主仓库 pin：gitlink（`thirdparty/electron`、`thirdparty/playwright`）、`config/browser-forks.lock.json` 的 `sources.*.commit`、`config/electron-fork.json` 的 `sourceCommit`/`sourceTree`、`docs/development/browser-forks.md` 的提交表与 `README.md`、`docs/development/electron-watermark.md` 中的提交记录。
- [x] 9.5 验证：`loadBuildInputs`（强制 gitlink 与 lock 精确相等）通过；`resolveElectronFork`（基线祖先校验 + 产物哈希）通过；`node --test tests/unit/scripts/**/*.test.mjs` 60/60 通过；全仓（含两个 Fork 工作树）`rg "thridparty"` 无命中。
