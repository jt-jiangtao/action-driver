## Purpose

定义产品在包发布、桌面展示、运行时连接与仓库记录中的统一名称，使开发者和用户看到同一品牌，并明确旧名称不兼容时的可观察行为。

## ADDED Requirements

### Requirement: 使用统一产品名称
系统 SHALL 在用户可见的桌面应用、窗口、授权提示和文档中使用 `Action-Driver`，在可使用连字符的机器标识中使用 `action-driver`。npm 作用域 SHALL 为 `@action-driver`，插件脚手架命令 SHALL 为 `npm create action-driver-plugin`。受语法限制的标识符 SHALL 使用合法且语义明确的名称，不得保留旧品牌拼写。

#### Scenario: 开发者安装与生成插件
- **WHEN** 开发者使用新作用域导入公共包并运行插件脚手架
- **THEN** 包解析和生成流程使用统一名称，产物不引用旧作用域

#### Scenario: 用户启动应用
- **WHEN** 用户启动桌面应用并查看窗口、Dock 与授权提示
- **THEN** 展示的应用名称一致为 `Action-Driver`

### Requirement: 使用统一运行时身份
应用 SHALL 在自定义协议、IPC 通道、环境变量、原生 helper 身份、文件路径与观测标识中使用与新名称一致的标识；对外的旧名称入口 SHALL 不再作为别名提供。

#### Scenario: 新版本内部连接
- **WHEN** 桌面端、Runtime 与原生 helper 通过各自入口通信
- **THEN** 各端使用同一组新标识，通信正常完成

#### Scenario: 旧名称入口
- **WHEN** 调用方使用旧名称的包、命令或协议入口
- **THEN** 新版本不把旧入口自动映射到新入口

### Requirement: 明确不迁移旧本地数据
系统 MUST NOT 为本次更名提供旧数据目录、设置、系统授权或插件身份的自动迁移与别名。新版本 SHALL 在新名称对应的位置建立所需状态。

#### Scenario: 首次启动新版本
- **WHEN** 本机仅有旧名称对应的应用数据和系统授权
- **THEN** 新版本使用新位置和新身份初始化，旧状态不被自动读取或复制
