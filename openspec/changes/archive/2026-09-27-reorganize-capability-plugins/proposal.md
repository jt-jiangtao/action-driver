## Why

业务 Skill 仍以传统 system-skills 分发，web.search/web.open 分属两个包，Skill 工具仍手工注册。用户已裁决按能力聚合并明确要求开始实施，现将这些入口统一到既有插件生命周期。

## What Changes

- documents、pdf、presentations、spreadsheets 各自同包分发完整 Skill 与执行脚本资源。
- skills 聚合 Skill 创作资源、读取与安装工具；image-generation 聚合 imagegen Skill 和图片工具。
- search 与 web-reader 合并为 web，保留既有工具 ID/schema/配置行为。
- command 保持 Shell/Python/Node/TS 同包；沙箱、grants、凭据、任务与产物事实继续属于宿主。
- **BREAKING** 内置插件归属 search/web-reader 改为 web；旧安装包不再自动恢复注册，私有数据保留。Skill 标为 plugin，随所属插件停用。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `plugin-platform`：规定已批准的能力包归属和完整 Skill 资源生命周期。

## Impact

plugins、Runtime composition/Skill 装配、资源构建与打包检查、桌面 Skill/E2E 断言及开发说明。Battle 已完成：比较过统一 skills 大包与按业务拆包，用户选择文档四类各自独立，Skill 管理/图片/执行/web 按能力聚合。对资源归属、原工具兼容、停用和安全边界核对后无实质性异议；不迁移内核事实，不改 browser fork 工作。
