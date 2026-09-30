## 1. 定向测试

- [ ] 1.1 在 `BrowserPanel.test.tsx` 写相同边界下挂载、窗口 resize、ResizeObserver、布局切换及卸载的请求计数和序列断言；运行该单文件测试，确认旧实现按预期失败（基线 6 次、目标 4 次）。
- [ ] 1.2 写待决请求去重、最近请求失败后的重试、旧请求失败不清除新状态的断言；运行该单文件测试，确认至少去重断言在旧实现上失败。

## 2. 精确同值去重

- [ ] 2.1 在 `BrowserPanel` effect 内比较最近已发请求的 task、session、四个取整边界和可见性，失败时只清除仍为最新的记录；运行 `BrowserPanel.test.tsx` 确认全部定向测试通过。
- [ ] 2.2 运行 preload、manager 与 embedded-host 的相关定向测试，并检查 diff，确认 IPC 契约、会话归属及原有隐藏语义未改变。

## 3. 提交验证

- [ ] 3.1 提交前一次性执行 `pnpm typecheck`、`pnpm lint`、`pnpm test`，记录结果及无关失败；仅暂存本变更文件并在 `main` 提交。
