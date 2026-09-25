## ADDED Requirements

### Requirement: 随包提供文档类系统 Skill
系统 SHALL 随每次安装提供 `documents`、`pdf`、`presentations`、`spreadsheets` 四份只读文档类系统 Skill，以有版本和逐文件哈希的上游快照为基线，完整保留参考资料、脚本、容器工具、API 文档、图标、代理元数据与来源中存在的许可证。系统 SHALL 仅通过独立记录的 patch 修改与包内依赖约束冲突的说明指令，并在 Skills 设置列表中展示与启停。这些 Skill SHALL 指导 Agent 通过本应用已注册的工具与随包依赖完成文件产出和渲染验证；其安装与启用 MUST NOT 绕过工具授权、MUST NOT 改变本轮工具权限，也 MUST NOT 使缺失的工具自动出现。

#### Scenario: 新安装或升级后查看文档类系统 Skill
- **WHEN** 用户首次安装或升级应用并打开 Skills 设置
- **THEN** `.system/documents`、`.system/pdf`、`.system/presentations` 与 `.system/spreadsheets` 作为可启停、不可编辑或卸载的系统 Skill 出现在列表中，详情可完整读取随附文件与来源中存在的许可证

#### Scenario: Agent 按 Skill 产出文档类文件
- **WHEN** 文档类系统 Skill 已启用且本轮具备脚本工具与随包文档依赖
- **THEN** Agent 可按 Skill 中已修正的依赖指令解析随包依赖、生成 docx、pptx、xlsx 或 pdf 文件，并对产物执行渲染或结构验证

#### Scenario: 系统内容受保护
- **WHEN** 用户或安装工具尝试修改、重命名、卸载或覆盖上述任一系统 Skill
- **THEN** Runtime 拒绝内容变更并保留原文件，启停操作仍可生效，普通 Skill 的安装不得写入 `.system` 或占用这些标识

#### Scenario: 随包依赖缺失时读取 Skill
- **WHEN** 文档类系统 Skill 已启用但本机的随包文档依赖不可用
- **THEN** Agent 说明缺少的必要依赖与受影响的验证步骤，不得声称已完成渲染或视觉验证，也不得改用用户已安装的解释器或桌面版办公软件

#### Scenario: 上游差异可审查
- **WHEN** 开发者用记录的来源版本和哈希清单复核随包文档 Skill
- **THEN** 除独立 patch 明确记录的行外，文件列表与内容逐一对应上游快照；patch 将用户缓存、系统 Poppler 或安装 Poppler 的回退指令改为报告缺失依赖

### Requirement: 退役旧系统 Skill
系统 SHALL 停止随包提供 `browser-tools`、`computer-tools`、`report-writer`，MUST 在初始化时删除旧用户目录 `.system/` 下这三个标识的副本，MUST NOT 删除个人 Skill 或 `*-legacy` 备份。

#### Scenario: 升级后清理旧系统副本
- **WHEN** 旧用户目录中存在这三个 `.system` Skill 且应用升级并初始化
- **THEN** 三个目录被删除，Skills 列表不再显示它们，其他 Skill 及个人备份保持原状

#### Scenario: 新安装不提供旧 Skill
- **WHEN** 用户全新安装应用
- **THEN** 随包系统 Skill 和初始化后的 `.system` 目录均不存在这三个标识
