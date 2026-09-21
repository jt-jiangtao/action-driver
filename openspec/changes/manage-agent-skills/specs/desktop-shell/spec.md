## MODIFIED Requirements

### Requirement: 限制导航范围
系统 SHALL 提供已绘制的首页、任务页、“模型连接”设置页和“Skill 管理”页体验；MCP 入口 SHALL 可见但 MUST NOT 打开未设计的页面。

#### Scenario: 点击未实现入口
- **WHEN** 用户点击 MCP
- **THEN** 当前页面保持不变，并且系统不创建额外页面或占位流程

#### Scenario: 打开模型连接设置
- **WHEN** 用户从侧栏进入 Settings
- **THEN** 系统显示“模型连接”设置页，并保持首页与任务页既有侧栏宽度、布局和任务导航行为不变

#### Scenario: 打开 Skill 管理
- **WHEN** 用户从侧栏进入 Skills
- **THEN** 系统显示 Skill 管理页，并保持首页与任务页既有侧栏宽度、布局和任务导航行为不变
