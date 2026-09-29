# 统一资源 URI 与 Provider 平台

## 目标

为任务输入、生成产物、插件资源及本地和远程资源建立统一 URI 与 provider 操作，包括读取、写入、列举和监听。URI 只标识资源；每次访问都由资源宿主根据权威任务与会话身份授权。完整行为契约见 [OpenSpec](../../../openspec/changes/add-resource-uri-provider-platform/specs/resource-uri-platform/spec.md)。

## 边界与设计

按 scheme 注册版本化 provider，统一元数据、流式内容、取消、版本冲突和监听重同步。会话输入与已登记产物保持只读；修改内容写入可写工作资源并形成新版本，旧任务卡片仍指向原副本。保留旧文件 ID 的兼容解析，不把 URI 当访问令牌，也不让页面通过任意 URI 打开本机路径。现有文件归属规则见 [生成产物 delta](../../../openspec/changes/add-resource-uri-provider-platform/specs/generated-local-files/spec.md) 与 [会话输入 delta](../../../openspec/changes/add-resource-uri-provider-platform/specs/session-input-files/spec.md)。

## 已裁决的取舍

曾建议只统一读取与打开，避免首版承担远程写入、监听和跨进程权限迁移。用户选择完整 provider 平台，确认本地/远程、读写、列举、监听均纳入范围，并要求保留现有任务归属和不可变产物。主要风险是 URI 越权、写入中断和监听丢事件；用逐次授权、预期版本提交与重同步语义缓解。实施顺序见 [OpenSpec tasks](../../../openspec/changes/add-resource-uri-provider-platform/tasks.md)。
