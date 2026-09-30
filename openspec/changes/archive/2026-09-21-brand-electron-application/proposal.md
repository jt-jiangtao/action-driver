## Why

当前渲染页面已经使用 Action-Driver 品牌，但 Electron 主进程仍沿用默认应用身份，导致系统菜单、窗口和 Dock 中的名称与图标不一致。需要把现有品牌资产延伸到桌面原生外壳，使开发运行与后续发行配置具有统一的应用身份。

Battle 已完成：用户确认应用名使用 `Action-Driver`，图标复用现有蓝紫色 Action-Driver Logo。已比较“仅完善现有 Electron 运行时身份”和“同时引入 electron-builder/Forge 打包体系”两种方案；最终选择前者，以最低风险完成当前可见目标，并将安装包格式、签名和平台专用发行图标留到独立的发行变更中。无未解决关键分歧。

## What Changes

- 将 Electron 应用名称、主窗口标题和页面标题统一为 `Action-Driver`。
- 参考用户提供的图标样式，将现有 Action-Driver 标志置于白色圆角方形底中，生成 Electron 可稳定加载的 PNG 图标，并作为受版本控制的桌面资源维护。
- 在主进程设置应用名称、窗口图标，并在 macOS 可用时设置 Dock 图标。
- 增加资源路径和窗口身份测试，验证开发构建与生产构建均能解析同一品牌资源。
- 不引入新的打包器，不处理安装包、代码签名、公证或 Windows `.ico` / macOS `.icns` 发行资产。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `desktop-shell`: Electron 原生外壳必须使用统一的 Action-Driver 名称与品牌图标启动。

## Impact

- 影响 `apps/desktop/src/main` 的应用生命周期与窗口配置。
- 增加桌面端品牌位图资源及其生成/校验方式。
- 更新主进程单元测试和 Electron 启动验证。
- 不新增运行时依赖，不改变 renderer、IPC、安全边界或现有页面交互。
