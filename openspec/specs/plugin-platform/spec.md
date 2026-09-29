# plugin-platform Specification

## Purpose

提供统一的可信插件平台，使内置和第三方能力通过相同契约贡献工具、服务、Skill 和面板，并由宿主管理兼容性、调用来源、资源释放与故障恢复，保留现有任务事实和模型执行权限边界。

## Requirements

### Requirement: Explicit dependency injection
插件和平台业务模块 SHALL 通过显式接口接收依赖，由执行环境装配具体适配器；插件 SHALL 不直接导入 Runtime/Desktop 内部实现。必需依赖缺失、契约不兼容或依赖循环 SHALL 明确失败，不自动使用 mock 或其他执行环境。

#### Scenario: Required service unavailable
- **WHEN** 激活插件所需的声明服务不存在或版本不兼容
- **THEN** 激活失败并报告具体依赖，不发布部分贡献

#### Scenario: Test replaces infrastructure
- **WHEN** 测试注入替代的进程、传输或存储接口实现
- **THEN** 业务模块通过这些接口运行，无需启动真实 Desktop 或改变业务实现

### Requirement: Unified trusted plugin contract
系统 SHALL 对内置和第三方使用相同版本化公共 API，校验插件身份、版本、平台与契约兼容范围；首版 SHALL 将插件代码作为可信代码运行，明确该模式不提供 OS 沙箱。工具贡献的 ID SHALL 使用 `/` 分隔层级且不得包含点号；非工具贡献继续使用各自现有身份规则。

#### Scenario: Incompatible plugin
- **WHEN** 插件契约或平台与宿主不兼容，或工具贡献仍使用点号 ID
- **THEN** 系统拒绝激活并显示原因，不发布其工具或启动服务

#### Scenario: Built-in plugin registration
- **WHEN** 内置插件注册能力
- **THEN** 宿主执行与第三方相同的契约和资源归属校验

### Requirement: Atomic contributions and ownership
系统 SHALL 将每项贡献绑定插件 ID、版本与宿主实例；激活期间贡献 SHALL 在全部成功后发布；冲突或失败 SHALL 回收本次注册并报告归属。

#### Scenario: Activation partially fails
- **WHEN** 插件注册部分贡献后激活失败
- **THEN** 已暂存贡献全部回收，对外不存在部分可用状态

#### Scenario: Contribution conflict
- **WHEN** 两个插件贡献冲突的稳定工具标识或模型名
- **THEN** 新贡献被拒绝且错误包含双方归属，已有贡献不被隐式覆盖

### Requirement: Lifecycle and resource cleanup
系统 SHALL 支持安装、启用、按需激活、停用、升级、卸载和异常状态；同一插件并发激活 SHALL 合并；停用 SHALL 拒绝新调用并在期限内处理在途调用和回收资源。

#### Scenario: Disable an active plugin
- **WHEN** 用户停用有在途调用的插件
- **THEN** 不再接收新调用，等待或取消在途调用，并回收注册、订阅、面板、连接和子进程

#### Scenario: Plugin crashes
- **WHEN** 插件宿主崩溃且某副作用调用没有最终结果
- **THEN** 系统移除其可用贡献并将该调用标记为结果未知，不自动重放

### Requirement: Upgrade with pinned invocations
系统 SHALL 固定在途调用的插件版本与实例，升级 SHALL 避免同一贡献双重注册；代码回退 SHALL 不被宣称能够撤销外部副作用；不可逆数据迁移 SHALL 有明确恢复策略。

#### Scenario: Upgrade while executing
- **WHEN** 插件执行期间开始升级
- **THEN** 旧调用不会被交给新实例继续执行，新版本只在旧贡献停止后发布

### Requirement: Scoped host API and authoritative state
系统 SHALL 提供工具、命令、Skill、能力、服务、面板、会话上下文、产物、私有存储、凭据代理、事件与日志接口；调用上下文 SHALL 由宿主推导。插件 SHALL 不通过公共 API 直接写权威任务状态或取得数据库、原始 Electron 和任意 IPC 对象。

#### Scenario: Task scoped invocation
- **WHEN** Agent 调用插件工具并在输入中提供其他会话路径
- **THEN** 宿主仍按持久化任务解析执行上下文并执行输入校验

#### Scenario: Cross plugin invocation
- **WHEN** 一个插件调用另一个插件能力
- **THEN** 宿主保留调用来源、检查目标契约与策略，并传播期限和取消

### Requirement: Preserve model code execution boundaries
可信插件模式 SHALL 不隐式放宽现有模型脚本 SessionSandbox、Computer Use 应用批准和取消约束。系统 SHALL 不将指令型 Skill 或插件安装当作 Agent 工具授权。

#### Scenario: Model generated command
- **WHEN** Agent 通过 command 插件执行生成的脚本
- **THEN** 现有工作区隔离与 fail-closed 执行规则继续生效

#### Scenario: Computer app requires approval
- **WHEN** Computer Use 访问未获现有规则批准的应用
- **THEN** 插件路径仍返回现有批准或指导状态，不因可信插件自动批准

