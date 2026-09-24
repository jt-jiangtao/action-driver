## Context

见 proposal.md。`ModelSelectorTrigger` 目前不区分有无选中模型，CSS 始终赋予选中态背景；`ModelSelector` 已知道 `selected` 是否存在。

## Goals / Non-Goals

**Goals:** 根据现有选中状态呈现透明或选中底色，同时保留 hover、展开和键盘焦点反馈。

**Non-Goals:** 不改变菜单项样式、模型选择行为和模型数据。

## Decisions

- 由 `ModelSelector` 向触发按钮传递布尔选中状态，用 `data-selected` 驱动 CSS。与根据显示文案推断状态相比，这直接使用现有事实来源，且不会因文案变化失效。
- 未选中默认态背景透明；已选中默认态沿用现有蓝色背景。悬停和展开态仍使用现有反馈色。

## Risks / Trade-offs

- [未选中态按钮边界不明显] → 保留文案、图标、hover 和 `focus-visible` 反馈，避免降低可操作性。
