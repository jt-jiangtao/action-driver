# 移除 LangSmith 并接入本地 Phoenix：设计说明

## 目标与现状

用户要移除 LangSmith，同时扫描并删除没有实际用途的代码、模块和依赖。最终裁决是保留完整模型调用追踪，但把它接到已部署的本地 Phoenix。成功标准是：一次真实模型调用可在 Phoenix 中查看输入、输出和错误；相同调用的 Tempo/Loki 记录不含原文或鉴权凭据；Phoenix 停机不会改变任务结果；生产包不再包含 LangSmith 运行路径或 SDK。

现有 Runtime 启动时注入 LangSmith 适配器，配置 `LANGSMITH_API_KEY` 后会发送内容。Phoenix 适配器已实现但未装配，且其类型反向引用 LangSmith 文件。Desktop 的模型日志列表、LangSmith 内嵌视图、旧日志 IPC 与本地日志读取模块没有生产入口。SQLite `model_calls` 有新增写入但没有生产读取方；历史行可能包含完整请求和响应。Main 的旧模型连接 JSON 迁移仍在每次生产启动路径中，不能误删。

## 用户裁决与替代方案

| 方案 | 收益 | 代价 | 结论 |
| --- | --- | --- | --- |
| 移除 LangSmith 并接入本地 Phoenix | 观测数据留在本机，复用现有 Alloy/OTel 链路，保留完整调用排查能力 | 需要维护本地平台；采集器停机时追踪可能丢失；本机卷保存完整内容 | 用户选择 |
| 同时取消所有模型内容追踪 | 依赖和隐私面更小 | 无法在观测平台查看完整模型调用 | 未选择 |
| 继续使用 LangSmith | 已有远端查询与 UI 能力 | 内容出站、额外凭据和两套观测边界 | 未选择 |

先前建议过取消全部模型内容追踪；用户明确改选 Phoenix。该覆盖的已知风险是本地平台的运维与持久卷敏感内容管理。除这一选择外，检查了运行入口、数据所有权、失败模式、打包和测试边界，无其他未裁决的实质性异议。

## 架构与数据流

模型网关只依赖 Runtime 内部的窄追踪端口。Runtime 从现有 OTel 进程观测对象取得 tracer，注入 Phoenix 适配器。适配器在模型调用开始时创建携带会话、任务、请求与关联标识的 OpenInference span，在成功、取消或失败终态写入完整响应、用量和状态并结束 span。适配器在写入前过滤 API Key、Authorization、Cookie、Token 等凭据字段。模型网关捕获追踪异常，业务响应仍以模型上游结果为准。

```text
Renderer -> Runtime task -> Model gateway -> model provider
                         |
                         +-> OTel model span -> Alloy -> Phoenix (完整内容)
                                                    -> Tempo (允许字段)
                         +-> OTel 摘要日志 -> Alloy -> Loki (无正文)
```

Phoenix 通过现有本地 Docker Compose 和持久卷部署。Alloy 继续保留 Phoenix/Tempo 双分支：Phoenix 可看原文，Tempo 分支在导出前剥离原文属性。应用不提供日志页面或 Phoenix 专用 IPC；地址和启动方式留在运维文档。模型追踪无本地补录队列，不承诺采集器停机期间的数据恢复。

## 清理边界

从 Electron Main、Preload、Renderer、Runtime、包公开入口、脚本和设计验收入口建立引用图。仅有静态零引用不足以删除；还须核对动态导入、打包配置、旧数据迁移和当前验收用途。删除 LangSmith SDK/适配器、没有生产入口的模型日志 DTO/服务与内嵌视图、旧日志 IPC/本地读取、以及与这些路径一起退役的依赖和测试。仍服务视觉审计或有效 Mock 场景的组件可以保留，并记录理由。

新模型调用不再向 `model_calls` 写完整请求/响应；保留历史 SQLite 表与行，不自动清除用户数据，也不改任务、消息、事件和 checkpoint。已归档的旧 OpenSpec 决策保留历史原貌；当前主规范、运维文档和未完成的 LangSmith 变更状态改为新方向。

## 验收与风险

- Runtime 单元/集成测试覆盖流式与非流式成功、失败、取消、凭据过滤、同 trace 关联和采集失败时业务继续。
- 本地真实采集测试用唯一标记验证 Phoenix 中有模型原文、Tempo/Loki 中无原文与鉴权凭据。
- 旧库夹具验证历史 `model_calls` 行保留、新请求完成且不再新增该类行。
- 依赖与引用扫描、类型检查、Lint、单元测试、Electron 本地端到端、macOS 打包冒烟和 OpenSpec 严格验证全部通过后，才认定清理完成。
- 历史 LangSmith 数据不会自动复制或删除；回滚旧应用版本可能重新启用旧出站路径，部署文档需说明这一点。

对应 OpenSpec 变更：`openspec/changes/replace-langsmith-with-local-phoenix-and-prune-unused-code/`。
