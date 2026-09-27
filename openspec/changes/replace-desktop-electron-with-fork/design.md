## Context

参见 proposal.md。桌面和根 package.json 均固定 electron 38.8.6；自编译产物也是 38.8.6 / Chromium 140.0.7339.249 / darwin-arm64。electron-vite 支持 ELECTRON_EXEC_PATH；现有 E2E 多处未指定 executablePath，打包脚本通过 require('electron') 找官方 bundle。SQLite 构建按 npm electron 元数据选 ABI。自有产物已导出 thridparty/build/electron/Electron.app，独立来源记录与 14 项验证已通过。

## Goals / Non-Goals

**Goals:** 统一桌面宿主来源，启动前拒绝错误产物；所有受维护的启动入口使用同一解析结果，真实验证产品运行与打包。

**Non-Goals:** 不修改桌面 UI、IPC、Agent 行为，不替换 Playwright 依赖，不设计内核扩展，不构建未验证平台的二进制，不分发正式签名安装包。

## Decisions

### 1. 统一产物解析

2026-09-27 用户裁决开发、测试、打包全部替换。以可跟踪的配置记录来源仓库、源码基线、版本、架构、构建参数和产物校验值；本机二进制目录继续忽略。共享解析器从项目位置解析路径，而非依赖 shell cwd。校验 executable、bundle 完整性、实际版本和平台架构，明确错误，不静默回退。消费记录独立于 Fork 测试 manifest，避免产品启动依赖测试目录或无关 Playwright 校验；源码允许后续自有提交，但必须可追溯构建基线，不能把 checkout 当前 HEAD 冒充构建来源。

替代方案为每个入口分别设置路径，容易漂移；或覆盖 node_modules/electron/dist，pnpm 重装会丢失。共享解析器可直接测试且保证一致性，因此选用。

### 2. 启动与测试接线

开发及预览使用仓库启动包装脚本：先解析校验产物，再给 electron-vite 子进程显式设置 ELECTRON_EXEC_PATH，保持原命令参数、cwd、热重载与退出状态传播。E2E 共享启动辅助入口，所有现有未指定路径的 electron.launch 均消费解析结果；packaged-runtime 保持启动已制作的 ActionDriver.app，并断言包内运行来源。保留 npm electron 包作为匹配版本类型与工具元数据，不使用其下载的二进制。调用下层裸 electron-vite 不是受支持入口，文档明确标准命令。

### 3. 打包与原生兼容

打包脚本复制解析器返回的自有 bundle，随后保留既有应用资源、重命名、签名流程。包内携带构建来源信息；包内执行路径与版本须实际验证。SQLite 同版本并不自动证明 ABI 兼容：在实际自编译宿主的 utility process 验证数据库加载和读写，记录 Electron Node ABI；已有 binding 不兼容则按当前原生构建链重新生成，不覆盖 pnpm 的 Node binding。

### 4. 平台与差异边界

当前只有 darwin-arm64 验证产物；其他平台或架构必须明确报缺失/不匹配，不回退官方宿主。自有运行时或依赖路径仅用于开发工具接线，不向产品用户增加内部实现选项。Chromium 源码与 Playwright 上游代码不变；本次产品接線不属于内核行为补丁，不需要制造 ACTION_DRIVER 宏代码。

## Risks / Trade-offs

- [版本一致但原生 ABI 或 utility process 行为不同] → 实际加载 SQLite 并验证任务持久化。
- [macOS 签名与权限身份影响 Computer Use] → 验证 bundle 签名、打包启动及现有权限处理；正式分发签名不在本期。
- [全目录校验增加启动耗时] → 测量真实开销，校验在入口执行而非每次热重载；不以放松来源校验换取速度。
- [本机产物不随 Git 分发] → 文档列出确切源码和复现命令，缺失时给出准备提示。
- [未验证平台] → 不声明通过；用户覆盖无。

## Migration Plan

先建立解析器和负向测试，再接开发/预览及 E2E，最后修改打包来源并验证。回滚本次接线提交即可恢复原启动入口，自有产物保留。当前工作区的基线规划和 docs/explorations 不混入本次提交。
