# LangSmith 模型层日志

模型层日志直接读取 LangSmith 项目中的 ActionDriver 模型 trace。模型调用详情在桌面应用内的隔离视图中展示 LangSmith 页面；不会在系统浏览器外跳，也不会从本地 SQLite 或 Mock 数据静默回退。

## 配置

在启动 ActionDriver 的环境中设置：

| 变量 | 要求 | 用途 |
| --- | --- | --- |
| `LANGSMITH_API_KEY` | 必填 | Runtime 写入和查询 trace；不会传给 Renderer 或 Desktop Main。 |
| `LANGSMITH_PROJECT` | 可选，默认 `default` | 指定写入和读取的项目；建议使用隔离项目验证。 |
| `LANGSMITH_ENDPOINT` | 可选，默认 `https://api.smith.langchain.com` | LangSmith API 的 HTTPS origin；不能包含凭据、路径、查询或片段。区域端点会映射到对应的 LangSmith Web origin。 |

配置后重启应用，发起真实模型调用，再打开「日志 → 模型层」。列表按 ActionDriver 会话聚合，支持会话/任务切换、搜索、状态筛选、展开和自动刷新。点击详情将在当前窗口中打开 LangSmith 页面；关闭后仍停留在原列表状态。首次查看详情可能需要在嵌入页面中登录 LangSmith。

## 数据与限制

- 模型输入（包括可能含系统提示词的消息）、输出、用量、错误和关联元数据会发送到所配置的 LangSmith 项目。请只在已获准发送这些数据的环境中启用。
- 已知的 `LANGSMITH_API_KEY` 值、常见鉴权头和凭据字段会在追踪载荷中脱敏；这不是对任意业务敏感信息的自动识别或合规保证。
- 没有 API Key、网络不可用、项目无权限或 LangSmith 故障时，模型层显示配置/查询错误，不显示本地旧日志。接口层日志与任务历史不受此切换影响。
- 只显示当前项目中带 ActionDriver 关联元数据的 trace；不会回填改动前的本地调用历史。刚完成的调用可能需要等待下一次自动刷新。
- 嵌入页面只允许 HTTPS 导航，禁止弹窗；若登录服务依赖非 HTTPS 跳转或弹窗，详情可能无法完成登录。

## 验证

使用独立 LangSmith 项目与测试模型凭据启动桌面应用，分别运行成功和失败的真实模型调用；检查模型层列表的会话、任务和状态，再打开两级详情，确认页面留在应用窗口内。清空 API Key 重启后，确认模型层显示明确配置错误且没有本地/Mock 回退。不要把测试项目凭据提交到仓库。
