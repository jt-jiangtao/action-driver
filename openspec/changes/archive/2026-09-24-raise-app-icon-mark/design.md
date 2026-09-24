## Context

见 proposal.md。桌面应用图标 SVG 以白色圆角底板叠加品牌标志，Electron 运行时实际使用预生成的 512px PNG。标志当前视觉重心比底板中心低约 10px。

## Goals / Non-Goals

**Goals:** 将标志整体上移约 8–10px（以 512px 图标计），并保持 SVG 与 PNG 一致。

**Non-Goals:** 不重绘标志、不修改白色底板、不改变应用内使用的原始品牌 SVG。

## Decisions

- 只调整应用图标 SVG 中嵌入标志的 `y` 坐标，再以该 SVG 重新导出 PNG。这样标志各部分一起移动，颜色和比例不变。
- 使用原始 512px 尺寸进行视觉检查，并核对运行时 PNG 的非透明区域与标志位置。

## Risks / Trade-offs

- [SVG 源文件与位图不同步] → 同时更新两者，并通过资源测试与图像检查验证。
