# Browser Fork 完整构建链路 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 从全新 macOS arm64 主仓库检出完成自有 Playwright/Electron 构建、来源验证与桌面打包。

**Architecture:** 受 Git 管理的锁定输入与模板驱动分阶段 Node CLI。两个直属 submodule 为源码事实来源，Chromium 与独立 Electron 构建检出在忽略工作区中准备；本机来源仅由显式导出生成，启动只核验。

**Tech Stack:** Node.js ESM、node:test、Git submodule、depot_tools/gclient、GN/Ninja、pnpm、Yarn、现有 Playwright/Electron 夹具。

**Spec:** `openspec/changes/bootstrap-browser-forks/design.md` 与 `specs/browser-fork-build/spec.md`。

## Global Constraints

- 首期仅 darwin/arm64；不安装或升级系统 Xcode/SDK/Metal，不修改全局 HOME 或包管理器配置。
- 源码为 thridparty/playwright 与 thridparty/electron；工作区为 thridparty/build/electron-workspace；独立 Electron 检出必须同提交且不共享 Git 元数据。
- Node 22.23.3：https://nodejs.org/dist/v22.23.3/node-v22.23.3-darwin-arm64.tar.gz，SHA-256 23b25245dcfb9af7262f8ff142e9e2e0af025368117329e7a7458a51e5922f53。
- depot_tools 41c9bd890277c2f551499d171d215dfdf5dab97d；pnpm 12.4.1；Electron yarn 4.12.0；node-gyp 11.5.0（既有实际使用版本）。
- Electron 38.8.6；Chromium DEPS 基线 51dd6cfc5c0bb8a297725ae9270ca43fb0fcc8e2；SDK 26.5；Metal Toolchain 按所选 Xcode 的组件准备并记录版本。
- GN 使用 testing.gn、target_cpu="arm64"、enable_precompiled_headers=false；SDK 路径在本机解析；默认 -j8，ulimit -n 65536。
- Fork commit 以当前获准 gitlink 为准，不能浮动 main；Playwright 夹具提交后更新对应指针，不把旧基线 SHA 写死成永远不能更新的值。
- 任何源码、配置或独立检出冲突都停止；不用 reset/clean/强制 checkout，不覆盖旧产物，不回退官方二进制。
- 无水印行为新增；与独立水印变更重叠文件只协同接线，不擅自改变已裁决方案。
- 迭代只跑定向测试；全量 typecheck/lint/test 与必要 E2E 仅在最终准备提交时运行一次。保留当前并行改动和正在运行的编译。

## Review Focus

- 项目路径含空格及从任意 cwd 调用：每条外部命令使用 argv 与明确 cwd（Task 2 测试）。
- 下载失败、损坏归档及未完成解包：不能激活半安装工具（Task 3 测试）。
- 构建检出有修改或 gclient 失败：主源码和既有目录必须保留（Task 4 测试）。
- export 中途失败或旧记录存在：旧可用 bundle 与来源必须作为一致的一对保留（Task 5 测试）。
- 状态文件宣称成功但输入或产物变化：续跑须拒绝伪造或过期状态（Task 6 测试）。

## Files and Interfaces

- `config/browser-forks.lock.json`：锁定工具与依赖基线，不存本机路径或 bundle 哈希。
- `config/browser-forks/`：gclient、GN 与 package-boundary 模板。
- `scripts/build-browser-forks.mjs`：CLI，解析阶段/--jobs/--from，输出错误与退出码。
- `scripts/lib/browser-forks/{inputs,runner,prepare,sync,build,provenance,pipeline}.mjs`：分别负责输入、进程、工具、源码、编译、导出及调度；相邻同名 .test.mjs 为定向测试。
- 公共 `BuildContext = {root:string, jobs:number, lock:object, run:RunCommand}`；`RunCommand(spec:{file:string,args:string[],cwd:string,env?:object,logPath:string}):Promise<void>` 非零时抛错。
- 阶段函数均为 `run<Name>(context:BuildContext):Promise<StageResult>`；`StageResult={outputs:string[],inputDigest:string,outputDigest:string}`。日志和状态写入 thridparty/logs 与 thridparty/build/browser-forks。
- `scripts/lib/electron-fork.mjs` 保持 resolveElectronFork 外部签名；内部读取锁定输入及 `thridparty/build/electron/provenance.json`。
- 改 `scripts/build-electron-native.mjs` 固定 node-gyp；复用 `scripts/test-packaged-macos.mjs`，不重写打包系统。

### Task 1: 锁定输入与可拉取的源码夹具

**Files:** 创建 inputs.mjs、inputs.test.mjs、锁定记录与模板；提交 Playwright 的 action_driver/baseline 自有文件（排除 manifest.json），更新主仓库 gitlink。

