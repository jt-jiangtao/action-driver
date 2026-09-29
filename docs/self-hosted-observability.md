# 本地观测平台

ActionDriver 将运行日志、调用链和指标发送到本机 Alloy；模型调用的完整输入、输出和错误详情由本地 Phoenix 承载。Alloy 给 Tempo 的分支只保留允许的关联字段，Loki 只收运行摘要，不保存模型原文。应用内没有模型日志或观测平台页面。

## 启动与入口

从仓库根目录执行：

```bash
docker compose -f deploy/observability/compose.yaml up -d
docker compose -f deploy/observability/compose.yaml ps
docker compose -f deploy/observability/compose.yaml run --rm --no-deps alloy validate /etc/alloy/alloy.alloy
```

| 服务 | 本机地址 | 用途 |
| --- | --- | --- |
| Grafana | `http://127.0.0.1:3000` | 运行概览、Loki/Tempo/Prometheus Explore |
| Phoenix | `http://127.0.0.1:6006` | 查看完整模型调用、错误及用量 |
| Alloy | `http://127.0.0.1:12345` | OTLP 采集状态，应用向 4318 端口发送数据 |
| Loki | `http://127.0.0.1:3100` | 日志摘要 |
| Tempo | `http://127.0.0.1:3200` | 脱敏调用链 |
| Prometheus | `http://127.0.0.1:9090` | 指标 |

所有发布端口只绑定 loopback；这套无认证配置用于单机，不应直接暴露到局域网或公网。Grafana 匿名角色是 Editor，本机其他进程或用户可修改非预配仪表盘。预配概览由仓库文件控制。

可用 `curl -fsS` 检查 Grafana `/api/health`、Alloy `/-/ready`、Loki `/ready`、Tempo `/ready`、Prometheus `/-/ready` 和 Phoenix `/healthz`。Grafana 的 Tempo 插件没有通用健康 API，应查询一条已知 trace 验证。Tempo 容器自身 healthcheck 只确认进程可执行，以 HTTP `/ready` 为准。

Grafana 首页预配“ActionDriver 观测概览”，显示调用量、错误量、P95 耗时和日志。Explore 中可用 Loki 查询 `{service_name=~"actiondriver-(main|service)"}`、Prometheus 查询 `actiondriver_calls_total`，并按 trace ID 在 Tempo 查找调用链。模型输入和输出请直接在 Phoenix 中查看；应用不提供跳转入口。一次模型调用的 Phoenix span 含 `session.id`、`task.id`、`request.id`、`correlation.id`，可用相同 trace ID 对照 Tempo 与 Loki。

## 数据边界与故障

Phoenix 的持久 SQLite 卷保存完整模型原文，当前没有统一自动保留期。请限制本机访问、监控磁盘，并按本地数据策略备份或清理。旧版本的 Runtime 数据库可能仍有 `model_calls` 历史行；升级不会删除这些行，新模型调用不再写入。旧 LangSmith 远端历史也不会自动复制或删除。

Runtime 不再主动读取 LangSmith 凭据或向其写入模型追踪；LangGraph 仍通过 `@langchain/core` 间接携带惰性 LangSmith SDK。Runtime 启动时显式关闭继承的 LangChain/LangSmith 自动追踪开关。新模型调用不需要 LangSmith API Key。

Alloy、Phoenix 或其他采集服务不可用时，模型任务继续按模型上游结果执行；停机期间未送达的追踪和运行摘要允许丢失，应用不提供本地或 Mock 补录。Tempo 和 Loki 不应出现模型输入、输出或鉴权凭据；Phoenix 可保存业务原文，但 API Key、Authorization、Cookie 等凭据字段须在写 span 前过滤。容器服务使用独立命名卷；停止时运行 `docker compose -f deploy/observability/compose.yaml down`，不要加 `-v`，除非要删除历史数据。

## 验证

```bash
ACTIONDRIVER_LIVE_OBSERVABILITY=1 corepack pnpm exec vitest run packages/observability/tests/unit/otel-live.test.ts
corepack pnpm test:e2e:local
```

使用唯一测试标记运行本机假模型：确认 Phoenix 可查询输入、输出和错误状态，Tempo/Loki 按 trace ID 查不到模型原文，三个平台都查不到测试凭据。临时停止 Alloy 后再次运行同一任务，确认业务成功；恢复 Alloy 后检查 `/-/ready`。不要把真实用户内容或密钥粘贴到验收记录。

2026-09-24 的本机验收运行了真实 Electron → Runtime → 假模型的两轮流式调用。Phoenix 中的模型 span 与上层调用共享 trace ID，包含输入、输出和关联标识；同一 trace 的 Tempo 查询及 Loki 查询均未发现测试原文或测试 API Key。停止 Alloy 后再次运行该端到端场景仍通过，恢复后 `/-/ready` 返回正常。上述结果验证本机开发环境，不代表其他机器的容器配置已验收。
