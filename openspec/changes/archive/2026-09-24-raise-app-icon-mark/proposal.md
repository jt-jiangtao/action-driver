## Why

当前应用图标的蓝紫标志在白色底板内视觉偏下。用户要求轻微上移，让图标重心看起来更平衡。

这是执行型视觉修正：目标、范围和验收标准明确，位置调整可逆，不改变品牌图形、接口或构建边界。已检查图形边界、白色底板和 Dock 所用位图；无实质性异议。

## What Changes

- 将应用图标 SVG 内的品牌标志小幅上移，底板、颜色和标志大小保持不变。
- 同步更新 Electron 实际读取的 PNG 图标，避免源文件与运行效果不一致。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

无。仅校正现有品牌图标的视觉位置，使用 `skip_specs: true`。

## Impact

影响桌面资源中的应用图标 SVG 与 PNG；不影响页面内品牌标志或公共 API。
