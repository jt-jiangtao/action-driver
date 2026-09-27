## Context

参见 proposal.md。两个自有仓库已由用户提供。本期在项目内 `thridparty/` 下的 Fork 工作区操作，并在主仓库注册源码 submodule，不修改 ActionDriver 产品代码。原计划的产品内嵌浏览器与独立引擎 Provider 任务已推迟。

## Goals / Non-Goals

**Goals:**

- 锁定源码并编译自有 Playwright、Electron/Chromium。
- 用独立夹具证明两个自有产物能共同运行，生命周期和基础操作正常。
- 明确识别自有改动的来源、位置与隔离方式。

**Non-Goals:**

- 不接入 ActionDriver，不修改产品依赖、打包、面板或工具。
- 不设计或实现具体扩展接口、Action Graph、Agent 闭环、高亮或接管。

## Decisions

### 1. 真实双 Fork 与锁定基线

用户裁决使用 jt-jiangtao/playwright 和 jt-jiangtao/electron。记录确切 commit、Electron 所需 Chromium revision、构建配置、架构和产物 SHA-256，不使用浮动 main 作为验收来源。现有产品依赖只作为基线选择参考，不能推断兼容已通过。

替代方案为官方二进制先跑通；不能证明自有构建，故本期直接编译。若兼容失败需要重大版本或边界调整，先报告证据并重新裁决。

### 2. Electron 管理 Chromium 补丁

Electron 构建链获取 Chromium，自有内核差异由 Electron Fork 的补丁队列追踪。源码位于直属 `thridparty/playwright/` 与 `thridparty/electron/`，后者的 gclient 工作区为 `thridparty/build/electron-workspace/`；工作区内 `src/electron` 是独立构建检出，不是主仓库 submodule。工具集中到 `thridparty/tools/`；导出产物和截图放 `thridparty/build/`，下载包放 `thridparty/downloads/`，日志放 `thridparty/logs/`。上游要求原位生成的中间文件保持原生布局。`thridparty/package.json` 仅声明独立包边界，防止 Chromium 原生脚本继承产品根的 type=module，不增加依赖或修改上游源码。

替代方案为额外维护完整 Chromium 仓库；本期没有独立 Chromium 发布目标，增加同步成本，故不采用。

构建兼容配置：macOS 使用 `enable_precompiled_headers = false`，保留 Blink GC 静态检查。锁定工具链加载 PCH 时未恢复上游 `GC_PLUGIN_IGNORE_FILE` 的插件状态，导致 HashTable 内部字段误报；同一目标移除 PCH 后通过。该开关不改变运行行为或源码边界，代价为相关文件重编及编译速度下降。

### 3. 独立兼容夹具

链路为独立测试脚本 → 自有 Playwright → 自有 Electron/Chromium 测试页面。测试页面仅载入确定性本地夹具，验证导航、点击、输入、截图和关闭；不加载或改造 ActionDriver。

Playwright 验证会话与页面生命周期，独立 Electron 程序提供测试宿主。两套自有产物必须同时参与验收。使用其中任一官方产物的测试不能代替最终兼容验收。

### 4. 改动隔离

Chromium 自有行为代码必须在 ACTION_DRIVER 平台宏条件内，关闭宏保持上游路径；非 C++ 构建接线用对应开关隔离。Playwright 自有实现必须放在自有目录。

相对锁定上游的差异须逐项列明来源与理由。必要上游接线不能自动豁免目录约束，遇到具体冲突先裁决。无扩展行为时如实记录零差异，不制造示例接口。

替代方案为构建时隐式注入未列明改动；难以审查，不采用。

### 5. 来源与兼容验收

测试记录两套实际加载路径、确切源码版本、构建配置与校验值；缺失、校验错误或组合不匹配明确失败，不静默回退官方产物。验证页面变化、截图内容与关闭后的页面及进程清理。未运行的架构不声明通过。

### 6. 主仓库追踪 Fork 源码

用户已裁决使用两个直属 Git submodule：thridparty/playwright 与 thridparty/electron，来源分别为 jt-jiangtao/playwright 与 jt-jiangtao/electron。主仓库记录 gitlink 的确切提交与 .gitmodules URL；不跟随浮动 main，不纳入 Chromium、工具、下载或构建产物。

