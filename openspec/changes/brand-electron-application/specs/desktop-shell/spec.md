## MODIFIED Requirements

### Requirement: 启动桌面应用
系统 SHALL 以名称为 `ActionDriver` 且使用现有 ActionDriver 品牌图标的 macOS 桌面窗口启动，并默认显示 ActionDriver 首页，不打开外部浏览器窗口。应用名称 SHALL 在 Electron 应用身份、主窗口标题和页面标题中保持一致；在 macOS Dock API 可用时，系统 SHALL 使用同一品牌图标。

#### Scenario: 首次启动
- **WHEN** 用户启动 ActionDriver
- **THEN** 系统在单一桌面窗口中显示首页及左侧导航

#### Scenario: 原生应用身份
- **WHEN** Electron 主进程初始化应用与主窗口
- **THEN** 应用名称和窗口标题显示为 `ActionDriver`，窗口图标使用随应用提供的 ActionDriver 品牌位图

#### Scenario: macOS Dock 品牌
- **WHEN** 应用在提供 Dock API 的 macOS 环境完成初始化
- **THEN** Dock 使用与主窗口一致的 ActionDriver 品牌图标

#### Scenario: 非 macOS 环境
- **WHEN** 应用运行环境不提供 Dock API
- **THEN** 应用仍正常创建主窗口，且不会因缺少 Dock API 而启动失败
