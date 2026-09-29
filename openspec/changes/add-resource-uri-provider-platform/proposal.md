## Why

任务输入、生成产物和插件资源目前各有标识与读取入口，调用方需要理解不同存储来源。统一的资源 URI 和 provider 契约可支持本地与远程资源，同时把读写、列举和监听交给资源所有者处理。

Battle 已完成：用户明确要求完整平台能力，包含读取、写入、列举、监听及本地/远程 provider，且保留任务归属和历史产物不可变规则。已比较“只统一只读打开入口”和“提供完整 provider 协议”；Agent 推荐前者作为较小首版，用户在获知权限与迁移风险后选择后者。该覆盖决定及代价已接受，无未裁决关键分歧。

## What Changes

- 引入可序列化、可校验的资源 URI，以及按 scheme 注册的 provider，提供读取、写入、列举、监听和取消能力。
- 将会话输入、任务产物、插件资源和远程资源接入统一解析入口；资源权限以权威任务/会话上下文校验，不能只信任 URI 字符串。
- 定义写入冲突、版本、断连、监听重连与 provider 卸载后的行为。
- 保留历史产物不可变副本和跨会话输入隔离；任意 URI 不得绕过现有本地文件打开限制。

## Capabilities

### New Capabilities

- `resource-uri-platform`：资源 URI、provider 注册、操作语义及安全边界。

### Modified Capabilities

- `generated-local-files`：登记产物可经统一资源接口读取，同时维持不可变版本与安全打开规则。
- `session-input-files`：会话输入可经统一资源接口读取，同时维持任务归属和跨会话隔离。

## Impact

影响 `packages/runtime-contracts`、`packages/plugin-contracts`、Runtime 文件存储与插件 Host API、Desktop 资源打开桥接以及远程 provider 传输。需要版本化迁移现有资源标识和历史数据引用。
