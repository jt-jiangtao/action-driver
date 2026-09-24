# 本地观测平台

当前边界：本地 Grafana、Loki、Tempo、Prometheus 与 Alloy 承担运行诊断；模型调用原文和模型层日志由 LangSmith 承担。Phoenix 容器与下方 2026-09-24 早期验收记录保留用于查看历史数据，不再接收新模型调用作为权威来源。LangSmith 配置与入口见 [LangSmith 模型层日志](langsmith-model-logs.md)。

从仓库根目录执行：

```bash
docker compose -f deploy/observability/compose.yaml up -d
docker compose -f deploy/observability/compose.yaml ps
```

入口：Grafana `http://127.0.0.1:3000`、Phoenix `http://127.0.0.1:6006`、Alloy `http://127.0.0.1:12345`。应用向 `http://127.0.0.1:4318` 发送 OTLP/HTTP。Loki、Tempo、Prometheus 的本机诊断端口分别为 3100、3200、9090。所有发布端口仅监听 loopback，不应将此无认证单机栈直接暴露到局域网或公网。

ActionDriver 设置中没有本地运行诊断入口，请在浏览器直接打开上述地址。Grafana 首页默认展示“ActionDriver 观测概览”，含最近 24 小时的调用量、错误量、P95 耗时和应用日志；更多数据从左侧 **Explore** 选择 Loki、Tempo 或 Prometheus 查询。例如 Loki 查询 `{service_name=~"actiondriver-(main|service)"}`，Prometheus 查询 `actiondriver_calls_total`，Tempo 可按 `trace_id` 检索调用链。模型输入和输出不在 Grafana 中，应从应用的模型层日志入口查看 LangSmith 详情。

Grafana 为方便本机无登录诊断，将匿名角色设为 Editor：任何能访问本机 3000 端口的进程或用户都能编辑非预配的仪表盘。预配概览以只读文件为准。若要开放给其他主机或多人使用，必须先改为认证和最小权限部署。

启动后可逐项检查：

```bash
docker compose -f deploy/observability/compose.yaml ps
docker compose -f deploy/observability/compose.yaml run --rm --no-deps alloy validate /etc/alloy/alloy.alloy
curl -fsS http://127.0.0.1:3000/api/health
curl -fsS http://127.0.0.1:12345/-/ready
curl -fsS http://127.0.0.1:3100/ready
curl -fsS http://127.0.0.1:3200/ready
curl -fsS http://127.0.0.1:9090/-/ready
curl -fsS http://127.0.0.1:6006/healthz
curl -fsS http://127.0.0.1:3000/api/datasources
```

Tempo 镜像不含 shell，Compose 的 Tempo healthcheck 只确认进程二进制可执行；真实就绪状态以宿主机访问 `/ready` 的结果为准。Grafana 的 Tempo 插件没有实现通用 datasource health API，需通过 Grafana 代理查询一条已知 trace 验证。

Grafana、Loki、Tempo、Prometheus、Phoenix、Alloy 使用独立 Docker 命名卷。Loki 和 Tempo 的目标保留期为 7 天，Prometheus 保留 7 天；Phoenix 的 SQLite 使用持久卷，当前不自动设置统一保留期，需监控磁盘并按 Phoenix 运维流程清理。停止服务用 `docker compose -f deploy/observability/compose.yaml down`，不要加 `-v`，否则命名卷中的历史数据会被删除。

新模型调用的完整内容只在 LangSmith 查看；Phoenix 仅保留早期历史。Loki 保存运行日志和 HTTP/IPC/WebSocket 调用摘要，Tempo 保存脱离模型原文的调用链；这些日志没有本机备用副本。Alloy 停机或队列溢出时任务继续运行，未被平台接收的日志可能丢失。旧版本留下的本机文件不会自动删除，也不会自动迁入平台。

