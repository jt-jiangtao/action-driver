## Context

参见 `proposal.md`。目前 Runtime 的 `ConnectionModelGateway` 在每次调用前后写入本地 `model_calls`，`local-runtime-server` 再把 SQLite 中的任务、消息和调用记录投影为 `model-log.list`/`model-log.get`。Renderer 用该投影构建会话、任务和应用内调用详情。Runtime 已采用 LangGraph，但尚未直接依赖或配置 LangSmith；Desktop 已拒绝所有非受信任导航。

## Goals / Non-Goals

**Goals:**

- 用 LangSmith 追踪真实模型调用，并以 ActionDriver `sessionId`、`taskId`、`requestId` 保持可查询的对应关系。
- 让模型层列表直接消费 LangSmith 会话摘要，详情由应用内隔离视图中的 LangSmith UI 展示。
- 将 LangSmith API 访问限制在 Runtime，将远程内容创建和导航限制在 Desktop Main 的验证入口，Renderer 不接触 API Key 或任意 URL。

**Non-Goals:**

- 不新增应用内 LangSmith 设置、凭据存储、项目切换、SSO 或账户管理。
- 不迁移或删除既有 SQLite `model_calls`，也不改变任务、消息、接口层日志或模型供应商连接的事实来源。
- 不实现离线镜像、补偿上传历史调用，或复制 LangSmith 的调用树详情。

## Decisions

### 1. LangSmith 是模型层日志唯一读取源

Runtime 在模型网关边界围绕真实调用创建、完成或失败 LangSmith trace；追踪元数据持有 `sessionId`、`taskId`、`requestId`、`correlationId` 和模型引用。为使 trace 可以聚合为产品会话，任务创建与模型请求必须向网关提供稳定的 `sessionId`，并使用它作为 LangSmith thread 关联值。列表查询只读取当前项目的根 trace/thread 及必要的任务子 trace 字段，按会话聚合并映射为现有列表 DTO；不查询或复制详情输入输出到 Renderer。

被否方案是保留 SQLite `model_calls` 作为列表来源，仅给每行增加 LangSmith 深链。它保留离线能力，但产生两套可能分歧的事实来源，违背用户“直接使用”框架日志的裁决。

### 2. 只从标准启动环境读取 LangSmith 配置

Runtime 启动时读取 `LANGSMITH_API_KEY`、可选 `LANGSMITH_ENDPOINT` 和 `LANGSMITH_PROJECT`，并构造一个集中式 LangSmith 适配器；缺少 API Key、端点非法或 SDK 初始化失败时将适配器标为不可用，模型层日志查询返回明确配置错误。追踪和查询使用同一配置，API Key 不穿过 RPC、IPC、日志摘要或 Renderer。

替代方案是在模型连接设置中新增 LangSmith 表单和本地加密存储。该方案对最终用户更易发现，但会扩大设置、迁移和秘密生命周期边界；用户确认首版只使用环境变量，因此不采用。

### 3. 详情 URL 由 Runtime 产生、Desktop Main 验证并在隔离视图展示

LangSmith 查询适配器从当前查询返回的 run/thread 的应用路径或 SDK URL 生成详情地址，并连同列表摘要及根据配置端点确定的 Web origin 返回。预加载层只暴露类型化的展示、定位和关闭详情动作；Desktop Main 比较 URL 的 HTTPS 协议和 Runtime 返回的 Web origin，并确认目标为当前列表记录的详情地址后，才创建 `WebContentsView`。远程视图不加载 ActionDriver preload，关闭 Node 集成，启用 sandbox、context isolation 和 webSecurity；独立处理 HTTPS 导航及新窗口请求，不允许远程内容导航应用主窗口。Renderer 只提供视图在窗口内容区的边界，并保留列表组件状态。

先前方案是系统默认浏览器外跳，隔离及登录成本较低，但离开应用；用户重新裁决为应用内展示。直接使用 `<webview>` 标签也可实现，但 Electron 官方提示其架构与稳定性风险，因此选择由 Main 管理的 `WebContentsView`。登录重定向可在隔离视图内走 HTTPS；非 HTTPS 跳转及弹窗一律拒绝。

### 4. 模型层 UI 保留列表交互，移除应用内详情状态

保留会话/任务切换、搜索、状态筛选、展开和自动刷新。`ModelLogService` 的列表项增加经 Runtime 查询返回的详情标识或 URL；会话和任务详情按钮在列表上方打开可关闭的嵌入视图。移除 `model-log.get` UI 调用、`ModelSessionDetail` 状态和本地请求/响应区块，页脚明确数据来自 LangSmith。关闭详情后恢复此前列表状态。

## Risks / Trade-offs

- [系统提示词、用户输入和模型输出离开本地设备] → 用户已在 Battle 中明确接受；仅发送追踪所需字段，持续过滤 API Key、鉴权头和本地凭据。
- [离线、未配置或 LangSmith 服务异常时没有模型层历史可查看] → 显示可诊断错误与重试；不以 SQLite 或 Mock 静默降级，接口层日志和任务页继续可用。
- [异步追踪写入造成刚完成任务短暂未出现在列表] → 调用终态前 flush 有界追踪队列；列表自动刷新，仍未可见时显示真实空/错误状态而非伪造记录。
- [详情 URL 被篡改或远程页面试图访问桌面能力] → 只接受当前查询所产生、HTTPS 且与配置 Web origin 匹配的初始地址；隔离视图无 preload、Node 权限与应用 IPC。拒绝非 HTTPS 导航和新窗口请求。
- [内嵌登录、Cookie 或 SSO 流程与系统浏览器不同] → 在隔离视图中使用独立页面会话；登录可能需要在视图内完成，失败时展示可诊断页面错误，不恢复外跳。
- [SDK API/数据模型变更] → 以 Runtime 内部适配器隔离 SDK 类型，公共 contracts 只暴露 ActionDriver DTO。

## Migration Plan

1. 增加 LangSmith SDK 与 Runtime 适配器，先以单元测试验证配置、追踪安全化、会话映射和 URL 生成。
2. 把模型网关接入追踪，并将 Runtime 模型日志 RPC 切换为 LangSmith 查询；保留 SQLite 写入以避免影响当前任务持久化和回滚。
3. 增加 Main/Preload 的隔离详情视图 IPC 白名单与生命周期控制，替换 Renderer 的自制调用详情视图并更新交互与端到端测试。
4. 在配置了测试 LangSmith 项目的隔离环境中验证成功、失败、空结果、缺配置和不可信 URL；发布时记录环境变量要求。
5. 回滚时恢复前一个应用版本；本次不删除 SQLite 模型调用数据，故无需数据回迁。
