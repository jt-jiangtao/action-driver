## MODIFIED Requirements

### Requirement: Packaged API and plugin scaffolding
公共插件 API SHALL 通过独立 npm 包提供 JavaScript 和类型声明，不要求第三方导入仓库内部模块。系统 SHALL 提供 `npm create action-driver-plugin` TypeScript 脚手架；Skill、schema 和执行层 SHALL 位于同一插件包内。

#### Scenario: Generate and load a plugin
- **WHEN** 开发者通过脚手架创建插件并构建
- **THEN** 生成包包含 manifest、贡献目录、Skill 资源与 activate/deactivate 入口，统一宿主能够加载、执行和停用回收

#### Scenario: Existing destination
- **WHEN** 目标目录包含现有文件
- **THEN** 脚手架拒绝覆盖且不修改现有项目
