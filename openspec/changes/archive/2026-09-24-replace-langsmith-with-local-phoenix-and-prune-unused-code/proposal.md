## Why

当前 Runtime 在配置密钥时仍向 LangSmith 发送模型调用内容，但应用内模型日志入口已移除；同时，本地 Phoenix 已部署却未接入当前模型网关。仓库还保留旧日志 IPC、本地日志读取及仅由测试引用的生产模块，造成多套相互矛盾的观测边界和维护成本。

## What Changes

- **BREAKING** 取消 ActionDriver 主动接入 LangSmith 的追踪、查询、内嵌详情及环境变量配置；模型调用输入、输出和错误详情改由 Runtime 的 OpenTelemetry 模型 span 送往本地 Phoenix，Tempo/Loki 仍不接收原文。
- 模型追踪失败或本地 Phoenix 不可用时，任务继续执行；运维文档说明这段模型追踪可能丢失，ActionDriver 不提供模型日志页面或伪造的本地回退。
- 清除已无读取方的模型日志 DTO、列表/详情适配器、旧日志 IPC、本地日志读取实现和可证实无生产用途的包依赖；停止新增仅供旧模型日志使用的 `model_calls` 原文副本，但保留现有数据库表与历史数据，不执行破坏性迁移。
- 对扫描出的候选逐项核对生产入口、动态加载、数据迁移、测试和设计审计用途。保留仍在执行的旧模型连接迁移、真正使用的共享包及测试基础设施；更新相关测试、文档和过时的 OpenSpec 变更状态。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `self-hosted-observability`: 把模型调用原文的权威来源从 LangSmith 改为本地 Phoenix，规定故障与数据隔离边界，并删除过时的应用内 LangSmith 入口例外。

## Impact

- Runtime 模型网关、进程装配、观测适配器、SQLite 模型调用投影及关联测试；Desktop 遗留模型/接口日志代码和共享 DTO；`langsmith` 依赖与锁文件。
- 本地 Alloy/Phoenix/Tempo 采集链路维持现有部署，新增真实模型调用验收以验证父子 span、原文隔离及采集器停机行为。
- `openspec/changes/use-langsmith-model-logs` 的未完成方向被此变更取代；历史归档文档作为历史记录保留，当前主规范和运维文档更新为 Phoenix 方案。
- Battle 已完成：比较过“移除全部模型内容追踪”和“改接本地 Phoenix”。用户最终选择本地 Phoenix，并接受本地采集链路增加运维成本、采集器不可用时模型追踪丢失，以及本机持久卷保存完整模型内容的代价。实施时发现 LangGraph 通过 `@langchain/core` 间接携带 LangSmith；用户再次裁决保留 LangGraph 及其惰性间接依赖，只移除 ActionDriver 主动追踪。与彻底移除 SDK 相比，此方案避免重写编排与 checkpoint，但必须禁止继承环境变量意外启用 LangChain 自动追踪。
