## ADDED Requirements

### Requirement: 宿主无关的启动与生命周期

系统 SHALL 提供不依赖 Electron `parentPort` 的 Runtime 启动装配，并通过宿主生命周期端口完成就绪上报与关闭传播。Runtime MUST NOT 因宿主不是 Electron 而拒绝启动。Electron utility process 与纯 Node 进程 SHALL 使用同一套装配，只替换宿主适配器；外层协议、工具语义与事件顺序 MUST NOT 随宿主变化。

#### Scenario: 纯 Node 宿主启动
- **WHEN** 以纯 Node 进程启动 Runtime 并提供运行时数据根、工作区根与服务访问凭据
- **THEN** 装配完成、HTTP 与 WebSocket 服务就绪，且在没有 Electron 的环境下能接受并完成一次会话

#### Scenario: Electron 宿主行为不变
- **WHEN** Electron Main 以 utility process 启动 Runtime
- **THEN** 就绪消息与服务描述符仍通过父端口上报，关闭指令仍走同一通道，页面获得的连接地址与凭据不变

#### Scenario: 宿主未提供生命周期端口
- **WHEN** 启动时宿主既未提供父端口通道，也未提供进程信号通道
- **THEN** 启动明确失败并报告缺失的宿主能力，不得进入半初始化状态或静默以其他方式运行

#### Scenario: 关闭后的资源释放
- **WHEN** 宿主发出关闭
- **THEN** Runtime 停止接受新请求、结束或取消在途请求、释放存储与执行资源、释放单写入者占用，并以退出码结束进程

### Requirement: 装配边界单一且可替换

系统 SHALL 通过单一装配入口构造 Runtime 的持久化、资产、checkpointer、执行环境、凭据与传输依赖，并将其注入业务流程；启动函数 MUST NOT 内联构造具体存储或执行实现。装配入口 SHALL 以运行时数据根与工作区根为输入，SHALL 在关闭时释放自己创建的资源，且 MUST NOT 要求调用方了解各实现的数据文件布局。

#### Scenario: 替换装配实现
- **WHEN** 以另一套持久化与执行适配器替换本地实现
- **THEN** Agent Loop、工具调用、流会话与 HTTP/WS 服务面无需修改即可运行，且对外协议不变

#### Scenario: 启动清理旧数据文件
- **WHEN** 运行时数据根内存在已被取代的旧运行库
- **THEN** 启动流程按既有裁决处理该文件，不读取、不迁移旧 schema，也不因残留文件而启动失败

#### Scenario: 关闭时释放装配资源
- **WHEN** Runtime 收到关闭
- **THEN** 装配释放其创建的数据库、日志、投影与文件句柄，且不遗留单写入者锁，使下一次启动可以立即取得所有权

### Requirement: 本地形态的既有契约不变

宿主拆分 MUST NOT 改变本地形态的对外行为：HTTP/WS 路由与 `actiondriver.stream.v2` 协议、事件顺序与游标恢复、工具与审批语义、服务访问凭据校验、工作区与沙箱约束、以及桌面端启动与监督流程 SHALL 保持既有规格。

#### Scenario: 桌面端启动流程
- **WHEN** 桌面应用启动本地 Runtime
- **THEN** 监督、重启上限、就绪等待与关闭超时行为与拆分前一致

#### Scenario: 未授权与越权访问
- **WHEN** 请求缺少凭据或试图越过工作区边界
- **THEN** 与拆分前相同地拒绝请求，且不泄露内部路径或凭据
