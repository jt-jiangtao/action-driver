## MODIFIED Requirements

### Requirement: 呈现默认任务工作区
系统 SHALL 按 Figma 节点 `60:7` 呈现 248px 侧栏、536px Agent 面板和 656px 浏览器面板，三个区域不得重叠；模型选择状态 SHALL 按节点 `202:1337` 呈现。生产 Browser Use 会话存在时，浏览器区域 SHALL 显示真实网页和会话状态；Mock 视觉夹具仍 SHALL 使用可复现的静态内容。

#### Scenario: 查看运行中的任务
- **WHEN** 用户打开具有内置 Browser Use 会话的运行中任务
- **THEN** Agent 面板显示标题、对话、执行进度和输入框，右侧显示该会话的真实网页、当前标签与浏览器控件

#### Scenario: 查看 Mock 任务
- **WHEN** 用户打开确定性 Mock 任务
- **THEN** Agent 面板与浏览器区域仍显示可复现的静态网页栅格、目标高亮和浮动控制条

#### Scenario: 打开任务模型选择器
- **WHEN** 用户在默认任务工作区打开模型触发器
- **THEN** 模型菜单覆盖在输入框上方且不改变 Agent 与浏览器面板的宽度

### Requirement: 切换任务页布局状态
系统 SHALL 支持 Figma 中的默认分栏、浏览器放大和浏览器折叠三种视觉状态，且尺寸切换按钮仅替换图标，不改变按钮背景和边框。真实浏览器会话的布局切换 MUST 保留标签页及网页状态。

#### Scenario: 放大浏览器占位面板
- **WHEN** 用户在默认分栏状态点击浏览器放大按钮
- **THEN** 页面切换到节点 `111:247` 的浏览器放大布局，侧栏保留，Agent 面板隐藏，当前网页保持打开

#### Scenario: 折叠浏览器占位面板
- **WHEN** 用户点击浏览器折叠按钮
- **THEN** 页面切换到节点 `112:409` 的浏览器折叠布局，Agent 对话区扩展到剩余宽度，当前网页会话保持存活

#### Scenario: 恢复默认分栏
- **WHEN** 用户从浏览器放大或折叠状态点击对应的恢复图标
- **THEN** 页面恢复默认分栏布局，并保留当前任务、Mock 会话状态或真实浏览器标签页状态

### Requirement: 表达 Browser Skill 控制状态
系统 SHALL 在浏览器面板的浮动控制条中表达运行、暂停和人工接管状态。生产会话的控制条 SHALL 控制真实 Browser Use 会话；Mock 视觉夹具 SHALL 保持确定性演示行为。

#### Scenario: 暂停生产 Browser Use
- **WHEN** 用户点击生产会话的暂停按钮
- **THEN** Agent 对该浏览器会话暂停操作，当前网页保持可见，并提供继续操作

#### Scenario: 人工接管生产 Browser Use
- **WHEN** 用户点击生产会话的人工接管按钮
- **THEN** Agent 暂停该会话操作，用户可直接操作网页，并可恢复 Agent 操作

#### Scenario: 暂停 Mock Browser Skill
- **WHEN** 用户点击 Mock 控制条的暂停按钮
- **THEN** 控制条切换为暂停状态并提供继续操作，页面栅格保持不变

#### Scenario: 人工接管 Mock Browser Skill
- **WHEN** 用户点击 Mock 控制条的人工接管按钮
- **THEN** 控制条切换为人工接管状态并提供继续 Agent 操作，页面栅格保持不变

## ADDED Requirements

### Requirement: 显示 CUA JS 调用记录
系统 SHALL 在 Browser Use 和 Computer Use 工具行标题显示操作摘要；展开后 SHALL 显示实际执行的 JS 输入及文本、错误或图片输出，并在重新打开任务时保留这些内容。浏览器截图的 Base64 MUST NOT 作为正文显示。

#### Scenario: 查看浏览器脚本调用
- **WHEN** Agent 通过统一 CUA JS 入口调用浏览器并返回页面状态
- **THEN** 工具行显示 Browser Use 操作摘要，展开卡片可看到调用的 JS 代码和对应执行结果

#### Scenario: 查看桌面脚本调用
- **WHEN** Agent 通过同一入口调用桌面应用
- **THEN** 工具行显示 Computer Use 操作摘要，展开卡片可看到调用的 JS 代码和对应执行结果

#### Scenario: 重新打开任务
- **WHEN** 用户重新打开含 Browser Use 或 Computer Use 调用的任务
- **THEN** 先前调用的标题、JS 输入和执行输出仍可查看
