## 1. 会话契约与协调

- [x] 1.1 在 `packages/browser-desktop` 增加不含任务或 Electron 类型的可序列化 Browser Session、surface、tab、命令、结果和错误契约，并以包内定向测试验证序列化和拒绝无效 ID。
- [x] 1.2 在 `packages/browser-desktop` 实现宿主注入的会话核心、标签页身份校验、命令串行化和关闭清理；在 `apps/desktop` 建立 task→session 映射，并以定向测试验证关闭后命令不会落到其他标签页。
- [ ] 1.3 将会话及标签页状态投影到任务数据，保留 Mock 投影；以定向测试验证任务切换、暂停、接管、恢复和失败状态。

## 2. 内置浏览器与界面

- [ ] 2.1 在 Electron Main 实现隔离的内置 WebContentsView 宿主与具名类型化 IPC，验证网页无法访问应用 preload、Node 或任意 IPC。
- [ ] 2.2 将内置 view 的 bounds 和可见性与任务页分栏、放大、折叠、切换任务及窗口尺寸同步；以真实 Electron 本地夹具验证页面状态保留且控件不被遮挡。
- [ ] 2.3 将 Electron 内置宿主的真实导航、点击、输入、滚动、截图和页面事件适配到 `browser-desktop` 会话核心；以本地 HTTP 夹具验证 Agent 的操作与右侧可见页面一致。
- [ ] 2.4 将标签栏、地址栏、后退、前进、刷新、新建、选择和关闭接入会话命令；以组件定向测试及真实 Electron 夹具验证标题、URL、加载和错误状态。

## 3. 外部 Chrome 与 Agent 工具

- [ ] 3.1 将自有 `createLocalBrowserHost` 通过 ActionDriver 适配层注入 `browser-desktop` 会话核心，作为外部 Chrome 表面；以隔离 profile 实机夹具验证 Agent 启动、操作、关闭和清理，且不附着用户原有 Chrome。
- [x] 3.2 为 `browser-use` 注册 Skill Provider，并让统一 CUA JS 工具按 browser/computer 表面分别执行授权；通过 Agent Runtime 定向测试验证未授权拒绝及内置、外部两种表面的实际调用。
- [ ] 3.3 将人工接管和恢复与 Agent 命令执行联动；以定向并发测试验证接管期间 Agent 停止操作、恢复前重读页面、已关闭目标不重放。
- [x] 3.4 使用还原的 `@actiondriver/cua` 合并会话和 `@actiondriver/cua-repl` 语义，将 Browser Use 与 Computer Use 接入同一持久 JS 工具及重置工具；定向测试覆盖跨调用变量、浏览器与桌面混合调用、重置和失败恢复。
- [ ] 3.5 让 `browser-runtime` 独占通用 Browser/Tab 调用实现，`browser-desktop` 复用客户端并补齐桌面专有服务；将本机 Chrome 启动移至 ActionDriver 宿主适配。用独立服务/客户端对照及包依赖检查验证没有重复命令执行或循环依赖。
- [ ] 3.6 在可信 browser/computer RPC 分别执行任务归属、Skill/Policy Gate、取消、人工接管和目标身份检查；用混合 JS 单元验证任一表面授权不能越权到另一表面。
- [x] 3.7 统一入口真实验收通过后移除模型可见的 `tools.local.browser-use.command`；工具卡片按实际表面显示标题、原始 JS 输入、文本/错误/图片输出，任务重新打开仍可见，浏览器截图 Base64 不作为正文。

## 4. 端到端验收与交付

- [ ] 4.1 使用本地 HTTP 页面和真实 Electron 验证内置浏览器的导航、标签页、页面输入、布局切换、任务切换及关闭，记录可复现的运行证据。
- [ ] 4.2 使用真实 macOS Chrome 验证 Agent 自行启动独立窗口并完成点击、输入、截图及用户接管；验证 Chrome 缺失、窗口关闭和启动失败的错误状态。
- [ ] 4.3 运行服务隔离扫描，确认 `browser-desktop` 新出口与产品适配均不连接 Codex 私有服务，且保留原件还原的独立验收状态；在准备提交时按仓库治理一次性运行完整检查并只提交本变更文件。
- [ ] 4.4 在真实 Electron 中由同一 JS 会话验证内置页、受管 Chrome 和 Computer Use，覆盖脚本输出、任务重载、重置、授权拒绝、接管、取消、关闭及故障；未通过前不宣称与 Codex 完全对齐。

## 5. 联合切换验收

