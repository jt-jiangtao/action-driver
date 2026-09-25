## Context

见 proposal.md。`ActivityTimeline` 把活动组渲染为 `<details class="activity-group">`，标题是 `<summary>`，子工具位于 `.activity-items`；后者当前没有高度限制。`shellToolTranscript` 对内联 `script` 拼接 `$ <runtime> -`，对旧式 `command`、`code`、`file` 输入也生成可读调用文本。工具 I/O 的原始数据由 Runtime 保存。

## Goals / Non-Goals

**Goals:**

- 让长活动组不会撑满任务页，仍能逐行查看和展开子工具。
- 只调整内联脚本的可见文本，不改动原始 I/O 和旧式命令展示。

**Non-Goals:**

- 不改活动分组、折叠默认状态、工具标题或后端事件结构。

## Decisions

- 在 `.activity-items` 上应用 `max-height: min(420px, 50vh)`、垂直滚动和适当的滚动边界；将高度限制放在组内容而非整个 `<details>`，让标题保持在滚动区外。短组由内容自然撑开。相比给整个活动归档设置高度，只有长组受限，组间正文和结果不被卷入滚动区。
- 为仍可向下滚动的 `.activity-items` 应用与长工具输出相近的底部遮罩渐隐。依据实际滚动尺寸与位置切换状态；内容收起、展开或更新时重新检查。短组和已滚动到底的长组不渐隐，避免误导用户。
- `shellToolTranscript` 对存在内联 `script` 的输入直接以该字符串作为展示首段；输出、退出码的解析逻辑保持。`command`、`code`、`file` 仍沿用现有分支。相比移除整个终端转录，这能保留旧记录中确有意义的命令与输出。

## Risks / Trade-offs

- [嵌套滚动] 工具自身的长输出已有滚动区，长组又增加一层 → 仅在超过 420px 或半屏高度时出现组滚动；验证鼠标、触控板与键盘可访问性。
- [渐隐状态] 展开工具输出可能改变组内容高度 → 监听滚动区域和内容尺寸，浏览器测试覆盖短组、长组和滚动到底。
- [旧记录格式] 历史任务的参数可能不是 `script` → 保留旧分支，测试旧式 `command` 和当前四种内联脚本。
