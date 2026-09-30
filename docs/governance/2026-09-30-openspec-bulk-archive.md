# OpenSpec 活动变更整体归档记录

2026-09-30，用户明确确认当前没有任务要执行，要求将全部活动 OpenSpec 变更直接归档。此前建议先审计并完成有效项；用户最终裁决覆盖该建议。归档只结束规划状态，不宣称未完成的功能已交付，也不将 delta spec 同步到主规范。

| 变更 | 归档时任务 | Delta spec | 归档前严格校验 | 处置 |
| --- | ---: | ---: | --- | --- |
| `bootstrap-browser-forks` | 4/17 | 1 | 通过 | 终止未完成任务后归档 |
| `cleanup-directory-residue` | 43/43 | 0 | 通过 | 完成后归档 |
| `establish-runtime-foundations` | 0/21 | 5 | 通过 | 终止未完成任务后归档 |
| `implement-browser-use` | 2/15 | 1 | 通过 | 终止未完成任务后归档 |
| `integrate-browser-use-desktop` | 5/19 | 2 | 通过 | 终止未完成任务后归档 |
| `manage-agent-skills` | 30/39 | 2 | 通过 | 终止未完成任务后归档 |
| `reconstruct-codex-cua-packages` | 181/236 | 1 | 通过 | 终止未完成任务后归档 |
| `replace-agentd-with-local-langgraph-runtime` | 26/30 | 4 | 失败 | 终止未完成任务后归档 |
| `run-agent-with-real-models` | 0/16 | 1 | 通过 | 终止未完成任务后归档 |
| `serve-runtime-over-http` | 41/98 | 4 | 失败 | 终止未完成任务后归档 |
| `serve-session-catalog` | 0/17 | 1 | 通过 | 终止未完成任务后归档 |
| `surface-computer-use-guidance-errors` | 25/27 | 1 | 通过 | 终止未完成任务后归档 |

共 12 个变更：1 个任务清单全部完成，11 个保留未完成勾选；23 份 delta spec 均保存在各自归档目录，未同步。`replace-agentd-with-local-langgraph-runtime` 与 `serve-runtime-over-http` 在归档前的严格校验未通过，错误为 delta requirement/scenario 结构不符；归档保留其原始状态，不伪装修复。

此次不修改产品代码、主规范、Git 分支或其他工作树。保留中的工作树改动需由其原任务单独处理；如果未来要恢复某项能力，应以当时的代码和当前主规范重新裁决。

## 提交前验证

- `PATH=/opt/homebrew/bin:$PATH pnpm typecheck`：通过，29 个 workspace 项目。
- `PATH=/opt/homebrew/bin:$PATH pnpm lint`：通过，含 152 项交互声明验证。
- `PATH=/opt/homebrew/bin:$PATH pnpm test`：439 个测试文件通过、2 个跳过；2634 个用例通过、2 个跳过；0 失败。
- 本提交只移动和注记 OpenSpec 规划文件，没有产品代码改动；未运行产品端到端测试。
