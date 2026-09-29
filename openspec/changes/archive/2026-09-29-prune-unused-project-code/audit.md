# 无用代码审计（2026-09-28）

## 基线与方法

- 基线提交：`a88962dd2eed788e2d8cdb9063cb3bbd4fc1df2e`。独立工作区起始只有本变更的未跟踪规划文件；原主工作区的 `.env.local` 未复制、未读取或修改。
- `git ls-files` 共 3,216 条；排除 `thirdparty/backup` 后，`apps/`、`packages/`、`plugins/`、`scripts/` 共 1,518 条。其中文本脚本类代码（TS/TSX/JS/MJS/MTS）1,041 条，Swift 47 条，Python 55 条。`thirdparty/backup`、两个 Git 子模块及被忽略的构建目录不进入删除集合。
- 以相对导入和 `.js`→`.ts/.tsx` 映射生成候选，得到 86 个零相对入边文件（`apps` 23、`packages` 14、`plugins` 26、`scripts` 23）。逐类反查声明入口、字符串路径、测试与活跃 OpenSpec；零入边本身不构成删除证据。
- 使用 `rg -n 'DetailBounds|detail-bounds|isExecutorRegistered' apps packages plugins scripts`、工作区包清单、`tsc --noUnusedLocals --noUnusedParameters`、`find ... -type d -empty` 核对删除项。原主工作区的定向基线测试为 41/41 通过；独立工作区相同两组测试也为 41/41 通过。

## 真实入口与保留结论

| 类别 | 入口或消费者 | 结论 |
| --- | --- | --- |
| 桌面端 | `apps/desktop/electron.vite.config.ts` 的 Main、Preload 两入口与 Renderer；`apps/desktop/package.json` 的脚本；HTML/测试配置 | 保留对应零入边文件，含 `src/main/index.ts`、`src/preload/index.ts`、`src/preload/plugin-panel.ts`、`src/renderer/src/main.tsx`。 |
| 运行时 | `apps/agent-runtime/package.json` 的构建链、`src/runtime-entry.ts`、`src/web-open/extract-worker.ts`、`src/plugins/host-entry.mjs`、JS REPL 资源和测试 fixture | 保留这些声明或动态加载入口以及 `*.d.ts`、`*.d.mts`。 |
| 共享包 | 14 个非备份工作区包的 `exports`、`bin`、CLI、`vitest.config.ts`、测试 fixture | 保留公开入口和脚本入口；例如 `packages/cua/src/computer-entry.ts` 由包导出引用。 |
| 插件 | 10 个 `plugin.json`、包 `exports`、生成的 `src/skill.ts` 资源列表 | 保留 `src/extension.ts`、类型声明、按资源路径装载的 Python/MJS 脚本；`plugins/image-generation/src/providers/token-plan-image-generation-adapter.ts` 是包导出。 |
| Swift | `plugins/computer-use/native/Package.swift` 的两个生产 target 与一个测试 target | 保留 47 个 Swift 文件；目录 target 不需要逐文件 TS 导入。 |
| Python | 55 个 `.py` 名称均在受控仓库的 Skill/脚本/资源文本中有消费者 | 保留。`plugins/presentations/.../__pycache__/runtime_helpers.cpython-312.pyc` 虽是编译文件，但当前 `src/skill.ts` 明列为资源，不能只删文件而留下失效清单。 |
| 顶层脚本 | 根及工作区 `package.json`、脚本自身的 CLI 用法、测试文件 | 保留 `scripts/generate-image-mockup.mjs` 等独立手动入口；无静态调用不等于无用途。 |
| 测试文件 | Vitest、Node 测试或夹具路径字符串 | 保留仍验证现行行为的测试和夹具。 |

活跃 OpenSpec 变更中没有 `detail-bounds` 或 `isExecutorRegistered` 的未来接线要求。`openspec/specs/.gitkeep` 和 `openspec/changes/archive/.gitkeep` 是非代码目录占位，不在本次删除范围。

## 删除清单与逐项证据

