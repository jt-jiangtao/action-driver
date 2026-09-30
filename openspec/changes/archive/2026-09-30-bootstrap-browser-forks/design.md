## Context

参见 proposal.md。现有布局为直属 thirdparty/playwright、thirdparty/electron，以及 thirdparty/build/electron-workspace。源码 submodule 已注册但尚未提交；Playwright action-driver 夹具尚未提交。现有 Electron 构建依赖本机 .gclient、args.gn、thirdparty/package.json、Node 22.23.3、depot_tools 41c9bd890277c2f551499d171d215dfdf5dab97d、macOS SDK 26.5 与 Metal Toolchain。

现有 scripts/lib/electron-fork.mjs 读取 config/electron-fork.json，其中混合了锁定源码、构建参数、本机补丁后 Chromium commit 与 bundle 哈希；不能将旧机器记录直接作为新机器重建结果。scripts/test-packaged-macos.mjs 已涵盖 Electron 原生 SQLite binding、Computer Use helper、Runtime 和桌面构建及打包运行验收，可复用。scripts/build-electron-native.mjs 使用 node-gyp@11 范围版本，完整工具输入需要锁定确切解析版本。

## Goals / Non-Goals

**Goals:** 只依赖 Git 可获取的源码与配置，以及明确列出的系统前置条件，完成真实双 Fork 构建和桌面打包；阶段失败可定位和恢复，保留用户修改。

**Non-Goals:** 不保证二进制逐字节一致，不自动升级系统 Xcode 或安装系统 SDK，不扩展 Windows/Linux，不新增远程构建服务、浏览器控制接口或水印行为。水印构建开关读取已批准配置，其实现仍由独立变更管理。

## Decisions

### 1. 锁定输入与本机输出分离

新增受 Git 管理的构建输入锁定记录与 gclient/GN/包边界模板，涵盖 Fork 提交、Chromium DEPS 基线、depot_tools 提交、Node 获取地址和校验值、包管理器版本、SDK/Metal 前置条件及 GN 参数。源码提交以主仓库 gitlink 为事实来源，配置声明必须与其一致；不维护互相漂移的两套版本。

本机路径、补丁后实际 Chromium HEAD、产物哈希和阶段状态属于构建输出，记录在被忽略的 thirdparty/build 下。来源生成只在显式构建导出阶段执行，启动时只核验，不能重算哈希自动接受篡改。共享解析器改为核验锁定输入与本机生成来源记录，保留版本、架构、完整 bundle、路径边界和源码来源检查；无来源记录明确失败，不回退官方产物。

替代方案是保留固定本机哈希为所有机器的输入，重建差异会使正常产物启动失败，故不采用。补丁后 Git commit 可能受应用方式影响；验收应记录实际 HEAD，并核对 DEPS 基线、受 Git 管理的补丁队列及应用结果，不能仅复制旧机器 commit。来源记录不是防伪签名。

### 2. 分阶段统一入口

提供 node scripts/build-browser-forks.mjs，阶段为 prepare、sync、build、export、verify、package，另有 all 顺序执行。支持指定并发及从失败阶段继续；默认沿用已验证 -j8 和文件句柄上限 65536。从任意调用目录解析项目根目录，不写用户的 HOME 或全局包管理器配置。

prepare 验证 macOS arm64、系统工具、磁盘与 SDK/Metal；将项目专用 Node 和锁定 depot_tools 安装到 thirdparty/tools，并生成 thirdparty/package.json 包边界。已有边界或配置与模板冲突时报告，不静默覆盖。下载校验失败不得进入解包或后续构建；系统条件缺失时给出可执行准备命令，不静默改装系统工具。

sync 初始化并核验两个源码 submodule，在独立工作区创建同提交 Electron 检出，先初始化 Chromium Git 再运行锁定 gclient，避免首次 clone 失败自动搬迁非空 src。拒绝用户工作树改动或不匹配配置，不执行强制清理。独立 Electron 检出的依赖安装与 Playwright 安装遵循各自锁文件和治理要求。