**Interfaces:** 产生 `loadBuildInputs(root:string):Promise<{lock:object,digest:string}>`，检查 .gitmodules、gitlink、源码 HEAD 与工具字段；后续阶段消费返回的 lock。

- [ ] 写 input_lock_rejects_gitlink_drift、missing_tool_version、unexpected_chromium_base 测试，断言明确拒绝错误输入。
- [ ] 跑 `node --test scripts/lib/browser-forks/inputs.test.mjs`，观察缺少实现或校验失败的 RED。
- [ ] 实现锁定校验与三种模板；保持包边界内容为 {"private":true}，不含 type 字段；完成 Fork 必需代码独立提交并确认远端可获取。若发布未获授权，先完成本地准备，报告远端验收依赖，不擅自推送。
- [ ] 同一测试 GREEN；确认 git ls-files 和远端源码包含夹具而没有本机 manifest。提交留到 Task 8 的统一验证关口；记录本任务文件清单。

### Task 2: 外部命令与 CLI 调度基础

**Files:** runner.mjs、runner.test.mjs、pipeline.mjs、pipeline.test.mjs、CLI。

**Interfaces:** 产生 `runCommand(spec):Promise<void>`；`parseBuildArgs(args:string[]):{stage:string,jobs:number,from?:string}`；阶段名称严格 prepare/sync/build/export/verify/package/all，--from 仅用于 all。

- [ ] 写 argv_preserves_spaces、cwd_independent、child_exit_stops_pipeline、invalid_stage_rejected、invalid_jobs_rejected 测试；jobs 只接受正整数，默认 8。
- [ ] 跑对应两个 node:test 文件 RED。
- [ ] 实现 argv/cwd spawn、环境清理、stdout/stderr 日志、SIGINT/SIGTERM 对本次进程组的传播；不终止用户已有进程。记录阶段失败并停止后续函数。
- [ ] 运行同一测试 GREEN；使用假阶段验证 all 顺序和 --from 边界，CLI 返回非零而非吞错。记录待提交文件。

### Task 3: 环境、下载和包边界准备

**Files:** prepare.mjs、prepare.test.mjs。

**Interfaces:** 消费 BuildContext 与 loadBuildInputs；产生 `runPrepare(context):Promise<StageResult>`，只在项目内安装工具。

- [ ] 写 unsupported_platform、sdk_missing、metal_missing、checksum_failure_keeps_existing_tool、unpack_failure_keeps_existing_tool、boundary_conflict_rejected 测试；下载与解包以隔离本地 fixture 验证，不依赖真实网络。
- [ ] 跑 prepare.test.mjs RED。
- [ ] 检查 git/Python/Xcode/SDK/Metal/磁盘，下载 Node 并按锁定值校验后解包到临时目录，再启用；固定 depot_tools commit、禁止自动更新；生成包边界。缺失系统条件输出准备命令，不自动安装。
- [ ] 同一测试 GREEN；使用当前机器只读环境诊断确认版本，不能据此宣称新工作区 prepare 已通过。记录待提交文件。

### Task 4: 安全源码同步及依赖安装

**Files:** sync.mjs、sync.test.mjs；修改 build-electron-native.mjs 的工具版本。

**Interfaces:** 产生 `runSync(context):Promise<StageResult>`；创建独立 Electron 检出并按 gitlink 提交同步，基线 Chromium Git 初始化成功后才运行 gclient。

- [ ] 写 dirty_source_rejected、dirty_build_checkout_rejected、wrong_origin_rejected、chromium_fetch_failure_preserves_electron、gclient_failure_preserves_source 测试，以临时 Git 仓库和受控失败命令复现。
- [ ] 跑 sync.test.mjs RED。
- [ ] 实现 non-shared clone、显式 fetch/同提交 checkout、模板冲突检查和 Chromium 预初始化；通过锁定工具运行 gclient。Playwright npm ci 与 Electron Yarn immutable 安装使用各自锁文件，配置包管理器在项目工具目录；原生 node-gyp 固定 11.5.0。
- [ ] 同一测试 GREEN；核对直属源码 .git 与主仓库身份未改变。记录待提交文件。

### Task 5: 编译、导出与真实来源

**Files:** build.mjs、build.test.mjs、provenance.mjs、provenance.test.mjs；修改 electron-fork.mjs、electron-fork.d.mts、electron-fork.test.mjs；迁出旧 config/electron-fork.json 的本机哈希职责。

**Interfaces:** 产生 `runBuild(context):Promise<StageResult>`、`runExport(context):Promise<StageResult>` 和 `verifyBuildOutputs(context):Promise<StageResult>`；保留 resolveElectronFork(options) 的公开签名及现有 provenance 字段，增加与输入摘要和补丁树摘要的关联。

