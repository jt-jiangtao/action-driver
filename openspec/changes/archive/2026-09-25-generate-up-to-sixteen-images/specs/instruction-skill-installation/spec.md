## MODIFIED Requirements

### Requirement: 系统 Imagegen Skill 引导生图
系统 SHALL 随每次应用安装提供只读的 Imagegen 系统 Skill，完整保留其说明、参考资料、脚本、图标、代理元数据和许可证，并在 Skills 设置列表中展示与启停。该 Skill SHALL 指导 Agent 使用 Action-Driver 已授权的生图工具整理提示词和生成图片；单次工具调用可提交 1 至 16 条独立需求，超过 16 条时 SHALL 指导 Agent 分次调用。Skill 不得把 Codex 内置工具或需额外依赖的备用 CLI 描述为本应用默认可用能力。Skill 的安装和启用 MUST NOT 绕过生图模型配置或授予额外工具权限。

#### Scenario: 新安装或升级后查看 Imagegen
- **WHEN** 用户首次安装或升级应用并打开 Skills 设置
- **THEN** `.system/imagegen` 作为可启停、不可编辑或卸载的系统 Skill 出现在列表中，详情可读取全部随附文件与许可证

#### Scenario: Agent 按 Skill 生成图片
- **WHEN** Imagegen Skill 已启用且本轮已有可用的 Action-Driver 生图工具及默认生图模型
- **THEN** Agent 可按 Skill 整理提示词并调用本应用工具生成图片，不依赖 Codex 内置工具或独立 OpenAI API Key

#### Scenario: 超过 16 张时分次调用
- **WHEN** 用户要求生成超过 16 张图片且 Imagegen Skill 已启用
- **THEN** Skill 指导 Agent 将独立提示词拆成多个不超过 16 张的工具调用，保持原有顺序

#### Scenario: 没有生图工具时读取 Skill
- **WHEN** Imagegen Skill 已启用但本轮没有可用生图工具
- **THEN** Skill 不使工具自动出现，Agent 说明需要配置默认生图模型，不执行随附 CLI 作为隐式替代
