# macOS 真实浏览器页面层对照

执行型验证，针对已经还原的 Playwright 选择器、点击和填充模块。先构建 `packages/browser-runtime`，再从工作树运行：

```sh
ego-browser nodejs -e "await import('file://$PWD/analysis/codex-cua/verify-real-macos-playwright.mjs')"
```

脚本创建一个隔离的 Ego Lite Chromium TaskSpace，并在 `finally` 中调用 `finish({ keep: [] })` 清理。若同一目标已有测试 TaskSpace，可在导入前设置 `globalThis.EGO_TASK_SPACE_ID` 复用。测试仅访问 `data:` 本地页面，不使用用户已有浏览器标签。

复制版 `yf`/`x_` 与候选 `PlaywrightInput`/`fillLocator` 分别在重置的同一真实页面执行选择器计数、可用状态读取、点击和填充。两边都通过该页面的真实 CDP `Page`/`Runtime` 命令；指针派发由同一 `page.mouse.click` 适配器执行；虚拟剪贴板边界使用同一无状态夹具。两边均得到：计数 1、可用 true、按钮点击后文字 `clicked`、输入值 `real browser`、一次真实 DOM `input` 事件；点击坐标四舍五入后均为 `(172, 21)`。脚本对完整结果做深度相等断言，退出码 0。

这证明候选页面层代码在真实 macOS Chromium 中运行，并与复制版产生相同页面效果。适配器没有经过 Codex App 的浏览器发现、nativePipe、权限/凭据门、服务调度或完整资源释放；不能据此勾选 4.2、49.4、50.4、52.3、53.5 的完整实机验收，也不能替换生产依赖。