### Requirement: Supervised native and MCP services
系统 SHALL 支持声明的 Node、平台原生及 stdio/HTTP MCP 服务，关联进程、连接与插件归属；MCP 工具 SHALL 经过逐工具 schema、可用性和授权校验。

#### Scenario: Native artifact missing
- **WHEN** 包内没有当前平台的声明可执行产物
- **THEN** 对应服务不可用且有明确诊断，不回退到未知系统可执行文件

#### Scenario: MCP connection closes
- **WHEN** MCP 服务连接中断
- **THEN** 对应工具退出可用集合，在途副作用按结果未知规则处理

### Requirement: Panel bridge isolation
系统 SHALL 使用类型化消息提供插件面板，远程网页 SHALL 不获得 Node 或插件宿主权限；画面查看和输入控制 SHALL 分别授权。

#### Scenario: Remote page attempts host call
- **WHEN** 面板中的远程网页尝试未声明宿主消息
- **THEN** 宿主拒绝请求且不执行本机动作

### Requirement: Preserve capability compatibility during migration
能力插件化 SHALL 保持任务事件与授权检查的安全边界；同一能力 SHALL 不同时由手工装配和插件路径注册。浏览器插件 SHALL 不把占位界面视作真实驱动可用。工具 ID 切换后，旧点号工具 ID 与旧 grants SHALL 不自动授权或调用斜杠工具。

#### Scenario: Browser driver not yet integrated
- **WHEN** Browser Use 只有面板声明且尚无真实驱动
- **THEN** 系统不向 Agent 发布可执行浏览器操作工具

#### Scenario: Old tool grant
- **WHEN** 任务仅持有旧点号工具授权
- **THEN** 插件的对应斜杠工具不进入可调用集合，直接调用被拒绝

### Requirement: Independently exposed skill and tool catalogs
Skill 与工具插件 SHALL 独立暴露可序列化的 Skill 内容/资源引用与完整工具 schema，供外部装配层继续拼接；贡献目录 SHALL 与执行生命周期保持单一职责。

#### Scenario: Read catalog without activation
- **WHEN** 外部装配层读取插件 Skill 与工具 schema
- **THEN** 读取不激活插件、不启动服务、不修改 grants，最终指令与工具集合由外部装配层构造

### Requirement: Packaged API and plugin scaffolding
公共插件 API SHALL 通过独立 npm 包提供 JavaScript 和类型声明，不要求第三方导入仓库内部模块。系统 SHALL 提供 `npm create actiondriver-plugin` TypeScript 脚手架；Skill、schema 和执行层 SHALL 位于同一插件包内。

#### Scenario: Generate and load a plugin
- **WHEN** 开发者通过脚手架创建插件并构建
- **THEN** 生成包包含 manifest、贡献目录、Skill 资源与 activate/deactivate 入口，统一宿主能够加载、执行和停用回收

#### Scenario: Existing destination
- **WHEN** 目标目录包含现有文件
- **THEN** 脚手架拒绝覆盖且不修改现有项目

### Requirement: Capability aligned plugin packages
系统 SHALL 将 documents、pdf、presentations、spreadsheets 作为独立插件分发；Skill 创作与管理 SHALL 归属 skills；图片 Skill 与工具 SHALL 归属 image-generation；Shell、Python、Node、TS SHALL 归属 command；搜索与网页读取 SHALL 共同归属 web。每包 SHALL 暴露纯 catalog 并包含自己的完整 Skill/执行资源。Skill 和其他指令内容 SHALL 直接导入同包文件，在构建时打包文本；npm 默认导出 SHALL 指向分发的构建产物。

#### Scenario: Discover packaged instructions
- **WHEN** 外部装配层读取上述插件 catalog
- **THEN** 可读取 Skill 内容和资源引用，全部声明资源存在于同包，不启动执行代码

#### Scenario: Web search is unconfigured
- **WHEN** web 插件启用但未配置搜索服务
- **THEN** 网页读取仍可用，搜索工具不注册，不以假结果替代

#### Scenario: Stop a capability plugin
- **WHEN** 文档、skills 或图片插件停用
- **THEN** 对应 Skill 和工具退出发现集合，其他能力保持可用，已加载状态被撤销

#### Scenario: Upgrade old built-in ownership
- **WHEN** 已有安装目录保留旧包且启动新版内置插件
- **THEN** 旧归属不会自动重复注册，私有数据保留；新版本工具只使用斜杠 ID，旧工具授权不沿用

### Requirement: Plugin owned semantic tool presentation
插件工具 SHALL 可通过公共 npm API 声明输入输出的语义标签、字段路径与文本、代码、链接或图片类型，catalog SHALL 独立暴露这些声明。内置工具与脚手架 SHALL 提供声明。展示声明 SHALL 不改变模型 schema、执行结果、授权或原始日志。

#### Scenario: External tool with presentation fields
- **WHEN** 外部插件声明输入目标与输出状态字段并通过校验
- **THEN** 统一宿主与界面显示对应语义字段，无需新增插件专用 UI

#### Scenario: Legacy plugin without presentation
- **WHEN** 已有插件没有展示声明
- **THEN** 工具保持可执行，详情显示有效摘要且不整块显示原 JSON
