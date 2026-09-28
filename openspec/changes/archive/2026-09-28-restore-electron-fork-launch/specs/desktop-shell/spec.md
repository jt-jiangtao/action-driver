## ADDED Requirements

### Requirement: 桌面入口使用已验证的 Electron Fork
macOS arm64 桌面的开发、预览、自动化测试与打包入口 SHALL 使用同一已验证的自有 Electron Fork 产物。系统 MUST 在产物缺失、来源记录不匹配、版本或架构错误时明确失败，MUST NOT 静默回退到依赖安装的官方 Electron。

#### Scenario: 启动开发桌面应用
- **WHEN** 用户通过项目开发命令启动桌面应用且自有产物与来源记录匹配
- **THEN** Electron 主进程的可执行文件来自自有 Fork 产物

#### Scenario: 产物无效
- **WHEN** 自有产物不存在或校验失败
- **THEN** 启动在创建桌面窗口前失败并报告校验问题，不运行官方 Electron

#### Scenario: 打包桌面应用
- **WHEN** 用户执行 macOS 桌面打包验证
- **THEN** 打包宿主来自同一已验证 Fork，包内保留来源记录

### Requirement: 自有 Electron 原生开发水印
自有 macOS Electron SHALL 在启用 ACTION_DRIVER 的非官方开发构建中默认显示原生全屏斜向平铺的 `action-driver-dev` 水印，初始透明度为 5%。水印 MUST NOT 修改网页 DOM 或截获页面交互。官方自有构建仅在传入 `--action-driver-watermark` 时显示；未启用 ACTION_DRIVER 的构建不显示自有水印。

#### Scenario: 开发窗口显示水印
- **WHEN** 用户以已验证的自有开发 Fork 启动 ActionDriver
- **THEN** 原生窗口内容区域显示平铺的 `action-driver-dev` 水印，且点击、输入与滚动仍正常

#### Scenario: 验收水印来源
- **WHEN** 用户验证水印
- **THEN** 验收同时检查实际主进程路径及原生窗口截图，不只依据网页页面截图
