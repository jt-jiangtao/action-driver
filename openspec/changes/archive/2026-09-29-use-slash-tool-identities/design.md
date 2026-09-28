## Context

见 `proposal.md`。当前 `createToolIdentity` 生成点号 ID，`canonicalToolId` 与 Registry/Policy Gate 接受一组旧别名。插件 manifest、catalog、`onTool:` 激活、能力 grants、Runtime 事件与 Renderer 展示均引用工具 ID。模型名独立保存且被提供方契约限制为字母、数字、下划线和连字符。内置插件可由打包目录重新发布到本地安装目录；同版本内容变更会刷新安装包。

## Goals / Non-Goals

**Goals:**

- 统一新工具 ID、manifest、授权、执行与展示的斜杠形式，并在注册边界拒绝点号工具 ID。
- 保留现有模型函数名和参数契约，使名称变更只作用于内部稳定工具身份。
- 明确旧插件、旧授权及旧调用不会自动映射或迁移。

**Non-Goals:**

- 不修改插件 ID、Skill ID、服务 ID、插件能力贡献 ID、事件类型或文件路径中的点号；`createToolIdentity` 返回的工具 `capabilityId` 元数据随工具层级改用斜杠。
- 不重写历史数据库记录，也不创建旧 ID 的只读展示映射。
- 不改变模型工具权限、执行器、风险等级或调用预算。

## Decisions

### 1. 工具 ID 使用路径式语法，模型名保持独立

内置工具采用 `tools/<local|cloud>/<plugin-id>/<operation-segment>[/...]`。通用插件工具贡献采用非空、斜杠分隔的安全片段；点号 ID 在 manifest 与 catalog 校验时拒绝。`createToolIdentity` 将 operation 的点号层级转换为 `/`，返回斜杠 `id`、不含点号的 `capabilityId` 和现有下划线 `modelName`。版本继续独立存储并在授权键中保留 `@<version>`。

替代方案是只改变 UI 文本、让内部 ID 维持点号；实现量较小，但授权、插件声明和事件仍会出现用户要求移除的点号层级。最终裁决为整体切换。

### 2. 旧标识直接失效

删除 `canonicalToolId`、`canonicalModelName` 与旧别名表的执行期用途；Registry 只登记声明的 ID 和模型名，Policy Gate 只比较当前工具定义与本轮 grants。旧点号 grants 不授权新工具；旧模型别名不被解析。数据库中的旧记录保留字节原样，读取它们不会触发新工具执行。Renderer 对无法识别的旧 ID 使用现有通用文本回退，不承诺原工具专属样式。

替代方案是保留一段时间的别名映射与数据迁移，可减轻升级冲击，但会使双重命名和授权语义继续存在。用户已明确覆盖该建议，接受旧授权、插件和历史调用失效。

### 3. 内置插件与消费方同一版本切换

在一个变更中更新内置插件的 `plugin.json`、catalog、presentation 键与 `onTool:` 激活，Runtime 里生成/比较 grants 和工具 ID 的代码、Desktop 的类型判断、脚手架生成器与 SDK 文档。现有内置包发布机制会刷新同版本目录内容；验收时必须用旧安装目录启动新版本，确认清单与代码一致。第三方插件若仍声明点号工具 ID，须由作者发布新版；平台直接报明示的无效 manifest 错误。

替代方案是分阶段先接受双语法再逐包切换；这会违反本次不保留兼容的裁决，也使插件目录与权限键短期分叉。

## Risks / Trade-offs

- [旧任务授权失效] → 不迁移和不映射；新任务按新工具 ID 授权，旧任务记录仅作历史数据。用户已接受该代价。
- [已安装第三方插件不再激活] → 校验时返回明确的 `INVALID_MANIFEST`，由插件作者更新工具贡献 ID。用户已接受破坏性切换。
- [内置安装副本与源码不一致] → 用含旧安装目录的真实 Runtime 夹具验证刷新与启动，不只验证源码 catalog。
- [遗漏工具 ID 消费方导致工具卡片或授权失效] → 对所有工具 ID 的运行时代码做定向搜索，覆盖 Registry、Policy、插件装配、事件投影和 Desktop 组件测试。
- [把非工具 ID 中的点号误改] → 仅按工具身份字段及其明确消费者修改；插件、Skill、服务和事件命名保持原契约。

## Migration Plan

1. 调整契约与生成器，令新工具 ID 可验证且点号工具 ID 被拒绝。
2. 同步更新内置插件清单、catalog、安装刷新、Runtime、Desktop 和脚手架，删除旧别名解析。
3. 以新安装及旧安装目录两类夹具验证启动、授权、执行和工具展示；确认旧点号调用被拒绝。
4. 发布时声明破坏性工具 ID 变更。若需回退，只能整体回退应用版本；已产生的新斜杠授权与任务记录不会自动转换到旧版本。
