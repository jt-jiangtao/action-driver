## Why

生图过程中图片卡片缺少逐张进度，完成时还会从文字下方跳到上方；已有多图并行能力因此难以辨认。用户还希望将 Codex Imagegen Skill 随 ActionDriver 安装，但原版默认调用本应用不存在的 Codex 内置工具，直接原样复制无法使用。

## What Changes

- 生图开始时按本次请求的 1–4 张数量显示带柔和点阵动画的固定占位卡，逐张成功后原位替换；减少动态效果设置关闭动画。
- 助手消息中的文字在流式、结束、重连和历史恢复时始终排在生成图片上方；部分失败与取消保留各插槽准确状态。
- 完整复制 Imagegen Skill 的文件、参考资料、脚本、图标与 Apache 2.0 许可证，作为每次安装均包含、设置页可见的只读系统 Skill；将默认执行说明适配到 ActionDriver 已有的 `image.generate` 工具。
- 为生图调用传输非敏感张数和稳定插槽编号，不暴露原始提示词或图片字节。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `conversation-images`：多张生图的原位进度、消息顺序、动画和历史恢复行为。
- `instruction-skill-installation`：随包提供可用的 Imagegen 系统 Skill 及完整资源文件。

## Impact

涉及生图工具事件、流式协议与持久化消息部件、桌面投影和对话组件、系统 Skill 播种与打包验证。无数据库表迁移；旧助手消息保留图片之间的相对顺序，展示时统一归一为文字在图片上方。Skill 的备用 CLI 文件保留但不成为默认执行路径，也不自动安装其 Python 依赖。

## Battle

已完成决策型 Battle，用户明确裁决采用每图固定占位和“完整复制并适配”。已比较单卡片追加图片与原样复制 Skill：前者无法提供稳定的逐图进度，后者无法调用 ActionDriver 的生图工具。主要代价是新增可选的事件和消息部件元数据；当前无未决关键分歧。
