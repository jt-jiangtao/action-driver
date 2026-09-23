## MODIFIED Requirements

### Requirement: Agent 通过 Skill 调用能力
系统 MUST 将 Agent 作为任务编排核心；可执行能力 MUST 通过统一 Tool Contract 与 Tool Registry 调用，Skill MUST 作为带结构化 manifest 的说明与编排包声明所需工具和权限。Agent、Skill Markdown 和界面均不得绕过 Registry、Policy Gate 或 Provider 边界直接调用 Browser Use、Computer Use 或 Sandbox 的具体实现。

#### Scenario: Agent 请求浏览器操作
- **WHEN** Agent 计划需要执行浏览器动作
- **THEN** 已启用的 Browser Skill 通过 manifest 声明 Browser Tool 依赖，Agent 以类型化输入创建 Tool 调用，而不是直接访问浏览器对象

#### Scenario: Agent 请求系统操作
- **WHEN** Agent 计划需要执行 macOS 操作
- **THEN** 已启用的 Computer Use Skill 通过 manifest 声明 Computer Tool 依赖，Agent 以类型化输入创建 Tool 调用，而不是直接访问原生系统 API

#### Scenario: Skill 文档请求额外权限
- **WHEN** `SKILL.md` 文本要求使用未在 manifest 与本轮策略中授权的工具或权限
- **THEN** Runtime 忽略该权限请求并拒绝对应工具调用，Markdown 内容不得改变权限状态
