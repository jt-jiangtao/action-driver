## MODIFIED Requirements

### Requirement: 限制导航范围
系统 SHALL 提供已绘制的首页、任务页、“模型连接”“主提示词”“Skills”“接口层日志”和“模型层日志”设置页体验；设置侧栏 SHALL 按“模型 / Agent / 诊断”分组保留这些入口并清晰标记当前页面；应用主侧栏的 Skills 入口 SHALL 打开同一个 Skills 设置页；MCP 入口 SHALL 可见但 MUST NOT 打开未设计的页面。

#### Scenario: 点击未实现入口
- **WHEN** 用户点击 MCP
- **THEN** 当前页面保持不变，并且系统不创建额外页面或占位流程

#### Scenario: 打开模型连接设置
- **WHEN** 用户从侧栏进入 Settings
- **THEN** 系统显示“模型连接”设置页，并保持首页与任务页既有侧栏宽度、布局和任务导航行为不变

#### Scenario: 在设置页面之间导航
- **WHEN** 用户在设置侧栏选择“模型连接”“主提示词”“Skills”“接口层日志”或“模型层日志”
- **THEN** 系统打开对应设置页面，保留全部入口及其独立图标，并只突出显示当前页面入口

#### Scenario: 从应用侧栏打开 Skills
- **WHEN** 用户点击应用主侧栏的 Skills
- **THEN** 系统打开与设置侧栏相同的 Skills 页面，不创建另一份 Skill 管理界面或状态