原嵌套布局虽通过远端递归 clone，但 Chromium 中间 Git 仓库导致 Electron 的 --show-superproject-working-tree 返回空。替代方案是在编辑器显式添加嵌套仓库，仍不能修正 Git 所属主仓库识别，因此用户确认迁移到直属布局。

原 gclient 工作区移动到 thridparty/build/electron-workspace；原 Electron 源码检出移至 thridparty/electron，保留其分支、未提交文件与主仓库 .git/modules/electron 元数据，修正 .git 相对指针与 core.worktree。构建工作区中的 src/electron 使用独立 Git 检出，维持上游 DEPS、patches/config.json 和 GN 依赖的相对结构。不使用源码目录符号链接或共享 Git 工作树元数据，以免构建 hooks 修改直属源码或主仓库指针。

直属 Electron submodule 是自有源码的事实来源。准备构建时显式将已提交源码同步到独立检出并核对 HEAD；未提交源码不能冒充锁定构建来源。独立检出有用户修改或提交不匹配时必须明确报告，不通过 reset、clean 或强制 checkout 处理。构建检出配置对应 Fork origin，不能隐式跟随 main。

新检出使用 git clone --recurse-submodules；已有检出使用 git submodule update --init --recursive。这些命令只获得两个 Fork 源码，Chromium 与工具链仍独立同步。首次构建工作区准备必须避免 gclient 首次 clone 失败自动搬迁非空 src 的路径，保护独立 Electron 检出。

更新主仓库指针前核验提交在 Fork 远端可获取；独立检出验证两条 mode 160000、origin、锁定 HEAD，以及两个源码仓库的 --show-superproject-working-tree 均返回 ActionDriver 主仓库路径。记录路径迁移，原历史验证保留为旧布局证据，不能冒充新布局验收。

来源校验器、相关定向测试及构建文档同步使用直属源码和新 Chromium 工作区路径；来源提交与导出 bundle 位置、哈希不因目录迁移自动改变。既有 Electron 宿主接入行为由 replace-desktop-electron-with-fork 管理，本次仅调整相关路径接线，不扩展运行行为。

## Risks / Trade-offs

- [迁移导致绝对路径缓存失效] → 保留 Chromium 提交、补丁、out 和导出 bundle，运行必要 GN 配置及定向构建检查，不宣称零重编。
- [源码与独立构建检出漂移] → 构建前显式核对两者 HEAD，拒绝静默消费不同提交或覆盖工作区改动。
- [源码移动后 .git 相对指针失效] → 修正指针与 core.worktree，验证 origin、分支、status 和所属主仓库路径。

- [Chromium 初次构建时间与磁盘成本高] → 先诊断工具链和空间，保留构建记录与缓存；下载源码不算构建成功。
- [Playwright 与 Electron 版本组合不兼容] → 用独立夹具收集证据；重大变更重新裁决。
- [宏和目录隔离与接线冲突] → 逐项审查，不隐式放宽要求；产生行为补丁时验证宏开关两种配置。
- [本期维护两套 Fork 超出初始分阶段建议] → 用户已选择双 Fork；通过排除产品接入和接口扩展限制范围。
- [现有产品工作区存在无关改动] → 仅更新本期规划和源码注册相关文件，不覆盖或提交无关工作。

## Migration Plan

布局修订实施顺序：记录并核验现有源码、补丁、.git 指针和产物；迁移工作区与直属源码，修正 Git 元数据及主仓库注册；准备同提交独立构建检出；更新来源校验路径和文档；验证直属主仓库识别、递归拉取、源码一致及构建接线。先检查目的路径无冲突，不覆盖既有目录。失败时按记录恢复目录与 Git 指针，保留构建缓存和独立导出产物。


1. 用户审查书面规划，形成详细执行计划并选择执行方式。
2. 读取两个 Fork 的治理文件，获取独立源码基线，锁定提交。
3. 准备构建环境，编译两套自有产物。
4. 使用独立夹具完成兼容验证和来源审查。
5. 交付复现步骤、差异清单与实际运行证据。

回滚仅涉及 Fork 的本期提交与夹具，产品无需迁移。产品接入和具体扩展接口另行规划。
