## Context

`RuntimeToolPolicy` 对 Shell、风险非 low、文件写入或网络工具返回 `require_approval`。`ToolInvocationService` 持久化 `waiting_approval` 并等待同一 call id 和参数哈希的批准；`StreamSessionService` 处理 approve/reject 控制帧，Desktop 在输入框上方呈现审批条。当前真实工具仍受注册表、逐轮 grants、JSON Schema、只读 Sandbox 与工具超时约束。

设计依据：`docs/superpowers/specs/2026-09-24-direct-tool-execution-design.md`。决策已由用户确认。

## Decisions

### 1. 自动放行只代替逐次人工审批

通过工具注册、版本、逐轮 grant 和模型名称检查后，Policy 返回 `allow`。未授权或名称不匹配仍 `deny`；参数不合法仍在执行器前失败。`ToolInvocationService` 不再持有审批 waiter，也不发布新的 `tool.waiting_approval`，保留原有取消、超时、输出上限、事件和聚合日志。

替代方案是风险分级自动放行；它对高风险调用仍阻塞。用户选择全部已授予工具直接执行。该决定不自动授予未来新增的写文件或任意网络能力；新增能力仍须独立审核。

### 2. 删除活跃审批协议，兼容旧历史

新客户端不再发送 `tool.approve`、`tool.reject`，服务端不再声明或处理这些能力。旧 `tool.waiting_approval` 事件与持久化状态仍可解析，完成的旧任务能按原 cursor 回放。启动时若数据库确有仍悬挂的旧审批，只将它安全结束为取消/失败；不得借升级隐式执行该调用。兼容逻辑仅用于旧记录，不向新任务暴露审批操作。

### 3. 桌面端保留工具过程，不保留审批交互

任务过程继续按活动归属和 cursor 呈现工具行、原始 I/O、失败与取消。输入框上方审批条及 approve/reject 回调删除。旧审批记录若出现在历史任务中，以只读状态展示，不出现可点击的允许或拒绝按钮。

## Risks / Trade-offs

- 失去逐次人工拦截后，模型可在当前工具授权范围内自动读文件、运行受限命令并发出搜索查询；恶意内容可能诱导敏感信息进入查询。现有 Sandbox 和 grants 缩小范围，但不消除此风险。
- 协议删除控制帧会影响旧桌面客户端；本地桌面与服务随应用一同升级，不承诺旧客户端继续批准旧调用。
- 历史兼容使只读解码器仍认识 `waiting_approval`；“移除审批”指新执行路径与交互入口，而非抹除旧数据库语义。

## Verification

先写自动放行的失败测试，再移除运行分支；覆盖拒绝未授权和无效输入、取消/超时、旧待审批恢复、无审批按钮、Shell 与 Web Search 不点击即可完成，以及完成后刷新恢复原始 I/O。最终运行相关 Vitest、桌面 E2E、类型检查、lint、构建及 OpenSpec 严格校验。