| 路径或符号 | 证据 | 操作 | 验证 |
| --- | --- | --- | --- |
| `apps/desktop/src/shared/detail-bounds.ts` | 只有文件自身定义 `DetailBounds`；`rg` 对应用、包、插件、脚本及活跃规划无消费者；不在任何包导出、脚本或插件入口中。 | 删除文件。 | Desktop `typecheck`；全仓引用反查。 |
| `apps/agent-runtime/src/agent-files/agent-file-store.ts` 中的 `isExecutorRegistered` 成员、构造选项和赋值 | `tsc --noUnusedLocals` 报 TS6133；`rg` 仅命中这四处定义/赋值，没有调用者传该选项，成员也未读取。 | 删除这些声明和赋值。 | `agent-file-store.test.ts` 与运行时 unused 诊断。 |
| `apps/agent-runtime/tests/stream-session-service.test.ts:637` 的 `observer` 形参名 | `tsc --noUnusedParameters` 报 TS6133；相邻同类测试使用 `_observer`，该回调中未读取此参数。 | 改为 `_observer`，保持函数位置与行为。 | `stream-session-service.test.ts` 与运行时 unused 诊断。 |
| `apps/agent-runtime/src/web-open/address.ts` | 唯一内容为 `@actiondriver/web-plugin/address` 再导出；只有旧测试直接导入，真实插件通过包导出提供相同实现。 | 删除再导出文件，测试改用插件包入口。 | `web-open-address.test.ts` 4/4 通过。 |
| `apps/agent-runtime/src/web-open/http.ts` | 唯一内容为 `@actiondriver/web-plugin/http` 再导出；只有旧测试直接导入，生产插件使用自身实现。 | 删除再导出文件，测试改用插件包入口。 | `web-open-http.test.ts` 12/12 通过。 |
| `apps/agent-runtime/src/web-open/tool.ts` | 仅旧测试引用；实际 Web 插件用 `plugins/web/src/reader/extension.ts` 注册工具。旧 `registerWebOpenTool` 测试验证的是未装配的注册路径；现行包目录与装配另有 `plugins/web/src/reader/catalog.test.ts`、`capability-plugin-packaging.test.ts`。 | 删除桥接文件及旧注册测试；保留 URL 拒绝、提取和 Agent Loop 测试，改为直接导入插件实现。 | Web 定向 5 文件 20/20 通过；运行时 TypeScript 检查通过。 |

## 空目录与排除项

独立 Git 工作区的受控源码路径中，排除 `node_modules`、`dist`、`out`、`.build` 后没有空目录。原主工作区的 8 个非忽略空源码目录已用 `rmdir` 清理：`apps/agent-runtime/resources/system-skills`、`src/browser-use`、`src/sandbox`，`apps/desktop/scripts`、`src/main/agent-files`、`src/renderer/src/components/computer-use`、`src/renderer/src/components/logs`，以及 `packages/model-connections/tests`。它们不属于 Git 跟踪内容。`apps/native-computer-use-helper` 下 3 个空目录属于整个被忽略的旧本地目录，按“只删代码、不清理忽略产物”范围保留。明确备份、子模块、`.env.local`、文档与设计资产、本地构建产物均保留。

## 验证记录

