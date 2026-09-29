# 跨宿主能力运行位置

## 目标

让插件能力声明 UI、本地工作区、远程工作区或云端运行要求与偏好，宿主据设备、数据、安装位置和授权选择唯一执行位置。断连、取消、恢复、升级期间保持调用结果和实例归属可信。完整行为契约见 [OpenSpec](../../../openspec/changes/place-capabilities-across-hosts/specs/capability-placement/spec.md)。

## 边界与设计

运行位置与 `tools/local/...`、`tools/cloud/...` 的 target 分开判断；位置选择不会转移 grants。各宿主以版本化握手公布能力，调用固定宿主与插件实例。断连撤回新调用，副作用未确认时标记结果未知；重连后重新验证授权和实例，禁止自动重放。跨宿主传递最小任务上下文与受控资源引用，UI 不获得原始 Electron/Node 能力。

## 已裁决的取舍

曾建议先做位置声明与静态校验，避免过早建设远程调度。用户选择完整多宿主能力，确认位置选择、断连、取消和恢复都纳入范围。主要风险是跨进程传输、远程运维和数据暴露面扩大；用实例固定、最小授权、资源 URI 校验与故障演练缓解。实施依赖贡献平台和资源 URI 契约稳定，任务见 [OpenSpec tasks](../../../openspec/changes/place-capabilities-across-hosts/tasks.md)。
