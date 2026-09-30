## Purpose

定义 Action-Driver 首个可运行桌面壳层的用户可见行为，使 macOS 应用在安全的 Electron 进程边界内稳定呈现已确认的导航、品牌和页面布局。

## ADDED Requirements

### Requirement: 启动桌面应用
系统 SHALL 以 macOS 桌面窗口启动，并默认显示 Action-Driver 首页，不打开外部浏览器窗口。

#### Scenario: 首次启动
- **WHEN** 用户启动 Action-Driver
- **THEN** 系统在单一桌面窗口中显示首页及左侧导航

### Requirement: 使用安全的渲染边界
系统 MUST 隔离桌面主进程与页面渲染环境，并且页面只能通过显式公开的类型化桥接能力访问桌面功能。

#### Scenario: 页面访问桌面能力
- **WHEN** 页面请求桌面环境信息
- **THEN** 请求仅能通过预先声明的桥接接口完成，页面不能直接访问 Node.js 或 Electron 原始 API

### Requirement: 呈现统一侧栏
系统 SHALL 在首页和任务页呈现宽度为 248px 的浅色侧栏，包含窗口控制区域、Action-Driver 品牌、新任务、Skills、MCP 和最近任务列表，并且不显示底部用户名。

#### Scenario: 首页侧栏
- **WHEN** 用户位于首页
- **THEN** 新任务处于选中状态，最近任务首项显示加载状态，其余任务显示默认状态

#### Scenario: 任务页侧栏
- **WHEN** 用户打开当前任务
- **THEN** 侧栏保持相同尺寸、边距和条目对齐方式，并突出显示当前任务

### Requirement: 限制导航范围
系统 SHALL 只提供已绘制的首页和任务页体验；Skills 与 MCP 入口 SHALL 可见但 MUST NOT 打开未设计的页面。

#### Scenario: 点击未实现入口
- **WHEN** 用户点击 Skills 或 MCP
- **THEN** 当前页面保持不变，并且系统不创建额外页面或占位流程

### Requirement: 遵循设计基础
系统 SHALL 使用 Figma 中定义的语义色、字体层级、间距、圆角、阴影和动效 Token，并使用现有 Action-Driver 品牌 SVG 与匹配的 Lucide 图标。

#### Scenario: 1440×900 基准窗口
- **WHEN** 窗口内容区域为 1440×900
- **THEN** 首页和任务页关键区域的尺寸、对齐和层级与指定 Figma 画板一致，阴影不被裁切且文字不溢出

