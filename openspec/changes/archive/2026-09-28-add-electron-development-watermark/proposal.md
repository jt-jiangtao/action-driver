## Why

需要直观识别当前窗口运行的是自有编译的 Electron 开发版，同时保持页面易读、操作正常。水印提供可见标记，源码提交与产物哈希继续承担来源验证。

## What Changes

- 在 Electron macOS 原生窗口层显示低透明度、斜向平铺的全屏 `action-driver-dev` 水印，不添加右下角标签或版本号。
- ACTION_DRIVER 自有开发构建默认显示；其他 ACTION_DRIVER 自有构建通过 `--action-driver-watermark` 开启。
- 自有代码受 ACTION_DRIVER 宏控制，非 C++ 构建接线由对应 GN 开关隔离；覆盖层不截获鼠标操作。
- 补充修改 Electron 后重新构建、导出产物、更新来源记录与打包验证的文档。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `desktop-shell`: 增加自有 Electron 开发构建的原生水印显示与启动参数要求。

## Impact

Electron Fork 的 macOS 窗口实现、GN 配置、独立验收夹具，以及主仓库来源记录和构建打包文档。首期仅验证 macOS arm64；不修改网页 DOM、Playwright 控制接口或 Electron 上游版本号。

## Battle Status

- 类型：架构与显示行为决策型；用户已明确确认最终方案，无未裁决关键分歧。
- 最终方向：Electron 原生层全屏轻量水印，开发版默认显示、其他自有构建参数开启，无角落标签。
- 替代方案：右下角原生标签干扰更小，但辨识度低；网页 DOM 水印可进入页面截图，但页面能移除且会改动被测内容。用户选择原生全屏平铺。
- 已检查：源码隔离、鼠标穿透、页面阅读和截图影响、版本及 ABI 保持、当前 macOS 构建配置。
- 用户覆盖：用户接受全屏标记对阅读和窗口截图的轻微影响；透明度初值 5%。
- 限制：原生水印不作为防伪证明，Playwright 页面截图不能作为原生覆盖层验收证据。
- 重新开启条件：原生覆盖层无法保持鼠标穿透、动态布局或宏关闭时的上游行为；需扩展其他平台时另行裁决。
