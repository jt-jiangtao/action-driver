# 本机 SearXNG（Docker）

ActionDriver 的 Web Search 只连接到用户自行管理的本机 SearXNG。它不会把镜像、容器或配置打包进 Electron，也不会启动、升级、停止或读取 Docker。

## 前置条件

安装并启动 Docker Desktop（或兼容 Docker Compose 的 Docker Engine）。以下命令均从仓库根目录运行。

## 启动

```sh
docker compose -f deploy/searxng/compose.yaml up -d
```

服务仅发布到 `127.0.0.1:8080`。首次启动会拉取官方 `docker.io/searxng/searxng` 镜像；若需要可重复的镜像版本，请在 `deploy/searxng/compose.yaml` 将 `latest` 替换成你审核过的固定 tag 或 digest。

验证 JSON API：

```sh
curl --fail --get 'http://127.0.0.1:8080/search' \
  --data-urlencode 'q=ActionDriver' \
  --data-urlencode 'format=json'
```

停止服务但保留搜索缓存：

```sh
docker compose -f deploy/searxng/compose.yaml down
```

删除缓存（可恢复性较低）：

```sh
docker compose -f deploy/searxng/compose.yaml down --volumes
```

## 连接 ActionDriver

在启动桌面开发进程的同一个终端设置环境变量：

```sh
ACTIONDRIVER_SEARXNG_ENDPOINT=http://127.0.0.1:8080 corepack pnpm dev
```

可用地址只有带显式端口的 `http://127.0.0.1:<port>` 或 `http://[::1]:<port>`。`localhost`、远程地址、HTTPS、凭据、路径前缀和重定向均被拒绝。环境变量缺失或非法时，应用不会向网络发送请求，且模型看不到 Web Search 工具。

每次 `web.search` 调用都要在应用中单独批准。工具只请求固定的 `/search?format=json`，从不打开或抓取搜索结果链接。

## 日志与故障排查

应用本地 L1 审计会保留查询与长度受限的规范化标题、URL、摘要和来源元数据，供工具聚合记录和真实模型回合关联。它不写入 SearXNG 原始 JSON、HTTP 请求/响应头、API key、Cookie、认证头或代理凭据。

- `curl` 失败：运行 `docker compose -f deploy/searxng/compose.yaml logs searxng`，确认 Docker 正在运行且 8080 未被占用。
- 返回非 JSON：确认 [settings.yml](../deploy/searxng/settings.yml) 的 `search.formats` 含 `json`，再重启容器。
- ActionDriver 中没有 Web Search：确认桌面进程继承了 `ACTIONDRIVER_SEARXNG_ENDPOINT`，且地址是上述字面量 loopback 格式。
- 搜索为空或上游报错：这是 SearXNG 上游引擎的运行状态；ActionDriver 不回退到公共实例，也不会抓取网页作为替代。

官方参考：[SearXNG Docker 安装](https://docs.searxng.org/admin/installation-docker.html) 与 [搜索 API](https://docs.searxng.org/dev/search_api.html)。
# 历史部署说明

默认 web 搜索已迁移至 Tavily，网页读取使用 Jina Reader。请按 [网络工具配置](web-tools.md) 设置密钥；下文保留用于维护已有 SearXNG 部署，旧 endpoint 不再启用默认工具。
