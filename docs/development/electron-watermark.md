# 重建带原生水印的 Electron

水印位于 Electron macOS 原生窗口层，内容为 `action-driver-dev`，斜向平铺、透明度 5%。它不修改网页 DOM 或上游版本号；当前 Electron 版本仍为 38.8.6。水印是视觉标记，源码提交、产物哈希和运行路径才是来源校验依据。

## 构建策略

GN 参数 `action_driver = true` 在 macOS 启用 `ACTION_DRIVER`。非官方构建同时启用 `ACTION_DRIVER_DEVELOPMENT`，默认显示水印。自有官方构建仅传 `--action-driver-watermark` 时显示。`action_driver = false` 默认关闭，不编译自有覆盖层，即使传参数也不显示。其他平台未实现水印。

修改位置为 `thridparty/electron/shell/browser/ui/cocoa/action_driver`、受宏保护的 `electron_ns_window.h/mm` 和 GN 接线。测试夹具在 `thridparty/electron/action_driver/watermark`。

## 修改与重建

先在直属源码 `thridparty/electron` 定向验证并提交；独立构建检出 `thridparty/build/electron-workspace/src/electron` 必须保持干净。依赖准备和源码同步参见 [browser-forks.md](browser-forks.md)。同步已提交源码：

```sh
(
  set -e
  test -z "$(git -C thridparty/electron status --porcelain)"
  test -z "$(git -C thridparty/build/electron-workspace/src/electron status --porcelain)"
  git -C thridparty/build/electron-workspace/src/electron fetch "$PWD/thridparty/electron" HEAD
  git -C thridparty/build/electron-workspace/src/electron checkout --detach FETCH_HEAD
)
```

更新 `config/browser-forks.lock.json` 中 Electron 的 commit，使其与直属源码及主仓库 submodule 指针一致。在 `src/out/ActionDriver/args.gn` 保留既有 SDK、CPU 和测试配置，加入 `action_driver = true`；不要直接覆盖已有参数。

从项目根运行：

```sh
(
  set -e
  ulimit -n 65536
  export PATH="$PWD/thridparty/build/electron-workspace/src/buildtools/mac:$PWD/thridparty/build/electron-workspace/src/third_party/ninja:$PWD/thridparty/tools/node-v22.23.3-darwin-arm64/bin:$PATH"
  cd thridparty/build/electron-workspace/src
  gn gen out/ActionDriver
  ninja -C out/ActionDriver -j8 electron
)
```

当前机器使用 macOS SDK 26.5、arm64。构建依赖尚未完成全新机器端到端验证；submodule 不包含 Chromium、工具链或构建产物。

## 导出和启动

退出正在运行的 ActionDriver，再从项目根执行：

```sh
node scripts/export-electron-fork.mjs
pnpm --filter @actiondriver/desktop dev
```

导出工具要求两个 Electron 检出均干净、提交和远端与锁文件匹配，Chromium 基线有效且 `ninja -n electron` 无待构建工作。它核对实际版本、平台、架构和 `action_driver=true`，生成提交、源码树、补丁、GN 参数及 bundle 哈希记录。

工具同时替换 `thridparty/build/electron/Electron.app` 和 `config/electron-fork.json`；失败回滚匹配的旧包与记录，成功后将旧匹配对保留在日志显示的 `backup-*` 目录。并发导出会被拒绝。导出后必须重启应用，已经运行的进程不会自动切换内核。

共享解析器用于开发启动、桌面 E2E 和打包入口；缺失、版本或哈希不匹配时失败，不回退官方 Electron。

## 验证与打包

定向验证：

```sh
node --test thridparty/electron/action_driver/watermark/native.test.mjs
node --test tests/unit/scripts/lib/export-electron-fork.test.mjs
node thridparty/electron/action_driver/watermark/verify-electron.mjs "$PWD/thridparty/build/electron/Electron.app/Contents/MacOS/Electron"
pnpm exec playwright test apps/desktop/tests/e2e/electron-fork-runtime.spec.ts
```

原生交互夹具覆盖点击、输入、滚动、导航、内容视图替换、缩放及全屏；AppKit 测试覆盖资源释放与不拦截事件。原生窗口截图位于忽略目录 `thridparty/build/verification/watermark`。Playwright 的页面截图不会包含原生覆盖层，不能单独判断水印有无；使用 macOS 窗口截图并核对实际 `process.execPath`。

准备提交时运行仓库要求的 typecheck、lint、test，以及必要的本地与打包 E2E。打包验证命令为：

```sh
pnpm test:e2e:packaged:macos
```

打包脚本从校验后的自有 Electron.app 复制宿主，将来源记录写入包内 `Contents/Resources/actiondriver-electron-provenance.json`，再加入桌面及运行时资源。该命令生成临时 smoke 包并验证，不是安装包发布命令。开发内核被打包后仍默认显示水印；需要无默认水印的自有发行版应另建官方配置并重新导出。

## 当前本地交付

Electron 源码提交：`593df43ccabaf6ae642534c249cce0423ccb21c2`。已完成自有宏开启构建、宏关闭窗口翻译单元编译、三种策略测试，以及实际 ActionDriver 窗口截图；未构建完整宏关闭或官方配置二进制。源码提交尚未推送远端，新机器不能仅靠主仓库指针获取这个本地提交。发布 Fork 提交后才可承诺递归拉取可用。
