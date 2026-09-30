# 双 Fork 基线 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. 执行方式由用户选择，未经选择不开始实现。

**Goal:** 编译用户的 Playwright 与 Electron/Chromium Fork，并用独立夹具证明两套自有产物共同运行。

**Architecture:** Electron Fork 通过官方 gclient/DEPS 链获取 Chromium，自有内核补丁由 Electron 补丁队列追踪。Playwright Fork 编译本地 playwright-core，独立脚本通过 Electron 支持启动自编译二进制并操作测试页面。Action-Driver 产品不参与本期。

**Tech Stack:** macOS arm64、Git、Node.js、npm、Python、depot_tools、GN、Ninja、Electron、Playwright。

**Spec:** `openspec/changes/implement-browser-use/design.md` 与 `openspec/changes/implement-browser-use/specs/browser-use/spec.md`。

## Global Constraints

- 源码仓库固定为 https://github.com/jt-jiangtao/playwright 与 https://github.com/jt-jiangtao/electron。
- Chromium 自有行为改动必须受 ACTION_DRIVER 平台宏控制；Playwright 自有实现必须位于自有目录。
- 必要上游接线冲突先裁决，不隐含豁免；零行为差异如实记录，不新增扩展接口。
- 不修改 Action-Driver 产品代码、依赖、打包、面板或工具，不实现 Agent 闭环。
- 两套实际加载产物都必须来自自有源码构建，不回退官方二进制。
- 只声明实际验证的 macOS arm64 组合；不推送远程、发布产物或修改用户全局默认 Node 配置。
- 读取各 Fork 治理文件后执行适用验证；本仓库迭代期不运行全量测试，提交不混入无关改动。

## Review Focus

- 夹具意外解析到 npm 官方 Playwright：检查实际模块绝对路径与源码锁定信息。
- Electron 自编译路径缺失或 checksum 错误：启动前明确拒绝，不能自动寻找官方替代。
- 页面或进程关闭后残留资源：成功与异常路径都执行清理，检查进程退出和已关闭页面动作失败。
- 本地夹具端口被占用：监听 127.0.0.1 的动态端口，测试结束关闭 server。
- 自有差异扫描误计 Electron 原有 Chromium 补丁或忽略未追踪文件：分别对比锁定上游与工作区完整状态。

---

## 工作区与文件布局

拟使用独立根 `/Users/jiangtao/coding/action-driver/thirdparty`。创建前核验目标不存在，若存在先读治理和 Git 状态，不覆盖。已有 `/Users/jiangtao/coding/chromium` 不作本期 checkout，不修改或重置它。

- `playwright/`：用户 Fork，分支 `codex/fork-baseline`。
- `electron/src/electron/`：用户 Electron Fork，分支 `codex/fork-baseline`；其余 `src/` 由 gclient 管理。
- `package.json`：独立 独立包边界，隔离 Action-Driver 根 type=module。
- `tools/depot_tools/`：构建工具，记录其 commit。
- `playwright/action-driver/baseline/manifest.json`：来源、上游与 Fork commit、Chromium revision、架构、配置、模块路径、二进制路径、校验值。
- `playwright/action-driver/baseline/electron-app/package.json` 和 `main.cjs`：独立 Electron 页面宿主。
- `playwright/action-driver/baseline/fixture.html`：本地点击与输入夹具。
- `playwright/action-driver/baseline/verify.mjs`：来源校验；`smoke.mjs`：兼容脚本与 CLI 入口。
- `playwright/action-driver/baseline/verify.test.mjs`：校验失败定向测试。
- `playwright/action-driver/baseline/README.md`：复现步骤及两套差异清单。
- 工具放 `tools/`；导出的构建产物和截图放 `build/`；下载包放 `downloads/`，日志放 `logs/`。上游要求原位生成的编译中间文件保留其原生布局，交付产物另行导出到 `build/`，不修改上游构建系统。

## Task 1: 获取并锁定独立源码

**Files:** 两个独立 checkout；本任务先输出构建工作区来源记录，后续写入 manifest。

**Interfaces:** Produces: 两个源码目录、确切基线 commit、Chromium DEPS revision、环境诊断记录。

- [ ] 核验目标目录和治理文件；确认不会改写已有工作。使用项目内 thirdparty 的独立 checkout，不增加 submodule；以本地 Git exclude 排除大型源码和产物。
- [ ] 获取 Playwright Fork，增加官方 upstream；基线 `v1.63.0` 已核验指向 `1b025d7e20a026371cd5f98ba0cdce48892737c8`，checkout 后用 `git rev-parse HEAD` 再核验，创建 `codex/fork-baseline`。
- [ ] 准备独立 depot_tools，记录 commit；在 electron 根使用 `gclient config --name src/electron --unmanaged https://github.com/jt-jiangtao/electron`，同步时显式指定 Electron 基线 revision，禁止先同步浮动 main。
- [ ] Electron 基线 `v38.8.6` 已核验 peeled commit 为 `fbc489c43be82f0fc331560ae678a39aeaea38c8`；用 `gclient sync --revision src/electron@fbc489c43be82f0fc331560ae678a39aeaea38c8 --with_branch_heads --with_tags` 获取依赖，随后核验 HEAD、DEPS 的 Chromium revision 与实际 Chromium checkout。
- [ ] 给 Electron checkout 增加 upstream，创建本期分支；分别记录 `git remote -v`、HEAD 和完整状态，确认无基线外行为差异。

## Task 2: 自有产物独立构建

**Files:** 独立工作区环境记录、两个 Fork 构建输出；不修改上游构建脚本。

**Interfaces:** Consumes: Task 1 源码与环境记录。Produces: 本地 playwright-core 模块入口、Electron.app 可执行文件、构建日志与校验值。

