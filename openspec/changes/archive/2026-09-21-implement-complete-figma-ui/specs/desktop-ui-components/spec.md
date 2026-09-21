## Purpose

定义桌面端从 Figma 组件库映射到可复用界面组件时必须保持的视觉、状态、语义、布局与可验证性约束，使所有页面复用同一套稳定且可扩展的交互基础。

## ADDED Requirements

### Requirement: 覆盖 Figma 组件及变体
系统 SHALL 为 Figma `01 Components` 中每个有交互或组合语义的组件提供可复用实现，并 SHALL 为每个已绘制变体提供可触发、可测试的状态；纯 Glyph SHALL 通过统一图标适配层映射，而不是复制为页面私有图形。

#### Scenario: 核对组件覆盖率
- **WHEN** 开发者运行组件覆盖核对
- **THEN** 核对矩阵逐项列出 19 个组件集、组合组件、Glyph 映射、对应代码实现和测试状态，不存在未说明的缺口

#### Scenario: 页面复用组件
- **WHEN** 相同控件出现在两个或更多页面状态中
- **THEN** 页面复用同一组件 API，并通过属性或组合表达变体，不复制整段标记和样式

### Requirement: 呈现完整交互状态
系统 SHALL 按适用范围呈现 default、hover、focus、pressed、selected、loading、disabled、error、success、expanded、collapsed 与 menu-open 状态，并 MUST 保证状态切换不会丢失用户已输入或已选择的数据。

#### Scenario: 键盘聚焦控件
- **WHEN** 用户通过键盘聚焦按钮、输入框、复选框、单选项或菜单触发器
- **THEN** 控件呈现与 Figma 语义一致且清晰可见的 focus 状态

#### Scenario: 异步操作进行中
- **WHEN** Mock 操作处于 loading 或 testing 状态
- **THEN** 对应控件显示进度反馈、防止重复提交，并保留操作前的数据

### Requirement: 使用语义化图标和颜色
系统 SHALL 使用统一适配层将 Figma Glyph 映射到现有匹配的 Lucide 图标或设计资产，并 SHALL 让图标颜色继承当前组件状态的前景色。

#### Scenario: 主要按钮中的新增图标
- **WHEN** Plus 图标显示在主色按钮中
- **THEN** 图标与按钮文字使用相同的白色前景色，而不是固定灰色

#### Scenario: 模型与连接语义
- **WHEN** 页面同时显示连接、模型和新增动作
- **THEN** 三者分别使用网络/连接、模型和 Plus 语义图标，用户无需依赖文案即可区分

### Requirement: 使用可扩展布局
系统 SHALL 使用 Flex、Grid 和正常文档流构建页面与组件布局；只有弹层、浮动浏览器控制条和设计明确指定的覆盖高亮 MAY 使用定位。

#### Scenario: 基准窗口
- **WHEN** 内容区域为 1440×900
- **THEN** 页面主要区域、间距、对齐、圆角和阴影与对应 Figma 画板一致且互不重叠

#### Scenario: 最小支持窗口
- **WHEN** 内容区域缩小至 1024×700
- **THEN** 主要操作仍可访问，内容通过约束、滚动或安全收缩呈现，不因固定绝对坐标相互覆盖

### Requirement: 支持组件级验证
系统 SHALL 为状态组件提供语义查询所需的标签、角色和状态属性，并 SHALL 通过自动化测试覆盖行为状态，通过基准截图覆盖页面组合状态。

#### Scenario: 控件行为测试
- **WHEN** 测试触发按钮、菜单、输入、选择、展开或异步状态
- **THEN** 测试能够通过可访问名称和状态断言用户可观察结果，而不依赖内部实现细节
