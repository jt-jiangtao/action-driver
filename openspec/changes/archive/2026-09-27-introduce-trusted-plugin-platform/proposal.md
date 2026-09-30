## Why

当前能力在 Runtime 启动代码中逐个装配，工具、原生服务与界面尚无统一的插件归属和卸载机制。需要让内置与第三方能力通过同一套 API 提供工具、Skill、面板和后台服务，同时保留现有任务、事件、脚本沙箱和原生权限边界。

## What Changes

- 建立可信插件平台，使用版本化 manifest、宿主 SDK 和 RPC，允许 Node 与平台原生组件，以及 stdio/HTTP MCP 服务。
- 公共插件 API/SDK 封装为可构建和打包的 npm 包，提供独立 `npm create action-driver-plugin` TypeScript 脚手架；Skill、schema 与执行层在同一个插件包内按模块分工。
- 强制依赖注入：插件与内核依赖接口，由各执行环境的 composition root 注入具体实现，禁止插件直接导入 Runtime/Desktop 内部实现。
- Skill/工具插件独立暴露可序列化 Skill 内容与工具 schema 贡献目录，供外部装配层继续拼接；目录发现不激活插件、不授予调用权。
- 插件统一注册工具、命令、指令型 Skill、能力、服务与面板；内置插件不使用私有核心 API。
- 增加安装、启用、按需激活、停用、升级、卸载、异常隔离和资源释放生命周期。
- 将 Search、Command、Web Reader、Computer Use、Image Generation 的已有实现按阶段移入 `plugins/`；Browser Use 建立插件边界，真实驱动等待现有独立 fork 任务完成，不在本变更扩展浏览器功能。
- 保留 Runtime 作为任务、调用和事件事实来源，Desktop 管本机资源，新增插件 UI bridge 和服务监督，不将权威状态移入插件。
- 信任扩展代码不等于信任模型脚本：CMD 与 REPL 的既有会话沙箱保持 fail-closed；Computer Use 现有应用批准、停止与指导行为保持。
- 首版只支持本机插件与既有远程 MCP 连接，不实现完整云端执行器、插件市场、动态工作流与定时系统、通用文档对象服务或受限第三方插件。

### Battle

架构 Battle 已完成至规划阶段。用户明确选择内置与第三方共用 API、允许原生程序、首版所有插件可信且后续扩展受限模式。

已检查安全、数据所有权、进程隔离、现有注册点及未完成浏览器工作的边界。反例：可信原生插件可以绕过 SDK 直接调用系统；不能声称 SDK 授权就是 OS 沙箱。比较方案：引入 Theia 全平台、在当前架构增加小内核与插件宿主、仅业务插件化。推荐并按用户当前请求选择渐进的小内核方案；第三方默认受限的建议被用户覆盖为首版全部可信。用户接受的风险是插件具有用户级系统权限，故障隔离不等于权限隔离。后续受限模式须单独裁决；用户已确认本设计并转交实施；后续追加确认 Skill/schema 目录与执行分离，由外部装配层拼接。

## Capabilities

### New Capabilities

- `plugin-platform`：可信插件清单、宿主 API、组件与资源生命周期、原生/MCP 服务、UI 面板及内置能力迁移。

### Modified Capabilities

- `agent-tool-runtime`：增加插件工具归属、动态停用和在途调用的版本固定规则；保留既有执行策略。

## Impact

- 新增 `packages/plugin-contracts`、`packages/plugin-sdk` 和运行在独立子进程中的插件宿主入口；不强制新增独立 apps 包。
- 调整 `apps/agent-runtime/src/runtime-process.ts`、ToolRegistry、能力网关和配置装配；复用持久化事件、调用状态机和 SessionSandbox。
- 调整 Desktop 本地能力注册、插件面板承载、原生程序启动与打包资源定位。
- 新增 `plugins/` 的源码与构建产物规范；不改变已有 fork 源码目录和现有工具标识。
- 与 `implement-browser-use`、Computer Use 错误展示和 HTTP 服务变更有交集；实施前核对已合入状态，仅迁移明确归属，不覆盖其他线程正在编辑的文件。
- 不引入 Theia、Temporal 或新 Agent 框架。首版依赖优先复用当前 Zod、HTTP/WS 和 MCP 官方 SDK；具体版本在实施阶段核对，不在规划中虚构兼容性。

### 实施中追加裁决

用户确认使用独立 create CLI，而非 Yeoman generator；首版生成 TypeScript 模板、构建配置、贡献目录和生命周期测试。参考 VS Code 的 manifest、公共 API 和 activate/deactivate 开发体验，不引入 VS Code/Theia 宿主。Skill/schema/执行同包分发，目录模块只提供数据，外部负责最终拼接。风险是模板与 SDK 必须同步，使用生成项目的真实构建与宿主加载验收防止漂移；npm 发布动作不包含在本次实现中。
