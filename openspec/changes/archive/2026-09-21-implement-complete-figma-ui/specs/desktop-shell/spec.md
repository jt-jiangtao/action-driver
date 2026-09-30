## MODIFIED Requirements

### Requirement: 呈现统一侧栏
系统 SHALL 在首页和任务页呈现宽度为 248px 的浅色侧栏，包含窗口控制区域、Action-Driver 品牌、新任务、Skills、MCP、最近任务列表和设置入口，并且不显示底部用户名。每个最近任务条目 SHALL 关联一个稳定的 Mock task ID，并能打开共享任务详情页。

#### Scenario: 首页侧栏
- **WHEN** 用户位于首页
- **THEN** 新任务处于选中状态，最近任务按 Mock 数据显示 loading 或 default 状态

#### Scenario: 打开任意最近任务
- **WHEN** 用户点击任意最近任务条目
- **THEN** 系统打开该 task ID 对应的共享任务详情页，并突出显示当前任务条目

#### Scenario: 任务页侧栏
- **WHEN** 用户打开当前任务
- **THEN** 侧栏保持相同尺寸、边距和条目对齐方式，并只突出显示与当前 task ID 对应的任务

### Requirement: 遵循设计基础
系统 SHALL 使用 Figma 中定义的语义色、字体层级、间距、圆角、阴影和动效 Token，并使用现有 Action-Driver 品牌资产与统一图标适配层。

#### Scenario: 1440×900 基准窗口
- **WHEN** 窗口内容区域为 1440×900
- **THEN** 首页、任务页和设置页关键区域的尺寸、对齐和层级与指定 Figma 画板一致，阴影不被裁切且文字不溢出

#### Scenario: 全局图标状态
- **WHEN** 图标位于默认、hover、selected、disabled、loading 或危险操作状态
- **THEN** 图标尺寸、线宽和前景色与所在组件状态一致，不携带冲突的固定颜色
