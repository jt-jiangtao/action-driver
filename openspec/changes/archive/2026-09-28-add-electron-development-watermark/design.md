## Context

参见 proposal.md。当前自编译 Electron 为 38.8.6，macOS arm64，直属源码位于 thridparty/electron，独立构建检出位于 thridparty/build/electron-workspace/src/electron。NativeWindowMac 在 shell/browser/native_window_mac.mm 创建原生窗口并设置内容视图；当前 testing.gn 为 is_debug=false、is_official_build=false。已有桌面宿主来源解析器核验 bundle、版本和架构，水印不替代这些验证。

## Goals / Non-Goals

**Goals:** 在自有 Electron 原生窗口内容区域提供轻量、不可由网页 DOM 移除的开发标记，保持页面交互与生命周期正常；交付重建及打包文档。

**Non-Goals:** 不添加右下角标签、版本后缀、网页脚本或 Playwright 接口；不实现防伪证明；本期不扩展 Windows、Linux。

## Decisions

### 原生覆盖层与鼠标穿透

最终裁决为 AppKit 原生覆盖层，附着于 BrowserWindow 内容区域，随窗口布局调整并在窗口销毁时释放；导航或页面 DOM 修改不影响标记。覆盖层 hitTest 返回 nil，不参与键盘焦点或页面可访问性控件。内容视图替换时保持覆盖层位置在页面之上，不能遮挡原生窗口控制按钮。

替代方案为网页 DOM 平铺，易测试且能进入页面截图，但会改变被测网页并可被网页移除；右下角原生标签影响小，但用户明确取消。原生覆盖层符合用户验证自有编译的目的。

### 构建与启动规则

通过 GN 开关 action_driver 定义 ACTION_DRIVER；所有自有 C++/Objective-C++ 行为代码均在该宏内，非 C++ 构建接线由对应开关控制。ACTION_DRIVER 且 is_official_build=false 的构建默认显示，覆盖当前 testing 配置。ACTION_DRIVER 且 is_official_build=true 的构建仅在主进程启动参数包含 --action-driver-watermark 时显示。关闭 ACTION_DRIVER 时即使携带参数也不显示。开发版没有额外关闭参数。

使用独立的自有开发构建标记传递默认策略，不能依赖 NDEBUG 或 is_debug；不能修改 process.versions.electron 或上游版本号，避免影响 ABI 和现有来源校验。替代方案是按 Debug 配置判断，但当前已构建 testing 产物优化开启，不能满足开发版默认显示。

### 轻量绘制与证据

文字固定 action-driver-dev，斜向重复铺满内容区域，文本绘制透明度初值 5%，无角落附加文本。浅色与深色背景采用有轻微对比的文字色；字号、间距以窗口实际阅读验收微调，不增加设置界面。静态绘制按尺寸或外观变化重绘，不用动画或持续定时器。

通过窗口截图检查原生水印，配合实际启动路径、源码提交和产物哈希确认来源。Playwright 页面截图不包含原生层，不能用作水印有无的唯一证据；其页面操作用于验证覆盖层未截获交互。

## Risks / Trade-offs

- [全屏标记影响阅读和窗口截图] → 用户已接受全屏方案；以 5% 初值、无动画和无角落标签降低干扰，保留实际视觉验收证据。
- [原生覆盖层在内容替换或全屏切换时失效] → 定向验证导航、内容视图替换、缩放和全屏切换；若需要改变窗口架构先报告。
- [关闭宏未保持上游路径] → 审查自有差异，定向编译宏开与关两种配置并验收参数矩阵。
- [重建后 bundle 哈希变化] → 导出前验证新产物，审核更新来源记录，不绕过现有启动校验。
- [源码尚未由主仓库追踪] → 按已确认的 submodule 任务管理 Fork 提交；公开可拉取验收要求远端存在对应提交，不以本地提交冒充。

## Migration Plan

先实施 Electron Fork 的宏、构建配置和原生覆盖层，运行定向验证；再重建导出 bundle，更新主仓库来源记录，验证桌面及打包启动。文档记录开关、参数、构建和导出命令、来源更新步骤、原生截图验收及页面截图限制。回滚恢复旧 Fork 提交、旧 bundle 和匹配的来源记录。只提交本任务文件，保留并行工作。