- [ ] 写 jobs_and_fd_limit_propagated、compile_failure_prevents_export、export_failure_preserves_old_pair、recorded_source_mismatch、tampered_bundle_rejected_without_record_change 测试。
- [ ] 跑 build/provenance/electron-fork 定向测试 RED。
- [ ] 在新工作区生成 GN，使用 native GN/Ninja 和固定 Node PATH 编译 Electron，编译 Playwright。先在暂存目录验证版本/架构、基线与补丁应用、完整哈希，再用可回滚替换启用 bundle 和来源；没有真实输出不得生成成功记录。
- [ ] 同一测试 GREEN；断言启动/verify 不写 provenance，缺失记录明确失败。旧来源配置迁移前保留旧产物，不能覆盖用户正在使用的有效配对。记录待提交文件。

### Task 6: 状态恢复与双 Fork 验证

**Files:** pipeline.mjs、pipeline.test.mjs；必要时修改 Playwright action_driver/baseline 内的 manifest 生成接线。

**Interfaces:** 消费各阶段函数；产生 `runPipeline(context, options:{stage:string,from?:string}):Promise<void>`，状态 schema 包含阶段名、输入/输出摘要及成功/失败信息。

- [ ] 写 stale_input_reexecutes_stage、tampered_output_rejected_on_resume、success_marker_without_output_rejected、verify_uses_both_local_forks 测试。
- [ ] 跑 pipeline.test.mjs RED。
- [ ] 实现显式续跑验证；从当前实测来源生成 baseline manifest，调用已有 runSmoke(manifest)，保留真实页面操作、截图和进程关闭。不中断当前旧工作区的后台编译。
- [ ] 同一测试 GREEN；真实运行 `node --test thridparty/playwright/action_driver/baseline/verify.test.mjs thridparty/playwright/action_driver/baseline/smoke.test.mjs`，预期 14/14。记录待提交文件。

### Task 7: 桌面打包入口与使用文档

**Files:** pipeline.mjs、pipeline.test.mjs、docs/development/browser-forks.md、README.md、必要 package.json 命令别名。

**Interfaces:** package 阶段消费同一来源并调用现有 test-packaged-macos.mjs；全流程命令 `node scripts/build-browser-forks.mjs all --jobs 8`，续跑命令追加 `--from <stage>`。

- [ ] 写 package_requires_verified_export、package_propagates_failure、native_node_binding_unchanged 测试，迭代使用受控命令而非全量打包 E2E。
- [ ] 跑对应 pipeline 测试 RED。
- [ ] 接入锁定主项目依赖、原生模块、Runtime/desktop 和现有打包脚本；文档列出前置条件、Git/忽略边界、完整命令及失败恢复。明确此时不能声明完整新机器验收。
- [ ] 同一测试 GREEN，运行文档差异检查并核对入口 --help。记录待提交文件。

### Task 8: 新工作区与最终提交验证

**Files:** 更新 OpenSpec tasks 和验证记录；只提交以上获准文件与必要 Fork 指针，不混入并行改动。

**Interfaces:** 消费 Tasks 1–7；产生真实远端源码获取、阶段日志、本机来源、双 Fork 和打包证据。

- [ ] 准备仅含本任务及既有必要基线的主仓库候选提交快照，确认两个 Fork 的提交均可从真实远端获取。新检出不复制 thridparty、node_modules、out、dist，不通过 URL 本地替换作为最终验收。
- [ ] 在全新目录执行完整入口；记录系统 Xcode/SDK/Metal 版本。真实 prepare/sync/build/export/verify 成功后，在最终准备提交阶段完成 package；大型编译可以跨轮继续，但未结束不得勾选完整成功。
- [ ] 最终准备提交时执行一次 pnpm typecheck、pnpm lint、pnpm test，以及必要本地与打包 E2E；package 已覆盖的同一打包验收不重复运行。失败数量、无关失败及实际结果进入记录，不伪报全绿。
- [ ] OpenSpec strict 与差异检查通过；按 executing-plans 做一次 fresh-context 全分支审查，只修重要问题，定向验证；按主题提交本任务主仓库改动，确认 staging 未包含并行文件，归档需走获准流程。

## Self-Review

输入恢复由 Task 1/3/4 覆盖；阶段失败与恢复由 Task 2/6 覆盖；来源与篡改拒绝由 Task 5 覆盖；实际双 Fork 与打包由 Task 6/7/8 覆盖。接口沿用 BuildContext、RunCommand、StageResult；五项 Review Focus 均有对应回归用例。系统安装与 Fork 发布权限缺失会明确阻塞验收，不静默改变范围。
