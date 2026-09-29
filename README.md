源码拉取与子仓库改动查看见 [Browser Fork 文档](docs/development/browser-forks.md)。

网络搜索与网页读取使用 Tavily / Jina；本地密钥与迁移说明见 [网络工具配置](docs/web-tools.md)。

### 自有 Electron 桌面宿主

标准 `pnpm dev`、`pnpm --filter @actiondriver/desktop preview`、本地 Electron E2E 和 macOS 打包使用 `thirdparty/build/electron/Electron.app`。来源记录在 `config/electron-fork.json`，共享解析入口在 `scripts/lib/electron-fork.mjs`；启动前核验完整 bundle、版本与架构。缺失或篡改会明确失败，不能回退 npm 下载的 Electron。npm electron 38.8.6 仍提供类型和构建元数据；不要直接运行裸 electron-vite 或 Electron npm CLI 来启动产品。

当前已验证 Electron 38.8.6 / Chromium 140.0.7339.249，macOS arm64。其他平台必须先构建并审核相应产物记录。二进制不提交到 Git；不同机器重建可能产生不同哈希，必须审核并更新记录，不能绕过校验。

源码位置为 `thirdparty/electron`（来源 jt-jiangtao/electron，提交 593df43ccabaf6ae642534c249cce0423ccb21c2），Chromium DEPS 基线 51dd6cfc5c0bb8a297725ae9270ca43fb0fcc8e2，Electron 上游补丁后提交 31c3b2fb7d154bd181fdf73ec6e9a6c36e38312f。工具集中在 `thirdparty/tools`，下载在 `thirdparty/downloads`，日志在 `thirdparty/logs`，导出产物在 `thirdparty/build`；Chromium 原位生成文件保留上游布局。

构建要求：项目内 Node 22.23.3、锁定 depot_tools、macOS SDK 26.5、Metal Toolchain。`src/out/ActionDriver/args.gn` 使用 Electron testing.gn、target_cpu="arm64"、mac_sdk_path="/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk"、enable_precompiled_headers=false。关闭 PCH 解决锁定 Clang GC 插件的文件级 pragma 兼容问题，GC 检查仍开启。

重建、导出和原生水印验证命令见 [Electron 水印文档](docs/development/electron-watermark.md)。导出必须同时更新 bundle 与来源记录，不能只复制文件。

开发前运行 `pnpm build:native:electron` 准备 SQLite Electron ABI binding。定向产品验证：`pnpm exec playwright test apps/desktop/tests/e2e/electron-fork-runtime.spec.ts`（先完成 Runtime 与 desktop build）。本地与打包集成命令仍为 `pnpm test:e2e:local`、`pnpm test:e2e:packaged:macos`，按仓库规则在提交前执行。包内保留 `actiondriver-electron-provenance.json`；其中哈希描述复制前的来源 bundle，重命名或签名后的包不能使用该哈希冒充包校验值。
