## MODIFIED Requirements

### Requirement: Agent 通过 Skill 调用能力
系统 MUST 将 Agent 作为任务编排核心；可执行能力 MUST 通过统一 Tool Contract 与 Tool Registry 调用。普通指令型 Skill SHALL 通过 `SKILL.md` 向 Agent 提供说明，无需声明 `executor` 或工具依赖即可被启用；需要调用可执行能力时，已注册工具仍 MUST 经过本轮 Policy Gate 授权。Agent、Skill Markdown 和界面均不得绕过 Registry、Policy Gate 或 Provider 边界直接调用 Browser Use、Computer Use 或 Sandbox 的具体实现。

#### Scenario: Agent 请求浏览器操作
- **WHEN** 已启用的 Skill 引导 Agent 执行浏览器动作
- **THEN** Agent 只能按本轮授予的类型化 Browser Tool 契约创建调用，不能因 Skill 文本或启用状态直接访问浏览器对象

#### Scenario: Agent 请求系统操作
- **WHEN** 已启用的 Skill 引导 Agent 执行 macOS 操作
- **THEN** Agent 只能按本轮授予的类型化 Computer Tool 契约创建调用，不能因 Skill 文本或启用状态直接访问原生系统 API

#### Scenario: Skill 文档请求额外权限
- **WHEN** `SKILL.md` 文本要求使用未在本轮策略中授权的工具或权限
- **THEN** Runtime 忽略该权限请求并拒绝对应工具调用，Markdown 内容不得改变权限状态

#### Scenario: 纯说明型 Skill 被启用
- **WHEN** 有效 `SKILL.md` 没有声明 executor 或工具依赖
- **THEN** Agent 仍可发现和读取该 Skill，工具授权状态保持不变
