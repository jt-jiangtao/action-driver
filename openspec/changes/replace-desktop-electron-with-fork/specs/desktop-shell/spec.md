## ADDED Requirements

### Requirement: 桌面宿主来源一致
受支持的开发、预览、本地 Electron 端到端测试和 macOS 打包入口 MUST 使用已记录来源的自有 Electron 产物。系统 SHALL 在启动或制作包前校验产物来源、版本、平台架构与完整性；产物无效时 MUST 明确失败，不得自动回退官方二进制。打包应用 SHALL 保留可核验的构建来源记录，并保持现有桌面行为与进程隔离。

#### Scenario: 本地桌面启动
- **WHEN** 开发者使用标准开发或预览命令且自有产物有效
- **THEN** 桌面宿主使用记录的自有执行路径，显示现有 ActionDriver 窗口并加载 Agent Runtime

#### Scenario: 测试宿主一致
- **WHEN** 本地 Electron 端到端测试启动 ActionDriver
- **THEN** 测试使用同一自有宿主，不启动官方 Electron 包的二进制

#### Scenario: 打包来源一致
- **WHEN** 制作并启动 macOS ActionDriver 包
- **THEN** 包中的宿主来自校验通过的自有 bundle，运行版本与来源记录一致，现有资源与原生模块可用

#### Scenario: 缺失或错误产物
- **WHEN** 产物缺失、被修改，或版本、平台架构与记录不匹配
- **THEN** 入口报告具体原因及准备提示，并终止启动或打包

#### Scenario: 原生数据库兼容
- **WHEN** 自有宿主启动本地 Agent Runtime 并执行持久化操作
- **THEN** 原生数据库模块正确加载，数据可读写，且不会替换单元测试使用的 Node 原生模块
