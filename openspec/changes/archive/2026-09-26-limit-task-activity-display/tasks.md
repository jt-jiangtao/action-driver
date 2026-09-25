## 1. 活动组高度

- [x] 1.1 为活动组内容设置 `min(420px, 50vh)` 最大高度及内部滚动，标题保持在滚动区外；通过展开长组、短组和完成任务归档的浏览器布局检查验证。
- [x] 1.2 为仍可向下滚动的长任务组增加底部渐隐；先补浏览器行为测试并观察失败，再实现状态更新，验证短组、长组和滚动到底后的效果。

## 2. 脚本转录文本

- [x] 2.1 先为 Shell、Python、Node.js、TypeScript 内联脚本及旧式命令补充行为测试并观察脚本用例失败；再使内联脚本原样显示、输出和退出码保留，运行 ActivityTimeline 定向测试验证。

## 3. 集成验证

- [x] 3.1 运行桌面类型检查、相关组件测试和 OpenSpec 严格校验；检查长组滚动不会遮挡标题、短组无多余滚动，记录实际结果。

验证：ActivityTimeline 定向测试 28/28 通过；桌面类型检查及构建通过；`openspec validate limit-task-activity-display --strict` 通过；Electron 浏览器测试 `keeps interleaved process and tool calls ordered live and after reopening` 通过，覆盖短组、长组及归档后的标题与滚动位置。

底部渐隐验证：Electron 浏览器测试先因长组缺少渐隐失败，实施后通过；短组无渐隐、长组有渐隐、滚动到底后渐隐消失。截图已人工检查边界与标题位置。
