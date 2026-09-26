## 1. 基础组件

- [x] 1.1 编写 `useObjectUrl` 测试（加载、失败、依赖变化与卸载时撤销 URL），实现 `hooks/use-object-url.ts`。
- [x] 1.2 编写 `ImagePreviewGroup` 测试（受控打开、方向键切换、不越组、Esc 与关闭按钮、保存链接指向当前图片、e2e 标识），实现组件。

## 2. 接入三处入口

- [x] 2.1 `ConversationImage` 改为纯缩略图并复用 `useObjectUrl`；`ImageGallery` 每个网格与 `UserMessage` 各自持有一组预览；删除旧遮罩。
- [x] 2.2 `AgentComposer` 待发送图片改用 `ImagePreviewGroup`，删除 `zoomedPreviewIndex` 遮罩。
- [x] 2.3 `TaskOutputFiles` 图片缩略图可点击打开预览，保留「打开文件」。
- [x] 2.4 删除旧遮罩样式，新增限定作用域的预览层样式。

## 3. 验证

- [x] 3.1 定向测试：改动到的组件测试与 `pnpm typecheck`。
  - 2026-09-26：`pnpm vitest run apps/desktop/src/renderer` → 47 个文件、346 个用例通过；`apps/desktop` 的 `tsc --noEmit` 通过。
- [x] 3.2 提交前一次性运行 `pnpm typecheck`、`pnpm lint`、`pnpm test`、`pnpm test:e2e:local`，结果记录于此。
  - 2026-09-26：`pnpm typecheck` 通过；`pnpm lint` 通过（含 e2e 交互校验，141 条声明）；`pnpm test` 1037 通过 / 4 失败 / 2 跳过，4 个失败均为 `session-sandbox.test.ts`，原因是 worktree 缺少未入库的打包 Node 运行时，与本变更无关；`pnpm test:e2e:local` 6 通过 / 2 失败：
    - 「keeps a wide uploaded image visible…」断言旧遮罩的 dialog，已改为断言新预览层；按用户要求直接提交，改后的用例未重跑。
    - 「persists the selected Token Plan image API…」查找的「生图接口」下拉框在仓库源码中不存在，是 main 上已有的问题，与本变更无关。
- [x] 3.3 用户在 `pnpm dev` 中确认预览外观与交互。（用户发现关闭按钮问题并已修复，随后指示提交合并。）