用户裁决：本变更与 `reconstruct-codex-cua-packages` 的任务 59 联合交付。保留 `packages/back` 离线备份，移除 `apps/agent-runtime/vendor`；Computer Use 必须持续可用。联合设计见 `docs/superpowers/specs/2026-09-28-browser-and-vendor-cutover-design.md`。

- [ ] 5.1 核对本变更 1–4 的真实内置浏览器和外部 Chrome 证据，以及重建变更 59.1–59.3 的自有宿主切换证据；全部通过后才声明 Browser Use 与 vendor 移除联合完成。

阶段证据：`browser-desktop` 会话、Main/Preload IPC、Renderer 投影与右侧 WebContentsView 已接通。真实 Electron 本地页面用例验证内置标签新建/关闭、导航、点击、文本输入、截图与独立 Chrome 导航/关闭；模型驱动用例验证 Agent 打开并导航后，右侧标签与地址栏同步。Computer Use 自有 Runtime 的审批端到端用例也通过。任务切换、布局遮挡、Chrome 故障状态、打包和完整服务隔离尚未验收，因此 4.x 与联合 5.1 保持未勾选。

统一 CUA JS 增量证据（2026-09-28）：同一持久会话的 Browser/Computer 分权与混合调用、重置清理、截图资源、任务重载通过 Agent Runtime 28 项定向测试及真实 Electron 4 项定向用例；浏览器命令补上后退/前进/刷新、双击、移动、拖拽、单键、AX 截图及截图裁剪/整页参数，任务关闭等待尚在打开中的 Chrome。生产 CUA bundle 经定向扫描无 Codex 私有管道/路径，`apps/agent-runtime/vendor` 及构建副本不存在。候选 `browser-runtime` 服务源码仍有 11 项私有宿主/turn metadata 扫描结果；完整包隔离、打包和故障矩阵未完成，4.3、4.4、5.1 继续未勾选。

生产依赖部署定向检查：`corepack pnpm --filter @actiondriver/agent-runtime deploy --prod /tmp/actiondriver-cua-runtime-deploy-check` 成功；部署后 `dist/js-repl/owned-cua.mjs` 存在、vendor 不存在，产物中无 `CODEX_HOME`、`SKY_CUA_SERVICE_PATH`、`nativePipe`、`Codex Computer Use.app` 或 `@oai/sky`；直接从部署目录创建 Browser-only CUA 会话可列出 `iab`。这不是正式打包 App 与完整源码服务隔离验收。

提交门槛首次运行记录（2026-09-28）：`pnpm test:e2e:local` 6/9 通过；Computer Use 授权用例通过，预加载 API 新增 `browserSession` 的断言已更新，另 2 项设置与图片预览失败待查。macOS 打包检查首次被 `classic-level` 构建策略阻断；补充 allowBuilds 后 Desktop/Runtime 生产依赖部署定向通过。完整服务隔离仍有 22 项候选源码引用，联合 5.1 不标记完成。

主仓库定向验收：本地构建 Desktop 与 Agent Runtime 成功；真实 Electron 对内置页面、独立 Chrome、Agent 打开右侧页面与 Computer Use 授权的 3 项端到端检查全部通过。浏览器关闭事件清空任务投影的定向测试 16/16 通过。任务切换与所有异常分支尚未覆盖，4.x 继续保持未完成。

工具卡片展示补充（2026-09-28）：按用户指定的现有脚本样式，Computer Use 的 `title` 与 Browser Use 的动作摘要进入工具行标题；两者展开后使用脚本式输入输出记录，Browser Use 显示会话及标签页状态，不显示截图 Base64。外部 Chrome 的“打开”摘要与内置浏览器分别命名。5 个直接相关测试文件共 64 项通过；Browser Use 模型驱动的真实 Electron 用例验证标题、Browser Use 详情容器及右侧页面，独立 Chrome 实机用例仍通过。未完成的任务切换、异常分支和联合交付门槛保持未勾选。

工具卡片重新读取修复（2026-09-28）：用户反馈 Browser Use 卡片无脚本输入和返回结果。定向测试复现 `task.get` 投影丢失 `details` 与 `presentation`，现已让两个字段随工具调用一起返回。Agent Runtime 的 8 项定向测试、TypeScript 检查及改动文件 ESLint 通过；真实 Electron 的 2 项 Browser Use 用例通过，其中 Agent 打开页面的用例增加重新加载任务后的输入输出断言。按用户裁决，不处理历史记录与兼容迁移。
