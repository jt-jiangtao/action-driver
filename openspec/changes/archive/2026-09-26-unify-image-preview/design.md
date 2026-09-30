## Context

参见 `proposal.md` 的 Why。现状：`ConversationImage` 自行读取 blob、创建 object URL，并在点击后渲染一个 `role="dialog"` 的遮罩（仅 Esc 与关闭按钮）；`AgentComposer` 用 `zoomedPreviewIndex` 渲染另一套遮罩；`TaskOutputFiles` 的图片缩略图只能「打开文件」交给系统应用。`ImageGallery` 已按生成调用（`callId`）把图片分成网格，未匹配调用的图片进入剩余网格。antd 6.6.4 已是 `@action-driver/desktop` 的依赖，当前只用到 `Timeline`。

## Goals / Non-Goals

**Goals**

- 预览支持缩放、拖动、旋转、翻转、组内切换与保存。
- 三处入口（对话、输入框、交付文件）共用一个预览组件，删除手写遮罩。
- 缩略图外观不变；e2e 交互标识保持不变。

**Non-Goals**

- 不改变缩略图布局、生成占位与加载提示。
- 不做跨组或整段对话的浏览（已裁决）。
- 不修改交付文件「打开文件」的系统应用行为。

## Decisions

### 1. 使用 antd `Image.PreviewGroup`，受控打开

`ImagePreviewGroup` 接收 `items: { key, url | null, alt, downloadName }[]`、`openIndex: number | null` 与 `onOpenChange(index | null)`，内部渲染受控的 `Image.PreviewGroup`（`preview.open`、`preview.current`、`onChange`）。缩略图仍由调用方渲染为按钮，点击时调用 `onOpenChange(index)`；antd 只负责弹出的预览层。

- 替代方案：yet-another-react-lightbox、viewerjs、react-photo-view，见 proposal 的 Battle Status。
- 理由：零新增依赖、功能全覆盖，与现有依赖保持一致。

### 2. 工具栏与 e2e 标识

- `actionsRender` 在 antd 默认动作（缩放、旋转、翻转、切换）之后追加一个下载链接，`data-testid` 为 `images/:asset-id/save#link`（对话图片）；输入框与交付文件使用各自的现有前缀或不挂 e2e 标识。
- 关闭按钮通过 `closeIcon` 渲染带 `images/:asset-id/close#button` 的元素。
- 缩略图按钮保留 `open#button`，`interaction-contracts.json` 不变。

### 3. `useObjectUrl`

`useObjectUrl(load: (() => Promise<Blob>) | null, deps)` 返回 `{ url, error }`：读取 blob、创建 URL，依赖变化或卸载时撤销旧 URL。`ConversationImage`、交付文件缩略图复用它；输入框的本地 `File` 继续由现有 `useMemo` 生成 URL。预览直接复用缩略图已加载的 URL，尚未加载的项显示加载状态。

### 4. 分组

- 生成图：`ImageGallery` 的每个生成调用网格为一组；剩余网格为一组。
- 用户上传：同一条 `UserMessage` 中的图片为一组。
- 输入框：全部待发送图片为一组。
- 交付文件：同一任务的图片成品为一组。

分组状态（`openIndex`）由组所在的组件持有；`ConversationImage` 退化为纯缩略图，不再持有预览状态。

### 5. 视觉

预览层通过 `rootClassName` 限定样式作用域，覆盖遮罩颜色、工具栏背景与按钮尺寸，贴近现有深色遮罩；不修改全局 antd 主题，不影响其他 antd 组件。

## Risks / Trade-offs

- [antd 默认外观与现有 Codex 风格不一致] → 仅在预览层作用域内覆盖样式，并在 `pnpm dev` 中人工比对。
- [受控 `current` 与 antd 内部切换不同步] → 以 `onChange` 回写 `openIndex`，并用组内切换测试固化。
- [用户覆盖：按批次分组] → 同一条消息中的多批生成图不能跨批连续切换，已接受。
- [包体积] → 新增打包 `@rc-component/image`，体量小，已在依赖树中。

## 实施记录（2026-09-26）

- 缩略图旁原有的保存链接保留并继续使用 `images/:asset-id/save#link`，以满足「缩略图外观不变」；预览工具栏新增的保存按钮不挂 e2e 标识，避免同一标识出现两次。`interaction-contracts.json` 不变。
- 输入框预览沿用原有的 `e2e/shared/composer/images/preview-close#button` 作为关闭按钮标识。
- 交付文件的图片缩略图由 `<span>` 改为可点击的按钮（`预览 <文件名>`），文档类成品不进入预览组。
- 分组状态由 `useImagePreview`（对话图片）与 `TaskOutputFiles`（交付文件）持有；`ImageGallery` 的每个网格抽成 `ImageGrid`，各为一组。
- 已知小问题：antd 工具栏按钮的无障碍名称是英文动作名（如 `rotateRight`），未本地化。
- 修复（用户在 `pnpm dev` 中发现关闭按钮点不了）：任务页与首页头部是 `-webkit-app-region: drag` 的窗口拖动区，由系统在页面之前处理，与层叠顺序无关；预览关闭按钮位于右上角、与拖动区重叠，真实点击被当作拖动窗口。预览根节点 `.image-preview` 声明 `-webkit-app-region: no-drag`。自动化测试与 CDP 点击绕过系统，无法复现，改由样式断言固化。
- 为满足仓库的 e2e 交互校验（标识必须在元素处写为字面量或 `e2eId()`），`ImagePreviewGroup` 改为由调用方通过 `renderClose` 渲染带标识的关闭图标；新增两条契约：`e2e/shared/image-preview/save#link`（预览工具栏保存）与 `e2e/tasks/detail/output-file/preview#button`（交付文件缩略图）。这修正了上文「契约不变」的预期。

