## MODIFIED Requirements

### Requirement: Unified trusted plugin contract
系统 SHALL 对内置和第三方使用相同版本化公共 API，校验插件身份、版本、平台与契约兼容范围；首版 SHALL 将插件代码作为可信代码运行，明确该模式不提供 OS 沙箱。工具贡献的 ID SHALL 使用 `/` 分隔层级且不得包含点号；非工具贡献继续使用各自现有身份规则。

#### Scenario: Incompatible plugin
- **WHEN** 插件契约或平台与宿主不兼容，或工具贡献仍使用点号 ID
- **THEN** 系统拒绝激活并显示原因，不发布其工具或启动服务

#### Scenario: Built-in plugin registration
- **WHEN** 内置插件注册能力
- **THEN** 宿主执行与第三方相同的契约和资源归属校验

### Requirement: Preserve capability compatibility during migration
能力插件化 SHALL 保持任务事件与授权检查的安全边界；同一能力 SHALL 不同时由手工装配和插件路径注册。浏览器插件 SHALL 不把占位界面视作真实驱动可用。工具 ID 切换后，旧点号工具 ID 与旧 grants SHALL 不自动授权或调用斜杠工具。

#### Scenario: Browser driver not yet integrated
- **WHEN** Browser Use 只有面板声明且尚无真实驱动
- **THEN** 系统不向 Agent 发布可执行浏览器操作工具

#### Scenario: Old tool grant
- **WHEN** 任务仅持有旧点号工具授权
- **THEN** 插件的对应斜杠工具不进入可调用集合，直接调用被拒绝

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
