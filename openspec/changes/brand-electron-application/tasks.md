## 1. 品牌资源

- [x] 1.1 为桌面品牌资源路径和 PNG 文件契约编写失败测试，验证资源缺失或尺寸不符时测试失败
- [x] 1.2 参考用户提供的白底圆角样式，以 `design/assets/actiondriver-logo.svg` 为标志源生成 Desktop 方形 PNG，并验证文件可读取、尺寸合规且人工预览构图正确

## 2. Electron 原生身份

- [x] 2.1 为应用名、窗口标题和窗口图标配置编写失败测试，验证最终 BrowserWindow 选项统一使用 `ActionDriver` 与品牌资源路径
- [x] 2.2 实现单一应用身份常量与资源路径解析，接入主进程和窗口配置，并运行主进程单测与类型检查
- [x] 2.3 为有无 Dock API 两种环境编写测试并实现能力检测，验证 macOS Dock 可设置图标且其他环境不抛错

## 3. 集成验证

- [x] 3.1 运行完整单测、类型检查、Lint、Build 和 Electron E2E，验证应用仍正常启动且页面基准未发生非预期变化
- [x] 3.2 运行 OpenSpec strict validation 和 `git diff --check`，核对实现仅包含已裁决的运行时品牌范围并提交到 `main`
