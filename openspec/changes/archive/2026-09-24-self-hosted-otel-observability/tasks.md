## 1. 本地观测平台

- [x] 1.1 建立独立的 Docker Compose、固定镜像版本和持久卷，部署 Grafana、Alloy、Loki、Tempo、Prometheus、Phoenix；用 `docker compose config` 和全部服务健康检查验证。
- [x] 1.2 配置 Alloy 的 OTLP logs/traces/metrics 管线、容器日志采集、Phoenix 完整模型分支及 Tempo 属性允许字段分支；用带标记内容的测试信号验证 Loki/Tempo 不含模型原文、Phoenix 含原文。
- [x] 1.3 预配 Grafana 数据源及 trace-to-logs 关联，限定宿主机端口为 loopback；用 Grafana API 查询三个数据源并验证重启后历史数据仍可读。
- [x] 1.4 预配 Action-Driver 概览仪表盘并启用仅本机匿名 Editor 的 Explore；用真实浏览器确认首页能发现仪表盘、日志/指标面板有数据、Explore 可查 Loki/Tempo/Prometheus，且端口仍仅绑定 loopback。

## 2. 统一日志生产与本机存储退出

- [x] 2.1 为 `packages/observability` 建立窄的结构化日志接口及 OpenTelemetry Logs SDK 适配器、批处理/关闭行为和发送失败状态；单测覆盖属性、trace 关联、flush 超时和不可用采集器时业务不失败，类型检查通过。
- [x] 2.2 将 Main 与 Runtime 的运行日志生产端接到新适配器，停止 Pino 本机 JSON 文件输出；测试启动、失败和退出路径，并用文件系统断言确认不产生新运行日志文件。
- [x] 2.3 将 HTTP、Electron IPC、WebSocket 命令及单向事件改为结构化调用摘要，流式 chunk 只聚合；测试逐一覆盖传输、方向、操作、结果、耗时、错误、关联标识，并用标记正文断言日志不含任意请求/响应载荷。
- [x] 2.4 移除 `LocalInteractionLogStore` 的生产写入与 Runtime `GET /logs`、对应服务契约和测试期望；以运行时测试验证接口仍工作但没有本机日志新增写入或读取端点，不删除历史文件和任务业务状态。

## 3. 调用链、指标与模型内容

- [x] 3.1 为 HTTP、IPC、WebSocket 类型化消息实现 trace 上下文注入/提取，并在任务、工具、模型边界建立关键 span；跨进程集成测试断言共同 trace ID 和正确父子关系。
- [x] 3.2 采集请求量、错误率、耗时等低基数指标，高基数 ID 只留在结构化元数据；Prometheus 查询测试验证指标可用，Loki label 检查验证不以 task/request/trace ID 建索引。
- [x] 3.3 将模型追踪送本地 Phoenix，保证完整提示词、输入、输出和错误详情可查，并让 Tempo 只收到允许属性；真实模型调用使用唯一标记分别查询 Phoenix、Tempo、Loki 验证内容边界。
- [x] 3.4 对 Alloy 停止、Loki 不可用和日志批处理队列压力做故障测试；验证任务继续运行、发送失败可诊断，且不声称丢失日志能从本机恢复。

## 4. 产品入口与旧路径迁移

- [x] 4.1 移除 Action-Driver 设置侧栏的日志/观测入口、页面路由、Grafana/Phoenix 按钮及旧列表/详情；组件和 E2E 测试验证入口不可见且设置其他页面正常。
- [x] 4.2 移除专用平台外链 Main/Preload IPC 和对应契约；全局引用检查确认无应用内 Grafana/Phoenix 导航，运维文档提供直接访问地址。
- [ ] 4.3 清点当前未提交 LangSmith 代码与引用，迁移或撤下失效的查询/RPC/`WebContentsView` 路径及相关测试；类型检查和全局引用搜索验证生产路径不依赖 `LANGSMITH_API_KEY`，保留无关用户改动。

## 5. 文档与真实环境验收

- [x] 5.1 编写本地启动、健康检查、端口、数据卷、保留期、备份/删除、故障排查和日志丢失边界文档；照文档在干净 Docker 环境执行并记录可复现命令及结果。
- [ ] 5.2 运行单元、类型、Lint、构建及 Electron/Runtime 集成测试；记录命令与结果，修复本变更引入的失败，不改动无关用户文件。
- [x] 5.3 使用真实任务端到端验收：Grafana 查 HTTP/IPC/WS 摘要及指标、Tempo 查跨边界链路、Phoenix 查完整模型原文，验证 Loki/Tempo 无原文、平台重启后已接收数据仍在、平台停机时业务继续且应用内无日志副本。
