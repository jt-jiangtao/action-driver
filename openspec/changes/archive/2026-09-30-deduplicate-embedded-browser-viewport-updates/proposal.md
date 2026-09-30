## Why

内嵌浏览器面板在初次挂载、`ResizeObserver` 和窗口 `resize` 时发送视口状态；主进程目前对每次合法请求都对所有页签调用 `setBounds` 和 `setVisible`，即使尺寸与可见性没有变化。代码路径能够证明存在重复调用机会，但尚无运行时频率数据，因此本变更先以定向调用计数证明减少的工作量，不预设用户可感知的提速幅度。

## What Changes

- 在内嵌浏览器宿主中，连续收到相同视口尺寸和可见性时跳过重复视图同步；任一值变化时立即同步。
- 用定向单元测试核对重复请求、尺寸变化、可见性变化、页签切换与新页签的行为及方法调用次数。
- 保持既有渲染进程订阅、preload 桥接、IPC 请求格式与主进程任务归属校验。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

无。此变更只减少相同输入对应的重复内部调用；现有 `agent-task-experience` 与 `desktop-shell` 的可见要求保持不变，故在 `.openspec.yaml` 中设置 `skip_specs: true`。

## Impact

- 目标代码：`apps/desktop/src/main/browser-session/embedded-host.ts`。
- 验证：`apps/desktop/tests/unit/main/browser-session/embedded-host.test.ts`；必要时核对现有 manager 与 BrowserPanel 定向测试。
- 无公共接口、IPC 通道、依赖或持久化变更。

## Battle 状态

- **已完成。** 用户目标是持续优化项目，并在比较主进程去重与渲染进程合并发送后确认按推荐方案继续。
- 事实：渲染侧存在两个尺寸变化回调来源；宿主当前每次 `setViewport` 均调用 `syncViews`。假设：实际使用中可能收到内容相同的连续请求；是否频繁尚待测量。
- 最终方向：在拥有 Electron 视图的主进程宿主处进行相同状态去重，并用调用计数验证；不以未经测量的帧率或延迟收益作结论。
- 关键分歧：无。已公开渲染侧合并发送可能引入更新延迟的权衡；用户未覆盖推荐。若发现需要改变请求时序、IPC 契约或可见行为，重新开启 Battle。
