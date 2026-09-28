# macOS Computer Use 客户端实机对照（2026-09-28）

本记录验证候选 `@actiondriver/sky` **客户端**调用现有原版 `sky` 特权服务的可观察结果。候选 Sky 服务另有隔离宿主中的只读发现验收记录，见 [real-macos-sky-service-acceptance.md](real-macos-sky-service-acceptance.md)；两项局部验证均不能认定整体依赖可替换。

## 运行边界

候选 `packages/sky/dist/index.js` 用 Vite 6.4.3 临时打包为单文件并在当前 macOS CUA REPL 中加载，以绕过普通 REPL 的外部包解析限制；该文件不作为生产交付物。原版客户端为当前 `cua` 的 macOS computer API。两个客户端均经同一原版特权 Sky 服务访问系统。

## 结果

| 场景 | 候选 | 原版 | 结论 |
|---|---|---|---|
| 应用发现 | target 为 `mac`，27 个应用 | 27 个应用，ID 列表同序 | 通过 |
| 活动监视器完整 AX | `get_app_state({disableDiff:true})` | `getAXState({disableDiffing:true})` | 两份 2428 字符文本完全相同 |
| 活动监视器截图 | JPEG，1920×1280 | JPEG，1920×1280 | 格式、尺寸一致；动态 CPU 数字变化，字节不要求相同 |
| 计算器 `1 + 1 =` | 候选 Sky 按钮点击后显示 `value:2` | 清零后原版同序点击也显示 `value:2` | 通过 |
| 清理 | 测试前计算器未运行 | 测试后通过应用菜单退出，`isRunning:false` | 通过 |

计算器 bundle ID 在该机器上与仓库中一个测试假应用重复，因此用 `/System/Applications/Calculator.app` 明确选择系统应用；没有使用重复 ID 猜测目标。活动监视器只读观察，未修改其窗口内容。

## 尚需验证

候选 `@actiondriver/sky/service` 的 `setup` 与 `list_apps` 已在隔离特权宿主中运行；授权后的 AX/截图/动作和资源清理尚未由候选服务端验收。音频、拖拽、剪贴板、跨窗口状态和异常路径还须独立实机对照。生产仍加载原包。
