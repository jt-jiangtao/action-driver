## Context

参见 `proposal.md` 的 Why。当前 Electron 主进程只创建安全的 `BrowserWindow`，没有显式设置应用名、窗口标题或原生图标；仓库已有 `design/assets/actiondriver-logo.svg`，但原生窗口接口对位图资源的支持更稳定。现有项目使用 electron-vite 构建，不包含安装包工具链。

## Goals / Non-Goals

**Goals:**

- 在开发启动和现有构建产物中统一 Electron 应用名、窗口标题与图标。
- 复用唯一品牌源，提供 Electron 可直接读取的 PNG 资源。
- 保持应用生命周期、依赖注入和窗口安全选项可单元测试。

**Non-Goals:**

- 不新增 electron-builder、Electron Forge 或安装包命令。
- 不生成代码签名、公证、`.icns`、`.ico` 或平台安装包元数据。
- 不修改 renderer 内的品牌布局或 Logo 组件。

## Decisions

### 使用显式应用身份常量

主进程使用单一 `ActionDriver` 常量设置 Electron app 名称和窗口标题，窗口配置接收解析后的图标路径。这样名称不会分散在生命周期代码和窗口工厂中，测试可以直接验证最终配置。

替代方案是只修改 `package.json` 的 `name`。该字段当前是 workspace 包标识 `@actiondriver/desktop`，既不适合作为用户可见名称，也不能可靠覆盖开发模式下的 Dock 和窗口身份，因此不采用。

### 从现有 SVG 生成并提交 PNG 运行时资源

将 `design/assets/actiondriver-logo.svg` 作为品牌源，生成方形高分辨率 PNG 并存放到 Desktop 自有资源目录。主进程通过基于应用目录的确定性路径读取它，BrowserWindow 与 macOS Dock 复用同一文件。

替代方案是直接向原生窗口传递 SVG。不同平台和 Electron 原生图像路径对 SVG 的处理并不一致，且 Dock 图标更适合位图，因此选择 PNG。另一替代方案是立即生成 `.icns` / `.ico` 并配置打包器；这会引入尚未批准的发行工具链和跨平台维护成本，用户已裁决本次不采用。

### Dock 设置采用能力检测

应用 ready 后仅在 `app.dock?.setIcon` 可用时设置 Dock 图标；其他平台继续创建窗口，不添加平台字符串分支。这样直接按能力降级，测试也能覆盖有无 Dock API 两种环境。

## Risks / Trade-offs

- [PNG 与 SVG 品牌源可能日后漂移] → 在文档中注明生成来源，并通过尺寸与文件存在性测试固定桌面资源契约。
- [当前没有安装包工具，PNG 不等于最终发行图标] → 明确作为运行时资源；`.icns`、`.ico` 与打包元数据在发行变更中处理。
- [应用路径在未来打包后可能变化] → 将路径解析集中在可测试函数中；引入打包器时只替换该边界，不修改窗口调用方。

## Migration Plan

1. 先增加应用身份与资源路径测试，确认当前实现因缺少品牌配置而失败。
2. 生成并登记 Desktop PNG 资源，实现名称、窗口标题、窗口图标和 Dock 能力检测。
3. 运行主进程单测、类型检查、构建和 Electron E2E；确认现有页面截图不受影响。
4. 若启动出现资源路径问题，回滚主进程品牌配置与新增 PNG，不影响 renderer 或用户数据。