- [ ] 诊断 Node、Python、Xcode、磁盘和内存。规划时检测到 arm64、约 548 GiB 可用、Xcode 27、Python 3.9.6、默认 Node 20.14.0；这些不能代替实际构建前检查。
- [ ] 按锁定 Electron 文档准备 Node >=22.12.0 的独立环境与所需 SDK；不改变用户默认 Node。使用 session PATH 选择运行时；兼容 Xcode 需求以源码和构建诊断为准。
- [ ] 在 Playwright checkout 执行 `npm ci`、`npm run build`。用绝对路径加载 `packages/playwright-core`，断言导出 `_electron.launch`；无需下载官方浏览器来证明本期成功。
- [ ] 在 Electron `src/` 设置构建工具路径，执行 `gn gen out/Action-Driver --args='import("//electron/build/args/testing.gn") target_cpu="arm64"'`，随后 `ninja -C out/Action-Driver electron`；记录实际配置，允许增量续建，不替换源码基线。
- [ ] 运行 `out/Action-Driver/Electron.app/Contents/MacOS/Electron --version`；核验 arm64 二进制、版本、构建成功日志与 SHA-256。若失败区分工具链、源码和兼容问题，保留证据。
- [ ] 本期不扩展内核行为，不凭空添加宏接口；若运行兼容迫使修改 Chromium 行为或 Playwright 上游接线，先停止相关写入并重新裁决，再实施宏/目录规则及开关验证。

## Task 3: 来源核验与独立兼容夹具

**Files:** `playwright/action-driver/baseline/` 中列出的 manifest、校验脚本、测试、独立 app 与 HTML。

**Interfaces:** `verifyManifest(manifest: object): Promise<void>` 验证来源与文件完整性，错误时抛诊断异常；`runSmoke(manifest: object): Promise<object>` 返回操作断言、版本和截图路径；CLI 非成功返回非零退出码。

- [ ] 先在 `verify.test.mjs` 定义校验断言：不存在的 Electron 路径、错误 SHA-256、预期与实际源码提交不同、自有模块路径落在目标 checkout 外均拒绝；有效构建记录通过。
- [ ] 执行 `node --test action-driver/baseline/verify.test.mjs` 确认待实现校验失败，再实现 manifest 读取与 `verifyManifest`；重复该定向命令确认通过。不扫描任意全局安装寻找替代。
- [ ] manifest 写入 Task 1、2 的实际结果；版本组合以该文件的准确来源和运行版本共同核验，路径用绝对路径，不把版本字符串等同于自有构建证明。
- [ ] HTML 提供一个按钮、一个文本输入和结果区：按钮点击后结果为 `clicked`；输入 `Action-Driver baseline` 后页面值完全一致。server 监听动态 loopback 端口。
- [ ] 独立 Electron main 创建 BrowserWindow，先加载 about:blank，由 Playwright session 显式导航到夹具 URL，关闭最后一个测试窗口后退出。app 仅测试用途，不加载 Action-Driver。
- [ ] `runSmoke` 通过绝对本地模块路径加载 `_electron`，显式 `executablePath` 指向 Task 2 自编译二进制，启动独立 app；断言导航 URL、按钮结果和输入值，保存 PNG 并核验可解码且非零尺寸。
- [ ] 关闭页面并断言再次操作失败，验证测试进程退出；在 finally 中关闭 Electron 与 HTTP server。故意引入一个不存在的定位目标验证失败路径也清理资源。
- [ ] 执行 `node action-driver/baseline/smoke.mjs`；只有来源校验、全部操作断言、截图和清理均成功才输出成功与运行证据。

## Task 4: 差异审查与交付

**Files:** Fork 内 README、manifest 与独立根 build/logs；产品仓库只同步本期规划状态。

**Interfaces:** Consumes: Task 1–3 输出。Produces: 可复现构建步骤、准确差异清单、实际兼容验收报告。

- [ ] 对两个 Fork 分别检查相对 Task 1 上游 commit 的 `git diff`、已暂存与未追踪文件，确认 Playwright 自有文件全部在 action-driver；Electron 基线没有自有行为改动则明确记录零差异。
- [ ] 若裁决后有内核补丁，导出有序补丁并验证 ACTION_DRIVER 宏开关行为；上游 Electron 原有补丁与自有补丁分开列明。
- [ ] README 记录所有源码和工具 commit、环境、构建命令、manifest 校验与运行命令、截图及退出证据，注明仅 macOS arm64 实测。
- [ ] 按各 Fork 治理完成直接相关检查；产品没有代码改动，不为本期文档运行产品全量测试。准备提交时仅暂存本期文件，不推送或发布；记录各仓库提交和验证结果。
- [ ] 本仓库运行 `openspec validate implement-browser-use --strict` 与 `git diff --check`，更新任务完成状态须以实际证据为依据；全部验收完成才进入 archive。

## Self-Review

- 来源、构建、基础动作、生命周期、失败处理、宏和目录隔离分别由 Task 1–4 覆盖。
- 五项 Review Focus 分别由 Task 3 的路径/校验/清理/server 断言与 Task 4 的完整差异审查覆盖。
- 没有扩展接口或产品接入任务；编译与兼容运行仍待实施，不能将 tag 存在视为验收成功。

## References

- [Playwright v1.63.0 构建脚本](https://github.com/microsoft/playwright/blob/v1.63.0/package.json)
- [Electron v38.8.6 构建说明](https://github.com/electron/electron/blob/v38.8.6/docs/development/build-instructions-gn.md)
- [Electron v38.8.6 macOS 前置条件](https://github.com/electron/electron/blob/v38.8.6/docs/development/build-instructions-macos.md)
