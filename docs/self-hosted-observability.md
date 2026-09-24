# 本地观测平台

从仓库根目录执行：

```bash
docker compose -f deploy/observability/compose.yaml up -d
docker compose -f deploy/observability/compose.yaml ps
```

入口：Grafana `http://127.0.0.1:3000`、Phoenix `http://127.0.0.1:6006`、Alloy `http://127.0.0.1:12345`。应用向 `http://127.0.0.1:4318` 发送 OTLP/HTTP。Loki、Tempo、Prometheus 的本机诊断端口分别为 3100、3200、9090。所有发布端口仅监听 loopback，不应将此无认证单机栈直接暴露到局域网或公网。

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

只在 Phoenix 查看完整模型内容。Loki 保存运行日志和 HTTP/IPC/WebSocket 调用摘要，Tempo 保存脱离模型原文的调用链；这些日志没有本机备用副本。Alloy 停机或队列溢出时任务继续运行，未被平台接收的日志可能丢失。旧版本留下的本机文件不会自动删除，也不会自动迁入平台。

真实环境验收应检查所有容器健康、Grafana 三个数据源、一次带唯一标记的模型输入输出在 Phoenix 可见而 Loki/Tempo 不可见，并检查重启后已接收数据仍可查询。不要在验收记录中粘贴模型 API Key、鉴权头或真实用户敏感内容。

2026-09-24 首次搭建验收：六个容器均显示 healthy；合成 OTLP 日志、指标、trace 分别可在 Loki、Prometheus、Tempo 查询，同一 trace 的完整标记属性与事件可在 Phoenix SQLite 查询，Tempo 返回的 span 不含该标记，Loki 全局查询亦无该标记；执行 `docker compose restart` 后四处历史信号仍可查询。该记录只验证采集栈，不代替后续真实任务的端到端验收。
