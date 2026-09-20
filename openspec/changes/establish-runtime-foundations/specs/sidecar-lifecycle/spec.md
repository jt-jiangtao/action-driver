## Purpose

定义 ActionDriver 桌面进程管理本地 Agent Service 的生命周期行为，确保普通用户无需安装 Docker 或手工启动服务即可稳定使用应用。

## ADDED Requirements

### Requirement: 应用自动启动本地 Agent Service
系统 SHALL 在桌面应用启动时自动启动与当前应用版本和 macOS 架构匹配的本地 Agent Service，并在服务就绪前拒绝运行 Agent 命令。

#### Scenario: 正常启动
- **WHEN** 用户启动已安装的 ActionDriver
- **THEN** 桌面进程启动随应用分发的 Agent Service，并在服务通过健康检查后开放 Agent 命令

#### Scenario: 服务尚未就绪
- **WHEN** 用户在 Agent Service 完成就绪检查前提交目标
- **THEN** 系统返回可识别的暂不可用结果，而不是静默丢弃命令或启动第二个服务实例

### Requirement: 单窗口组共享单一 Sidecar 实例
系统 MUST 让同一桌面应用进程中的所有窗口共享单一 Agent Service 实例，不得为每个窗口或 Renderer 分别启动 Sidecar。

#### Scenario: 创建附加窗口
- **WHEN** 桌面应用创建附加窗口
- **THEN** 新窗口复用现有 Agent Service 连接，Sidecar 进程数量保持不变

### Requirement: 监督 Sidecar 异常退出
系统 SHALL 检测 Agent Service 的意外退出，并将运行时标记为不可用；重启尝试 MUST 有明确上限，不能形成无限重启循环。

#### Scenario: Sidecar 在任务执行中退出
- **WHEN** Agent Service 在处理任务时意外退出
- **THEN** 桌面进程停止发送新命令、终止失效连接，并向调用方返回带原因的运行时不可用状态

#### Scenario: 连续启动失败
- **WHEN** Sidecar 在限定时间内连续超过允许的重启次数
- **THEN** 系统停止自动重启并保持可诊断的失败状态

### Requirement: 应用退出时受控关闭 Sidecar
系统 SHALL 在桌面应用退出时请求 Agent Service 完成受控关闭，并在超时后终止遗留进程与清理本次运行的套接字文件。

#### Scenario: 正常退出应用
- **WHEN** 用户退出 ActionDriver
- **THEN** 系统停止接收新命令、等待进行中的本地写入结束、关闭 Agent Service 并移除运行时套接字

### Requirement: 生产环境无需 Docker
系统 MUST 将可运行的 Agent Service 随生产版 macOS 应用分发，最终用户无需安装 Go、Docker 或其他开发工具。

#### Scenario: 离线启动生产应用
- **WHEN** 用户在未安装 Docker 和 Go 的 macOS 设备上启动 ActionDriver
- **THEN** 本地 Agent Service 能够从应用包内启动并完成就绪检查
