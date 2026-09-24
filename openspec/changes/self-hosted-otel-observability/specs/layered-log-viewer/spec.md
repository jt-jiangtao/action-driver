## MODIFIED Requirements

### Requirement: 在接口层与模型层日志之间切换
系统 SHALL 在同一日志工作区保留“接口层日志”入口，并 SHALL 提供指向本地 Grafana 运行诊断及本地 Phoenix 模型详情的明确入口；切换入口 SHALL 保留设置侧栏及当前选中入口的视觉状态。接口层日志 SHALL 继续由本机交互日志服务展示，Grafana/Phoenix 的详细查询 SHALL 由各自平台承载。

#### Scenario: 打开日志工作区
- **WHEN** 用户从设置侧栏进入“日志”
- **THEN** 系统默认显示接口层本机日志，并同时展示 Grafana 与 Phoenix 的诊断入口

#### Scenario: 切换日志层级
- **WHEN** 用户选择本地运行诊断或模型诊断入口
- **THEN** 系统通过受约束的导航打开对应本地平台，并保留返回接口层日志的路径，不在应用中伪造平台数据

#### Scenario: 平台未运行
- **WHEN** 用户打开的本地诊断平台不可用
- **THEN** 系统显示明确的不可用状态和启动指引，接口层本机日志仍可使用

## REMOVED Requirements

### Requirement: 用确定性 Mock 展示模型层运行记录
**Reason**: 模型调用的事实来源改为本地 Phoenix；Mock 会话列表或本地投影会与真实追踪分叉。
**Migration**: 移除模型层 Mock 列表和相关筛选，改为 Phoenix 诊断入口；接口层真实日志保持不变。

### Requirement: 以全页结构查看模型会话详情
**Reason**: 完整模型调用详情由 Phoenix 展示，ActionDriver 不再维护第二套模型详情 UI。
**Migration**: 从模型诊断入口打开 Phoenix 页面；不再在日志主内容区渲染自制模型详情。

### Requirement: 导航动态模型调用链并查看完整数据
**Reason**: 动态模型调用、工具输入输出和提示词以 Phoenix 中的真实 trace 为准。
**Migration**: 在 Phoenix 查看模型调用详情；Grafana/Tempo 保留不含原文的跨服务调用链。
