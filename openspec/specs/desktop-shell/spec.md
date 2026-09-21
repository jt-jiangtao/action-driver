# desktop-shell Specification

## Purpose

定义 ActionDriver 首个可运行桌面壳层的用户可见行为，使 macOS 应用在安全的 Electron 进程边界内稳定呈现已确认的导航、品牌和页面布局。

## Requirements

### Requirement: 启动桌面应用
系统 SHALL 以名称为 `ActionDriver` 且使用白色圆角方形底、居中蓝紫 ActionDriver 标志的品牌图标启动 macOS 桌面窗口，并默认显示 ActionDriver 首页，不打开外部浏览器窗口。应用名称 SHALL 在 Electron 应用身份、主窗口标题和页面标题中保持一致；在 macOS Dock API 可用时，系统 SHALL 使用同一品牌图标。

#### Scenario: 首次启动
- **WHEN** 用户启动 ActionDriver
- **THEN** 系统在单一桌面窗口中显示首页及左侧导航

#### Scenario: 原生应用身份
- **WHEN** Electron 主进程初始化应用与主窗口
- **THEN** 应用名称和窗口标题显示为 `ActionDriver`，窗口图标使用随应用提供的白底圆角 ActionDriver 品牌位图

#### Scenario: macOS Dock 品牌
- **WHEN** 应用在提供 Dock API 的 macOS 环境完成初始化
- **THEN** Dock 使用与主窗口一致的 ActionDriver 品牌图标

#### Scenario: 非 macOS 环境
- **WHEN** 应用运行环境不提供 Dock API
- **THEN** 应用仍正常创建主窗口，且不会因缺少 Dock API 而启动失败

### Requirement: 使用安全的渲染边界
系统 MUST 隔离桌面主进程与页面渲染环境，并且页面只能通过显式公开的类型化桥接能力访问桌面功能。

#### Scenario: 页面访问桌面能力
- **WHEN** 页面请求桌面环境信息
- **THEN** 请求仅能通过预先声明的桥接接口完成，页面不能直接访问 Node.js 或 Electron 原始 API

### Requirement: 呈现统一侧栏
系统 SHALL 在首页和任务页呈现宽度为 248px 的浅色侧栏，包含窗口控制区域、ActionDriver 品牌、新任务、Skills、MCP、最近任务列表和设置入口，并且不显示底部用户名。每个最近任务条目 SHALL 关联一个稳定的 Mock task ID，并能打开共享任务详情页。

#### Scenario: 首页侧栏
- **WHEN** 用户位于首页
- **THEN** 新任务处于选中状态，最近任务按 Mock 数据显示 loading 或 default 状态

#### Scenario: 打开任意最近任务
- **WHEN** 用户点击任意最近任务条目
- **THEN** 系统打开该 task ID 对应的共享任务详情页，并突出显示当前任务条目

#### Scenario: 任务页侧栏
- **WHEN** 用户打开当前任务
- **THEN** 侧栏保持相同尺寸、边距和条目对齐方式，并只突出显示与当前 task ID 对应的任务

### Requirement: 限制导航范围
系统 SHALL 提供已绘制的首页、任务页和“模型连接”设置页体验；Skills 与 MCP 入口 SHALL 可见但 MUST NOT 打开未设计的页面。

#### Scenario: 点击未实现入口
- **WHEN** 用户点击 Skills 或 MCP
- **THEN** 当前页面保持不变，并且系统不创建额外页面或占位流程

#### Scenario: 打开模型连接设置
- **WHEN** 用户从侧栏进入 Settings
- **THEN** 系统显示“模型连接”设置页，并保持首页与任务页既有侧栏宽度、布局和任务导航行为不变

### Requirement: 遵循设计基础
系统 SHALL 使用 Figma 中定义的语义色、字体层级、间距、圆角、阴影和动效 Token，并使用现有 ActionDriver 品牌资产与统一图标适配层。

#### Scenario: 1440×900 基准窗口
- **WHEN** 窗口内容区域为 1440×900
- **THEN** 首页、任务页和设置页关键区域的尺寸、对齐和层级与指定 Figma 画板一致，阴影不被裁切且文字不溢出

#### Scenario: 全局图标状态
- **WHEN** 图标位于默认、hover、selected、disabled、loading 或危险操作状态
- **THEN** 图标尺寸、线宽和前景色与所在组件状态一致，不携带冲突的固定颜色
