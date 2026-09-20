# agent-task-experience Specification

## Purpose

定义普通用户从首页描述目标到查看任务执行状态的完整界面体验，并覆盖对话、时间线、输入框以及浏览器面板的全部已绘制布局状态。

## Requirements

### Requirement: 呈现 Agent 优先首页
系统 SHALL 按 Figma 节点 `60:5` 呈现首页，包括居中的品牌标志、标题、说明文字和底部输入框。

#### Scenario: 查看空白首页
- **WHEN** 用户进入首页且尚未提交目标
- **THEN** 页面显示“我们应该在 ActionDriver 中做些什么？”以及仅包含加号和发送按钮的输入框

### Requirement: 使用富文本输入框
系统 SHALL 使用 Slate.js 提供输入能力，并保持 Figma 中的自定义 Codex 风格视觉，不套用 Ant Design 输入框外观。

#### Scenario: 提交非空目标
- **WHEN** 用户输入目标并点击发送按钮
- **THEN** Mock Agent 会话被创建，系统进入任务页并显示相应的用户消息和执行状态

#### Scenario: 执行中的输入框
- **WHEN** Mock Agent 处于运行状态
- **THEN** 发送按钮替换为圆形中断按钮，按钮内部显示白色停止方块

### Requirement: 呈现默认任务工作区
系统 SHALL 按 Figma 节点 `60:7` 呈现 248px 侧栏、536px Agent 面板和 656px 浏览器占位面板，三个区域不得重叠。

#### Scenario: 查看运行中的任务
- **WHEN** 用户打开当前 Mock 任务
- **THEN** Agent 面板显示对话、执行进度和输入框，浏览器区域显示静态网页栅格、当前目标高亮及浮动控制条

### Requirement: 呈现执行时间线
系统 SHALL 使用 Ant Design Timeline 表达执行进度，并保持时间线宽度与当前对话流宽度一致。

#### Scenario: 显示四步执行状态
- **WHEN** Mock 任务包含已完成、当前和等待步骤
- **THEN** 时间线按竖直顺序展示四步、`3 / 4` 进度、对应状态圆点和当前步骤背景

### Requirement: 切换任务页布局状态
系统 SHALL 支持 Figma 中的默认分栏、浏览器放大和浏览器折叠三种视觉状态，且尺寸切换按钮仅替换图标，不改变按钮背景和边框。

#### Scenario: 放大浏览器占位面板
- **WHEN** 用户在默认分栏状态点击浏览器放大按钮
- **THEN** 页面切换到节点 `111:247` 的浏览器放大布局，侧栏保留，Agent 面板隐藏

#### Scenario: 折叠浏览器占位面板
- **WHEN** 用户点击浏览器折叠按钮
- **THEN** 页面切换到节点 `112:409` 的浏览器折叠布局，Agent 对话区扩展到剩余宽度

#### Scenario: 恢复默认分栏
- **WHEN** 用户从浏览器放大或折叠状态点击对应的恢复图标
- **THEN** 页面恢复默认分栏布局，并保留当前 Mock 会话状态

### Requirement: 表达 Browser Skill 控制状态
系统 SHALL 在浏览器占位面板的浮动控制条中表达运行、暂停和人工接管状态，但本阶段 MUST NOT 驱动真实网页。

#### Scenario: 暂停 Mock Browser Skill
- **WHEN** 用户点击暂停
- **THEN** 控制条切换为暂停状态并提供继续操作，页面栅格保持不变

#### Scenario: 人工接管 Mock Browser Skill
- **WHEN** 用户点击人工接管
- **THEN** 控制条切换为人工接管状态并提供继续 Agent 操作，页面栅格保持不变

### Requirement: 使用本地 Mock 数据
系统 SHALL 使用确定性的本地 Mock 数据提供任务、对话、执行步骤与 Skill 状态，且刷新应用后仍可复现设计验收场景。

#### Scenario: 无后端运行
- **WHEN** Go Sidecar、SQLite 和真实浏览器能力均未启动
- **THEN** 首页和任务页仍可完整展示和切换所有已绘制状态
