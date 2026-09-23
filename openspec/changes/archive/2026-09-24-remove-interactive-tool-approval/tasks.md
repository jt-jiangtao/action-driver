## 1. 行为与持久化

- [x] 1.1 先改 Policy、Invocation 和状态机测试，确认受限 Shell 与 Web Search 自动进入队列、未授权及无效参数仍被拒绝、取消和超时仍有效。
- [x] 1.2 移除新的 `require_approval` 决策和等待分支，保留原有事件、日志和 Sandbox 边界。
- [x] 1.3 为数据库中仍悬挂的旧审批增加幂等、安全的终态恢复；完成的旧历史仍可读取。

## 2. 协议与客户端

- [x] 2.1 用失败测试驱动移除客户端 approve/reject 控制帧、服务能力声明与处理分支，保留旧服务事件只读解析。
- [x] 2.2 删除 Renderer 流客户端、Agent Adapter、任务页和输入框上方审批条的交互代码与样式；历史记录不出现活跃审批按钮。

## 3. 端到端验证

- [x] 3.1 将 Shell 与本地 SearXNG 的 E2E 改为无需点击即可完成，验证最终答案、工具 I/O、失败/取消和完成后刷新顺序。
- [x] 3.2 运行相关 Vitest、`pnpm typecheck`、`pnpm lint`、`pnpm build`、桌面工具 E2E 与 `openspec validate remove-interactive-tool-approval --strict`，记录任何无关基线失败。
