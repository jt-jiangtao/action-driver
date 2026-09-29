## 1. vendor 陈旧引用清理（执行型）

- [x] 1.1 把 `analysis/codex-cua/inventory-browser-desktop.mjs` 的 `embeddedRoot` 改指向 `packages/back/codex-cua/@oai/cua/dist/lib/js/oai_js_browser/dist/skill`，运行 `node analysis/codex-cua/inventory-browser-desktop.mjs` 并确认 `analysis/codex-cua/desktop-inventory.json` 无 diff。（已执行脚本，`desktop-inventory.json` 无 diff，4 个内嵌条目与备份逐字节对照）
- [x] 1.2 删除 `eslint.config.mjs` 的 `'apps/agent-runtime/vendor/**'` 忽略项，运行 `corepack pnpm lint` 确认无新增告警。（已在提交前门禁运行）
- [x] 1.3 删除 `vitest.config.ts` 的 `test.exclude` 中 `'apps/agent-runtime/vendor/**'`，运行相关定向测试确认收集结果不变。
- [x] 1.4 删除 `.gitignore` 中 `apps/agent-runtime/vendor/codex-cua/**` 的两条 `!` 反排除规则及注释，保留 `!packages/back/**`；用 `git check-ignore --no-index --quiet` 确认 `packages/back` 内的 `dist/` 与 `node_modules/` 未被忽略，`git ls-files packages/back` 仍为 1071。
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

## 5. B 类 Battle 记录（决策型，待裁决，本变更不实施）

- [x] 5.1 在 `design.md` 记录 B1（`packages/back/` 位置）的当前方案、四个替代方案、比较、推荐与风险，核实 `.gitignore`、`eslint.config.mjs`、`vitest.config.ts`、`packages/cua-parity` 离线对照测试与 `backup-manifest.json` 的迁移影响。
- [x] 5.2 在 `design.md` 记录 B2（`thridparty` 拼写）的当前方案、三个替代方案、比较、推荐、submodule 内部引用约束与回滚方案。
- [x] 5.3 向用户提交 B1、B2 的明确裁决请求；未获裁决前不执行任何目录移动、`.gitmodules` 修改或兼容软链创建。（已提交请求，等待裁决）

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
