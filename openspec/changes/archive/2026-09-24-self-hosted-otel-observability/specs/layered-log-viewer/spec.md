## REMOVED Requirements

### Requirement: 在接口层与模型层日志之间切换
**Reason**: 用户决定移除设置侧栏中整个日志/观测工作区，而非保留 Grafana/Phoenix 外链页面。
**Migration**: 删除侧栏入口、页面路由及专用外链 IPC；操作者从运维文档获取本地 Grafana/Phoenix 地址，在浏览器中直接查看。

### Requirement: 接口层日志使用真实数据源
**Reason**: 接口日志的事实来源已迁到 Loki；Action-Driver 不再提供本机接口日志列表。
**Migration**: 移除接口日志读取服务与前端列表；在 Grafana/Loki 查询结构化调用摘要。

### Requirement: 筛选并刷新接口层日志
**Reason**: 筛选、搜索和刷新由 Grafana/Loki 提供，应用内列表不再存在。
**Migration**: 移除本地筛选、自动刷新和相关查询契约；从运维文档打开 Grafana。

### Requirement: 查看接口事件详情及开合状态
**Reason**: 应用不再保存本机接口请求/响应正文或提供详情面板。
**Migration**: 移除本机详情 UI 与存储读取；使用 Grafana/Loki 的调用摘要和 Tempo 链路定位，模型原文只在 Phoenix 查阅。

### Requirement: 用确定性 Mock 展示模型层运行记录
**Reason**: 模型调用的事实来源改为本地 Phoenix；Mock 会话列表或本地投影会与真实追踪分叉。
**Migration**: 移除模型层 Mock 列表和相关筛选；从运维文档打开 Phoenix。

### Requirement: 以全页结构查看模型会话详情
**Reason**: 完整模型调用详情由 Phoenix 展示，Action-Driver 不再维护第二套模型详情 UI。
**Migration**: 从运维文档打开 Phoenix 页面；不再在应用中渲染自制模型详情。

### Requirement: 导航动态模型调用链并查看完整数据
**Reason**: 动态模型调用、工具输入输出和提示词以 Phoenix 中的真实 trace 为准。
**Migration**: 在 Phoenix 查看模型调用详情；Grafana/Tempo 保留不含原文的跨服务调用链。