真实环境验收应检查本地运行诊断容器健康、Grafana 三个数据源、一次带唯一标记的模型输入输出在 LangSmith 可见而 Loki/Tempo 不可见，并检查重启后已接收的本地运行诊断数据仍可查询。不要在验收记录中粘贴模型 API Key、鉴权头或真实用户敏感内容。

2026-09-24 首次搭建验收：六个容器均显示 healthy；合成 OTLP 日志、指标、trace 分别可在 Loki、Prometheus、Tempo 查询，同一 trace 的完整标记属性与事件可在 Phoenix SQLite 查询，Tempo 返回的 span 不含该标记，Loki 全局查询亦无该标记；执行 `docker compose restart` 后四处历史信号仍可查询。该记录只验证采集栈，不代替后续真实任务的端到端验收。

应用联调可运行：

```bash
ACTIONDRIVER_LIVE_OBSERVABILITY=1 corepack pnpm exec vitest run packages/observability/tests/otel-live.test.ts
corepack pnpm test:e2e:local
```

2026-09-24 应用联调验收：用真实 Electron Main、Runtime 和本机 Docker 栈，连接本机假 OpenAI 流式服务完成两个回合，并重启 Electron 验证业务会话恢复。Phoenix 中两个 `chat e2e-stream-model` span 均包含完整输入和输出；最新模型 span 的 `parent_id` 对应 WebSocket 命令 span。Loki 中可查 Main/Runtime 的 HTTP、IPC、WebSocket 摘要，测试提示词不在 Loki 记录内；Tempo 可按同一 trace ID 查询这些 span，但模型输入原文不在允许字段中。一个模型连接配置 trace 同时包含 `actiondriver-main` 与 `actiondriver-service` 的 span；Prometheus 可查 `actiondriver_calls_total` 和调用耗时直方图。Loki 的实际 label 列表只有 `service_name`，task/request/trace ID 留在结构化元数据中。E2E 的用户数据目录没有新增 `logs` 目录。临时停止 Alloy 再运行同一 E2E 仍成功，启动 Alloy 后 `/ready` 恢复；停机期间的日志不保证补录。

本验收使用本机假模型响应，不需要真实模型 API Key；它验证了真实 Electron/网络/容器路径，但不验证外部模型供应商可用性。旧版本的日志读取实现留在源码供历史测试使用，生产启动路径不再注册本机日志查询入口。全量单测、类型检查、Lint、构建与本地 Runtime E2E 已通过；视觉 E2E 的 Home 模型选择仍等待旧的 `gpt-4.1` mock 选项而超时，与本次观测页面无关，设置页用例单独通过。

补充故障验收：停止 Loki 后重新运行同一 Electron E2E，两个真实流式回合和业务持久化仍通过；随后恢复 Loki。批处理队列压力单测使用始终不完成的 exporter 连续写入 10,000 条结构化记录，业务调用不抛错，关闭按超时上限返回且失败状态增加。这些检查只证明业务不依赖日志后端，不保证故障期间每条记录都被保存。

Grafana 可见性修复验收：此前匿名 Viewer 无 Explore 权限且仪表盘列表为空，虽可通过 Grafana 代理 API 查询到日志和指标，首页仍看不到数据。改为本机匿名 Editor 并预配概览后，真实浏览器打开首页显示调用量、错误量、P95 耗时及 ActionDriver 日志，左侧 Explore 可访问；Grafana 代理对 Loki、Tempo、Prometheus 的查询均返回实际数据。

应用入口移除验收（历史记录）：设置页组件测试、交互契约校验和真实 Electron 两回合 E2E 通过；设置侧栏没有本地运行诊断按钮，Preload 不再暴露平台导航或本机日志读取方法，Main 不注册旧日志或平台外链 IPC。当时全量 Vitest 为 635 通过、3 跳过。后续架构收敛已修复异步模型列表展开和视觉脚本选择停用模型的问题；完整视觉 E2E 的 3 个用例现已通过。