- 已删除 `apps/desktop/src/shared/detail-bounds.ts`；运行时移除 `isExecutorRegistered` 成员/构造选项/赋值；测试形参改为 `_observer`。删除后 `rg -n 'DetailBounds|detail-bounds|isExecutorRegistered' apps packages plugins scripts` 无命中。
- `corepack pnpm vitest run apps/agent-runtime/tests/agent-file-store.test.ts apps/agent-runtime/tests/stream-session-service.test.ts`：2 文件、41/41 通过。预期错误路径测试仍打印 `INPUT_FILE_NOT_FOUND` / `INPUT_FILE_NOT_STAGED` 的 stderr。
- `corepack pnpm exec tsc --noEmit --noUnusedLocals --noUnusedParameters -p apps/agent-runtime/tsconfig.json`：通过，原两项 TS6133 消失。
- 首次 Desktop `typecheck` 因独立工作区缺少 `@actiondriver/browser-desktop` 构建声明而失败；先运行 `@actiondriver/browser-runtime` 与 `@actiondriver/browser-desktop` 的定向 build 后，`corepack pnpm --filter @actiondriver/desktop typecheck` 通过。构建产物均为被忽略文件。
- Web 旧桥接清理前，4 个相关测试文件 20/20 通过。改为直接验证插件后，`corepack pnpm vitest run apps/agent-runtime/tests/web-open-address.test.ts apps/agent-runtime/tests/web-open-http.test.ts apps/agent-runtime/tests/web-open-tool.test.ts apps/agent-runtime/tests/web-open-agent-loop.test.ts plugins/web/src/reader/catalog.test.ts` 为 5 文件 20/20 通过；运行时 unused TypeScript 检查通过。
- 额外运行 `capability-plugin-packaging.test.ts` 时首次 2/4 通过、2 项因独立工作区尚未分发 `dist/plugins/pdf` 和 `dist/plugins/command` 而失败；执行 `node apps/agent-runtime/scripts/stage-plugins.mjs` 后，同一测试 4/4 通过。暂存输出均被 Git 忽略。
- 仅测试引用的运行时 Skill 与图片生成桥接层继续保留：现有测试验证会话权限、资源保存和并发等现行插件行为；删除这些测试会丢失有效回归覆盖，迁移测试需另行保持等价覆盖。共享包、插件和顶层脚本没有其他已证实可删的源码。
- 集成构建：运行时入口按 `apps/agent-runtime/package.json` 的 esbuild 参数单独打包通过。首次 Desktop build 因独立工作区缺少 `@actiondriver/command-plugin/presentation` 的 `dist` 而失败；执行 `corepack pnpm --filter './plugins/*' build` 后，Desktop Main/Preload/Renderer 构建通过（入口声明验证 149 项）。这些都是被忽略的本地构建输出。
- 提交前检查各执行一次：`corepack pnpm typecheck` 通过（27 个工作区项目）；`corepack pnpm lint` 通过（含 149 项交互声明）；`corepack pnpm test` 失败，403 个测试文件中 386 通过、15 失败、2 跳过，2391 项测试中 2313 通过、76 失败、2 跳过。
- 全量失败诊断：`provider-adapters.test.ts` 的本地 SSE 用例在本独立工作区单独运行仍报 `Connection error`（同一源文件在原主工作区单独运行 32/32 通过，说明存在工作区环境差异）；`otel-logger.test.ts` 的 2 个用例和 `interaction-logging.test.ts` 的 1 个用例单独运行仍在 5 秒超时；`Conversation.test.tsx` 的 6 个用例单独运行报 `motionPreference?.removeEventListener is not a function`，并在未改代码的原主工作区复现相同 6 项失败。这些源文件均不在本变更的差异中。全量其余失败未逐项归因，不能声称全量通过。
- 本变更直接涉及的 AgentFileStore、StreamSessionService、Web 地址/HTTP/工具/Agent Loop 与插件目录测试均通过。运行时入口 esbuild、插件暂存、全部插件 build、Desktop Main/Preload/Renderer build 通过；未运行需原生 Electron Fork 与 helper 的 E2E（独立工作区的两个子模块未初始化，且本变更没有更改运行时装配入口）。
- `git diff --check` 通过；待最终暂存和提交后补充提交范围核对。

## 全量测试失败的追加诊断与修复

