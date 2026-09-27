## ADDED Requirements

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
- **WHEN** 已有安装目录保留 search 或 web-reader 包且启动新版内置 web 插件
- **THEN** 旧归属不会自动重复注册，私有数据保留，工具 ID 和授权规则不变
