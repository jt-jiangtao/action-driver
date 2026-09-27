## ADDED Requirements

### Requirement: 自有 Electron 原生开发水印
自有 macOS Electron SHALL 在开发构建默认显示原生全屏斜向平铺水印 action-driver-dev；其他自有构建 SHALL 仅在携带 --action-driver-watermark 启动参数时显示。开发构建指启用 ACTION_DRIVER 且非官方构建。水印 SHALL 使用轻量透明度（初值 5%），MUST NOT 添加右下角标签或版本号，MUST NOT 修改网页 DOM 或 Electron 上游版本号。关闭 ACTION_DRIVER 的构建 MUST 保持上游显示行为。

#### Scenario: 自有开发版默认显示
- **WHEN** 用户启动启用 ACTION_DRIVER 的非官方 macOS 构建且未传水印参数
- **THEN** 窗口内容区域显示 action-driver-dev 平铺水印，没有右下角标签

#### Scenario: 其他自有构建参数开启
- **WHEN** 用户启动启用 ACTION_DRIVER 的官方构建
- **THEN** 仅在携带 --action-driver-watermark 时显示同一水印，未携带时不显示

#### Scenario: 平台宏关闭
- **WHEN** 用户启动未启用 ACTION_DRIVER 的构建，无论是否携带水印参数
- **THEN** 不显示自有水印，上游基础路径保持正常

#### Scenario: 页面交互和窗口变化
- **WHEN** 水印显示时用户点击、输入、滚动、导航、调整窗口尺寸或切换全屏
- **THEN** 页面交互正常，标记继续铺满内容区域，关闭窗口后覆盖层资源释放

### Requirement: 自有 Electron 重建打包可复现
交付文档 MUST 记录水印构建开关、启动参数、修改源码后的重建、产物导出、来源记录更新与打包验证步骤。可见水印 MUST NOT 被描述为源码或产物完整性的证明。

#### Scenario: 重建并使用新宿主
- **WHEN** 用户依照文档修改 Electron 并重新构建导出
- **THEN** 可更新匹配的来源记录并通过现有桌面及打包入口使用新产物，保留源码提交和哈希验证

#### Scenario: 水印视觉验收
- **WHEN** 用户验证原生水印
- **THEN** 文档要求使用窗口截图及实际运行来源，说明 Playwright 页面截图不能作为原生水印有无的唯一证据
