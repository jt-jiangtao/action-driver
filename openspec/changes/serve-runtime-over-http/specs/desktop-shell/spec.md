## MODIFIED Requirements

### Requirement: 使用安全的渲染边界
系统 MUST 隔离桌面主进程与页面渲染环境。页面 SHALL 通过 Electron Main 注入的服务端地址与访问凭据，使用 HTTP 与 WebSocket 访问服务端能力；页面 MUST NOT 直接接触文件系统、数据库路径、模型供应商凭据或本地服务端的进程与端口管理，Main MUST NOT 代替服务端持有会话数据、配置或模型凭据。

#### Scenario: 页面访问桌面能力
- **WHEN** 页面需要读取配置或运行会话
- **THEN** 页面使用注入的服务端地址与凭据访问 HTTP 与 WebSocket 接口，不直接访问 Node.js 或 Electron 原始 API

#### Scenario: 服务端随应用启动
- **WHEN** 应用启动
- **THEN** Electron Main 启动并监督本地服务端，就绪后把地址与访问凭据交给页面

#### Scenario: Main 只承载本机独占能力
- **WHEN** Agent Loop 需要执行 Browser 或 Computer 动作
- **THEN** 服务端通过客户端出站连接请求 Main 执行，Main 不承担会话数据写入或模型请求

#### Scenario: 页面不获得敏感引用
- **WHEN** 页面检查可用的桌面接口
- **THEN** 页面无法访问数据库路径、本地服务端的进程引用、模型供应商凭据或任意通用 IPC 通道

#### Scenario: 沙箱渲染进程加载桥接脚本
- **WHEN** 主窗口在启用沙箱的渲染进程中加载预加载脚本
- **THEN** 桥接脚本以受支持的形式加载成功并暴露服务端地址与凭据，页面读不到未声明的桌面接口
