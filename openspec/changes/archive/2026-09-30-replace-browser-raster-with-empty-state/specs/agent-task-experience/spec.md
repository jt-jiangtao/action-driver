## MODIFIED Requirements

### Requirement: 呈现默认任务工作区
系统 SHALL 按 Figma 节点 `60:7` 呈现 248px 侧栏、536px Agent 面板和 656px 浏览器面板，三个区域不得重叠；模型选择状态 SHALL 按节点 `202:1337` 呈现。浏览器面板 MUST 以真实会话状态决定内容，不得把静态网页截图或目标高亮当作正在操作的页面。

#### Scenario: 查看运行中的任务
- **WHEN** 用户打开浏览器投影存在、但真实 Browser 会话尚未建立的运行中 Mock 任务
- **THEN** Agent 面板显示该任务的标题、对话、执行进度和输入框；浏览器区域保留原有宽度，显示“开始浏览”空状态和现有控制条，不显示静态网页栅格或目标高亮

#### Scenario: 查看真实浏览器会话
- **WHEN** 用户打开已建立真实 Browser 会话的任务
- **THEN** 浏览器区域按会话类型显示内嵌页面或外部 Chrome 状态，不以静态截图代替真实页面

#### Scenario: 打开任务模型选择器
- **WHEN** 用户在默认任务工作区打开模型触发器
- **THEN** 模型菜单覆盖在输入框上方且不改变 Agent 与浏览器面板的宽度

### Requirement: 表达 Browser Skill 控制状态
系统 SHALL 在浏览器面板的控制条中表达运行、暂停和人工接管状态；真实 Browser 会话的控制操作 SHALL 保持作用于真实会话，Mock 状态 SHALL 保持可验证，但不得以静态网页栅格表示会话内容。

#### Scenario: 暂停 Mock Browser Skill
- **WHEN** 用户点击暂停
- **THEN** 控制条切换为暂停状态并提供继续操作，浏览器空状态保持不变

#### Scenario: 人工接管 Mock Browser Skill
- **WHEN** 用户点击人工接管
- **THEN** 控制条切换为人工接管状态并提供继续 Agent 操作，浏览器空状态保持不变

### Requirement: 使用本地 Mock 数据
系统 SHALL 使用确定性的本地 Mock 数据提供多个最近任务及各自的对话、执行步骤、Skill 状态、浏览器空状态和模型选择状态，且刷新应用后仍可复现设计验收场景。

#### Scenario: 无后端运行
- **WHEN** 本地 Agent Runtime、SQLite 和真实浏览器能力均未启动
- **THEN** 首页和任务页仍可完整展示和切换所有已绘制的非网页状态，浏览器区域显示空状态而不伪装真实网页

#### Scenario: 切换最近任务
- **WHEN** 用户依次打开两个不同的最近任务
- **THEN** 标题和投影内容随 task ID 确定性切换，两个任务共享页面组件但不共享错误的显示数据