build 生成 GN 参数并编译 Electron，构建 Playwright；export 导出真实产物并生成来源记录；verify 执行双 Fork 基础操作和完整性验证；package 复用当前桌面依赖安装、原生模块、Runtime、桌面及 macOS 打包验收流程。每阶段记录输入摘要、命令、退出状态、日志和输出，失败停止后续阶段。恢复前重新验证输入和产物，不信任仅有成功标记的缓存。

替代方案为只提供手工文档，难以检测隐藏本机输入；全量 vendoring 工具和二进制则膨胀仓库并掩盖源码构建。用户确认统一入口和按需下载，保持忽略可再生输出。

### 3. Git 内容边界

主仓库保留入口、锁定记录、模板、来源验证、依赖锁文件及构建文档。两个 Fork 保留自有源码、补丁和 Playwright 验收夹具，主仓库锁定其远端可获取提交。Chromium、工具、node_modules、out、dist、下载缓存、二进制、本机 manifest 与日志继续忽略；每一项都有确定的获取或生成步骤。

不把未提交的本机夹具当作新机器已存在内容。为必要 Fork 改动形成独立提交；发布相应 Fork 提交后才能验收主仓库远端递归拉取，不将本地 Git URL 替换验证宣称为最终远端验收。

### 4. 全新工作区验收

最终使用仅包含获准提交的主仓库全新检出，通过真实 Fork 远端初始化，不复制现有 thirdparty、node_modules、out 或 dist。可以使用系统已安装 Xcode/SDK/Metal，但须记录版本与路径；缺少条件应报告，不能用现有构建代替。

成功标准为双 Fork 实际编译、独立基础操作、原生 ABI 验证和桌面打包启动全部通过。当前后台 Electron 重编只提供迁移验证，不能满足新工作区验收。提交前全量测试按仓库规则执行一次，已知无关失败如实记录，定向测试用于迭代。

## Risks / Trade-offs

- [首次下载与编译耗时、空间大] → 阶段日志与可恢复入口，明确并发设置；只在完整验收时做全新构建。
- [外部仓库、CIPD 或包源不可用] → 固定来源与版本，记录失败阶段，不自动切换未审核镜像或浮动版本。
- [重新生成来源掩盖篡改] → 生成仅由显式 export 执行，启动与 verify 保持只读核验，测试缺失和篡改拒绝行为。
- [独立检出与主源码漂移] → 核验已提交 HEAD、补丁队列和 dirty 状态，不自动清理或覆盖用户工作。
- [SDK/Metal 无法通过普通下载完全自动准备] → 把系统条件列为明确前置条件，缺失时停止并提供准备方式，不声称零环境要求。
- [Fork 自有提交尚未发布] → 最终真实远端验收前报告阻塞，不擅自推送或以本地克隆冒充。

## Migration Plan

先形成详细执行计划；固化输入与模板；实现和定向测试阶段入口；调整来源生成与读取；提交必要 Fork 内容并确保远端可获取；在最终提交验证阶段完成全新检出构建与打包。旧产物保留，只有新产物核验通过后才启用其来源记录。回滚恢复旧解析器和匹配记录，不删除用户源码或缓存。

## Archive Decision (2026-09-30)

### Decisions

- 最终方向：按用户明确裁决直接归档本变更，保留 4/17 的历史任务状态，不实施剩余任务，也不同步 1 份 delta spec。
- 对比过的替代方案：先审计当前代码与各变更的依赖，完成仍有效的任务、同步规范后再逐项归档。该方案可减少遗留缺口，但需要继续执行用户现已取消的工作。
- 用户覆盖：此前建议先审计并完成有效项；用户随后明确改为整体归档，并确认当前无任务要执行。

### Risks / Trade-offs

- 未完成任务不会因归档而完成；如需这些功能，必须重新立项和验证。
- Delta spec 留在历史归档中，不作为主规范当前要求；归档不删除其他工作树中的未提交文件。