- 用户追加裁决：统一诊断使用本机 Node v24.20.0，并在清理分支修复测试失败。主工作区默认 Node v20.14.0，独立工作区默认 v24.20.0；同一组 CUA、Sky、OpenTelemetry 共 10 项测试在默认版本下分别失败 5 项和 2 项。主工作区明确切到 v24.20.0 后与清理分支一致，均仅有 OpenTelemetry 的 2 项失败。未修改 `package.json` 的 Node 支持范围。
- 对旧全量日志涉及的 14 个测试文件进行 Node v24.20.0 定向复现：143 项中 19 项失败。浏览器运行时、CUA、Sky 相关文件在统一环境下通过；可复现失败集中于 Runtime 进程、SSE、遥测关闭和 Renderer 测试。
- Renderer 的全局 `matchMedia` 测试模拟缺少 `removeEventListener`，组件卸载时抛错；在 `tests/setup.ts` 补齐模拟接口后，Conversation 与 pages 两文件 55/55 通过。该失败也在未修改主工作区复现。
- OpenTelemetry 用例使用无响应的默认本地收集端，放宽诊断时限后两项均约 5.01 秒通过，确认是关闭等待超过默认 5 秒测试时限。新增仅供测试的本地 OTLP HTTP 收集端，供 observability、service logging、Main logging 和 Runtime 进程测试使用；对应 4 文件共 17/17 通过，仍实际验证日志导出及无本地日志行为。
- Runtime 进程测试在独立工作区缺少被忽略的打包 Python/Node 时报告 `BUNDLED_NODE_UNAVAILABLE`；从主工作区现成的相同构建产物复制到独立工作区的忽略 `dist/runtimes`，未修改跟踪文件。之后用本地 OTLP 收集端避免关停等待，Runtime 进程 8/8 通过。
- SSE 适配器的本地 HTTP 流用例在 Node v24.20.0 与 jsdom 组合下报 `Connection error`，同文件在 Node 环境 32/32 通过；为该服务端测试文件指定 Vitest Node 环境后，默认命令也 32/32 通过。
- 上述 14 文件合跑为 143/143 通过。此前全量的 76 项失败尚未全部归因，不能由这次定向结果推断全仓通过；下一次全量仅在准备修复提交时执行。
- 追加修复候选的第一次提交前全量检查：`corepack pnpm typecheck` 对 27 个工作区项目通过；`corepack pnpm lint` 通过（149 项交互声明）；`corepack pnpm test` 为 403 文件中 394 通过、7 失败、2 跳过，2391 项中 2335 通过、54 失败、2 跳过。第一次附加 JSON 参数误被 pnpm 自身解析，未启动测试；第二次 `--` 参数被 Vitest 当作位置参数，全量测试实际运行但仍用默认报告器。
- 54 项主要集中在独立工作区缺少被忽略的运行时构建产物：`dist/bin/rg`、`dist/js-repl`、`dist/resources` 和 `dist/dependencies`。从未修改主工作区复制已有产物到独立工作区，没有新增跟踪文件或删除缓存。补齐后，先前失败的 JS REPL、脚本工具、运行时适配器与 CUA Runtime 等 6 文件定向共 54 项中仅剩沙箱 4 项与 HTTP MCP 1 项失败；其中沙箱 4 项缺少 `dist/dependencies`，补齐后沙箱 9/9 通过。其他直接引用 Runtime dist 的 7 文件定向为 29 通过、1 跳过。
- HTTP MCP 用例在全局 jsdom 环境下把跨 realm 的 `AbortSignal` 传给 Node fetch，报 `Expected signal ... to be an instance of AbortSignal`；以 `--environment=node` 单独验证 5/5 通过后，为该纯服务端测试文件固定 Node 环境，默认定向命令 5/5 通过。
- 当前待做：复核差异与 OpenSpec，再按提交门槛运行下一次完整验证。之前全量的 54 项失败不能在未运行下一次完整验证前宣称全部解决。
- 补齐 Runtime 构建产物、固定 HTTP MCP 测试环境后的下一次提交前全量检查：`corepack pnpm typecheck`、`corepack pnpm lint` 通过；`corepack pnpm test` 为 403 文件中 400 通过、1 失败、2 跳过，2391 项中 2373 通过、16 失败、2 跳过。全部 16 项在 `service-http.test.ts`，其余先前失败文件均通过。
- `service-http.test.ts` 的服务端 HTTP 请求在全局 jsdom 环境下统一得到 500，指定 `--environment=node` 后 24/24 通过；为此文件固定 Vitest Node 环境，默认定向命令 24/24 通过。下一次完整验证仍需确认全仓绿色。
- 最终修复候选提交前验证在 Node v24.20.0 下各执行一次：`corepack pnpm typecheck` 通过（27 个工作区项目），`corepack pnpm lint` 通过（149 项交互声明），`corepack pnpm test` 通过（403 文件中 401 通过、2 跳过；2391 项中 2389 通过、2 跳过）。`git diff --check` 和 OpenSpec strict validate 通过。原有的 2 项跳过分别为工具压力测试与现场 OpenTelemetry 测试。
