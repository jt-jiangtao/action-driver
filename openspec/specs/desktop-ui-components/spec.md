# desktop-ui-components Specification

## Purpose

定义桌面端从 Figma 组件库映射到可复用界面组件时必须保持的视觉、状态、语义、布局与可验证性约束，使所有页面复用同一套稳定且可扩展的交互基础。

## Requirements

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
系统 SHALL 为所有用户可交互元素提供语义查询所需的标签、角色和状态属性，并 SHALL 提供符合 `e2e/<route>/<scope>/<target>#<type>` 规范的稳定 `data-testid`。系统 MUST 通过自动化测试覆盖功能行为或明确登记为视觉占位，并 MUST 在正式打包前使用 AST 静态校验阻止缺失、格式错误、重复或未登记的测试契约进入产物；页面组合状态仍 SHALL 通过基准截图验证。

#### Scenario: 控件行为测试
- **WHEN** 控件能够触发导航、提交、选择、切换、输入、展开、关闭或异步操作
- **THEN** 控件具有路由式测试 ID，交互契约标记为 `functional`，且自动化测试通过该稳定接口验证用户可观察结果

#### Scenario: 视觉占位控件测试
- **WHEN** 按钮或其他交互外观尚未连接实际业务功能
- **THEN** 控件仍具有路由式测试 ID，交互契约明确标记为 `visual-only`，且测试验证其存在、可见和测试 ID 合规后即可通过

#### Scenario: 覆盖全部交互元素
- **WHEN** 开发者运行交互契约校验
- **THEN** 按钮、链接、输入框、Checkbox、Radio、菜单项、option、contenteditable、自定义交互组件及其 disabled 状态均被扫描，不存在无测试 ID 或无契约分类的可交互元素

#### Scenario: 阻止无契约打包
- **WHEN** 任一交互元素缺少测试 ID、命名不符合规范、静态 ID 重复、动态 ID 未使用批准的构造方式或未登记测试覆盖类型
- **THEN** AST 校验返回失败，Lint 与正式 Build 均停止且输出文件位置和违规原因

#### Scenario: 合规打包
- **WHEN** 所有交互元素均通过 AST 校验并登记对应测试类型
- **THEN** 正式 Build 继续执行，测试代码能够使用稳定契约定位页面中的每个交互目标
