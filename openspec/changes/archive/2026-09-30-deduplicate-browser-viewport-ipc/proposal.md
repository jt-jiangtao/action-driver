## Why

定向探针在相同边界下触发挂载、窗口 `resize`、`ResizeObserver`、布局切换和卸载，记录到 6 次视口请求；其中前 3 次 `visible: true` 请求内容完全相同。上一轮主进程宿主去重只减少原生视图方法调用，重复请求仍经过 preload、IPC 和任务快照校验。该探针是合成事件计数，尚不能推断真实使用中的触发频率或用户可感知收益。

## What Changes

- 在内嵌 BrowserPanel 的单次效果生命周期中跳过与最近一次请求完全相同的边界及可见性请求，避免重复窗口与观察器回调产生相同 IPC。
- 保留初次同步、边界或可见性变化、布局切换时的隐藏与恢复，以及卸载时的隐藏请求。
- 发送失败后允许下一次相同事件重试；用定向测试验证请求数量和最终请求序列。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

无。`agent-task-experience` 与 `desktop-shell` 的用户可见要求不变；本变更只减少相同内容的内部跨进程请求，故设置 `skip_specs: true`。

## Impact

- 目标代码：`apps/desktop/src/renderer/src/components/BrowserPanel.tsx`。
- 定向测试：`apps/desktop/tests/unit/renderer/src/components/BrowserPanel.test.tsx`；必要时核对 preload、manager 和宿主测试。
- 不改变 Browser Session 的 IPC 通道、请求 DTO、主进程验证、会话所有权或依赖。

## Battle 状态

- **已完成。** 用户先确认“先计数再决定”，探针证实合成事件中存在 2 次可避免的相同请求；随后在“精确相同请求去重”与“按帧合并”间确认采用推荐的前者。
- 事实：相同边界的探针记录 6 次请求，其中 3 次连续可见请求相同。假设：真实交互中也可能出现此类回调；频率与耗时尚无实测。
- 最终方向：只过滤完全相同的请求，目标是同一探针从 6 次降至 4 次，并保持隐藏／恢复请求序列。失败后后续相同事件可重试。
- 关键分歧：无。用户未覆盖 Agent 推荐。若实施需要改变请求顺序、IPC 契约或可见状态，重新开启 Battle。
