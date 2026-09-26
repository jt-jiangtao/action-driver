## Why

任务页的图片查看器是手写的全屏遮罩：只能单张查看，不能缩放、拖动、旋转或翻转，也不能在同一组图片之间切换。输入框的待发送图片另有一套重复的放大实现，交付文件里的图片则完全不能预览。用户需要看清截图与生成图的细节，并在一批图片之间快速浏览。

## What Changes

- 新增共享组件 `ImagePreviewGroup`，基于已有依赖 antd 6 的 `Image.PreviewGroup`：滚轮缩放、拖动、左右旋转、水平与垂直翻转、方向键与按钮切换、Esc 关闭，工具栏追加「保存」。
- 对话图片、输入框待发送图片、交付文件图片统一使用该组件；删除 `ConversationImage` 与 `AgentComposer` 中的手写遮罩及其样式。
- 新增 `useObjectUrl`，统一 blob 读取、object URL 创建与释放。
- 预览按「同一批生成 / 同一组上传」分组：同一次生成调用、同一条用户消息、全部待发送图片、同一任务的图片成品各为一组。
- 保留 e2e 交互 `images/:asset-id/open#button`、`close#button`、`save#link`。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `agent-task-experience`: 新增「图片预览支持缩放、变换与组内切换」的要求。

## Impact

- 渲染进程：`components/agent/ConversationImage.tsx`、`ImageGallery.tsx`、`UserMessage.tsx`、`TaskOutputFiles.tsx`、`components/AgentComposer.tsx`、样式，新增 `components/agent/ImagePreviewGroup.tsx` 与 `hooks/use-object-url.ts`。
- 依赖：无新增；使用已有的 `antd`（`@rc-component/image` 已在依赖树中）。
- 不改变 IPC、Runtime 协议或数据结构。

## Battle Status

- 类型：技术选型（第三方预览组件）与交互范围。
- 状态：**Battle 已裁决**（2026-09-26）。
- 反例：用户原意是「查找图片预览器框架」，但 antd 6.6.4 已是依赖，其预览覆盖全部需求，无需新增依赖。
- 比较过的替代方案：yet-another-react-lightbox（无旋转/翻转，需手写）、viewerjs（命令式 DOM 库，需封装）、react-photo-view（2025-01 后无发布）；PhotoSwipe 不支持旋转，直接排除。
- 裁决：采用 antd `Image.PreviewGroup`（与 Agent 推荐一致）。
- 用户覆盖：分组范围由 Agent 推荐的「同一条消息」改为「同一批生成 / 同一组上传」；已知影响是同一条消息中的多批生成图不能跨批连续切换。
