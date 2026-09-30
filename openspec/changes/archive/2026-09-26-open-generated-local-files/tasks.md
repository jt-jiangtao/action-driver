## 1. 会话目录与文件记录

- [x] 1.1 建立由持久化 taskId 解析 sessionId 的可信执行上下文，并让所有脚本工具接收该上下文；用两任务同会话、两会话隔离的 Runtime 测试验证映射。
- [x] 1.2 建立每会话 `input/`、`output/` 工作目录及安全路径操作，禁止符号链接、目录穿越和跨会话引用；用路径与文件类型负向测试验证。
- [x] 1.3 扩展数据库和投影契约，记录输入 fileId、上传任务、会话、名称与格式，并保留现有图片记录兼容；用持久化和旧消息恢复测试验证。

## 第 1 节验证记录（2026-09-26，darwin-arm64）

- `SessionExecutionContextResolver` 以持久化 `tasks` 记录为准解析执行上下文，找不到任务即返回 `EXECUTION_CONTEXT_UNAVAILABLE`；`ToolInvocationService` 在调用执行器前解析该上下文，无法解析时不启动任何进程。
- 四个脚本工具改为必须收到执行上下文，`cwd` 取自 `context.workspace.root`；缺少上下文时以 `EXECUTION_CONTEXT_UNAVAILABLE` 失败，不再回退到共享工作区。定向用例：`session-execution-context.test.ts`（5）、`session-workspace.test.ts`（7）、`script-tools.test.ts`（6，含真实 `pwd` 与 fail closed 用例）、`local-adapters.test.ts`（2，含真实 shell 写入 `sessions/session-a/`）。旧构建入口 `createScriptTools` 不再接受 `workspaceRoot`。
- `SessionWorkspaceStore` 统一生成 `sessions/<sessionId>/{input,output}` 并拒绝非法 sessionId、绝对路径、`..`、符号链接与父目录缺失/非目录；文件类型用例覆盖 `WORKSPACE_NOT_A_FILE` 与跨会话符号链接。
- 数据库版本 13 新增 `session_input_files`（staged → bound，记录 fileId、会话、上传任务、名称、格式、字节数、相对路径、摘要与时间），契约新增 `document` 消息部件（只含元数据，不含字节），流协议快照 schema 同步校验该部件并拒绝夹带内容字段。
- 本机命令：`pnpm typecheck` 退出 0；`pnpm test` 为 130 个文件通过、2 个跳过，842 个用例通过、2 个跳过。

## 2. 严格执行隔离

- [x] 2.1 为 Shell、Python、Node、TypeScript 建立统一 macOS 每会话沙箱启动适配层和最小环境变量；用实际子进程测试验证本会话 `input/` 可读、`output/` 可写，以及跨会话、应用私有资产与凭据不可读。
- [x] 2.2 阻断脚本获取 Runtime 服务令牌及通过本地接口访问其他会话资源，并确保子进程继承限制、符号链接／硬链接及失败回退安全；用攻击路径负向测试和沙箱不可用测试验证。
- [x] 2.3 审计并限制 `skill_install` 等 Runtime 代读文件工具，防止跨会话读取或私有输入进入全局 Skill；用跨会话路径、私有目录和授权来源测试验证。

## 第 2 节验证记录（2026-09-26，macOS 27.0 build 26A428，darwin-arm64）

- `SessionSandbox` 统一包住四种脚本工具：`sandbox-exec -f <每调用 profile>`，profile 以 `system.sb` 为基线，`(deny file-read* (subpath "/Users")/"/Volumes"/"/private/var/db"/"/private/var/folders"/"/private/var/tmp")` 后仅重新允许本会话工作目录、运行时依赖根（随包 `dist` 与已安装 Skill 目录）及其 `path-ancestors`，并 `(deny network-outbound (remote ip "localhost:*"))`。
- 写入只允许本会话 `output/`、每调用临时目录与 `/dev/null`；`TMPDIR` 指向每次调用新建的无空格临时目录（同时避开上游 `soffice` 包装脚本在含空格 `TMPDIR` 下崩溃的问题），`HOME` 指向本会话目录，环境变量按白名单重建，仅保留 `PATH`、`LANG`/`LC_ALL`、`PYTHONNOUSERSITE` 与四个 `RUNTIME_*`。
- 不可用即失败：非 darwin、`sandbox-exec` 或 `system.sb` 缺失时 `SessionSandbox.prepare` 抛 `SANDBOX_UNAVAILABLE`，`ToolInvocationService` 在启动任何进程前失败，无无沙箱回退路径。
- 定向用例 `session-sandbox.test.ts`（9 个）使用真实子进程验证：本会话 `input/` 可读、`output/` 可写；会话 B 目录、会话外私有目录（数据库与令牌文件）读取被拒；`output/` 中逃逸符号链接写入被拒；本地 127.0.0.1 服务从脚本内不可连接；脚本再启动的子进程仍不能读其他会话；环境变量不含 `ACTION_DRIVER_SERVICE_TOKEN` 等父进程秘密。
- 同文件内的真实产物用例（通过四个脚本工具、沙箱内执行）：`RUNTIME_PYTHON` 生成 `output/sample.docx`、`soffice` 转为 `output/sample.pdf`（文件头为 `%PDF`）、`RUNTIME_NODE` 借助 `@oai/artifact-tool` 导出 `output/sample.xlsx` 并复读校验公式结果 5；`script-tools.test.ts` 另验证跨会话绝对路径读取被拒与不可用平台 fail closed。
- 代读工具审计结论：仅 `skill_install` 接受模型提供的本地路径；其 `source: "local"` 现要求可信执行上下文，路径经 `resolveWorkspaceSource` 解析真实路径并强制位于本会话工作目录内，否则拒绝安装；`skill_read`（按 skillId 限定在 Skill 目录）、`web_open`（仅公网 HTTP(S)）、`load_workspace_dependencies`（只返回路径）与 `image.generate`（按会话校验资产）复核后无越权读取路径。
- [x] 2.4 在打包 macOS 应用上验证沙箱建立、随包解释器及 Office 依赖可用；运行打包端到端测试，若环境不支持则记录明确失败且保持 fail closed。

打包验证记录（2026-09-26）：`pnpm test:e2e:packaged:macos` 在真实 macOS 应用包（`Action-Driver.app`）上 1 passed / 16.8s。验证脚本 `scripts/test-packaged-macos.mjs` 除随包解释器、`bin` 与系统 Skill 外，还暂存本地 `dist/dependencies/` 并校验收到的 `node`、`python3`、`soffice`、`pdftoppm` 可执行（该暂存只存在于验证脚本，发布打包决策不变）。应用内新增断言：任务脚本的 `cwd` 位于 `<userData>/workspace/sessions/`，脚本环境不含任何 `ACTION_DRIVER_*` 变量，`python_run` 读取工作区根目录之外的 `../../README.md` 以 `PROCESS_EXIT_NONZERO` 失败且不回传内容，`RUNTIME_PYTHON` 可导入 `docx`/`reportlab`/`pdfplumber`/`pypdf`，`RUNTIME_BIN_DIR/soffice --version` 返回 `LibreOffice`；原有三轮工具、会话产物、阻塞取消与视觉流程同时通过。

## 3. 输入上传与页面展示

- [x] 3.1 扩展上传协议及 Runtime 校验，接收 DOCX、PPTX、XLSX、PDF 和现有图片，将有效输入安全物化到本会话 `input/`；用类型、大小、同名、损坏和跨会话绑定测试验证。

第 3.1 节验证记录（2026-09-26）：

- 新增 `SessionInputFileStore`：POST `/input-files/staged`（`x-action-driver-file-name` + content-type）先把字节落到应用私有暂存区并写入 `session_input_files`（staged，含 sha256），再在任务创建时物化到 `sessions/<sessionId>/input/<name>` 并把记录改为 bound；同名文件稳定递增为 `-2`、`-3` 后缀，路径一律经 `SessionWorkspaceStore` 校验，拒绝符号链接与越界。
- 校验覆盖：允许 `pdf`/`docx`/`pptx`/`xlsx`/`png`/`jpeg`/`webp`；拒绝不支持类型、扩展名与格式不符、空文件、超过 50MB、魔数不符（`%PDF-`、`PK\u0003\u0004`、图片嗅探）与暂存后被篡改（`INPUT_FILE_CHECKSUM_MISMATCH`）。
- 协议与执行链路：`request.create.input.inputFileIds`（最多 4 个）经 `StreamSessionService` 绑定并写入会话 `input/`，用户消息新增只含元数据的 `document` 部件；未知标识、已绑定标识再次使用都会以 `request.error{code:'input-invalid'}` 结束且不创建任务。
- 定向用例：`session-input-file-store.test.ts`（6）、`stream-session-service.test.ts` 新增 2 个（物化 + 未知/重复标识）、`service-http.test.ts` 新增上传协议负向用例、`runtime-http-client.test.ts` 新增中文文件名暂存用例；`pnpm test` 全量 866 用例通过。
- [x] 3.2 扩展 Composer 与任务消息视图，发送前展示和移除附件，发送后显示文档卡片及现有图片缩略图；用键盘交互与组件测试验证。
- [x] 3.3 在后续任务的模型上下文提供本会话可用输入路径，并保持上传任务归属；用同会话读取、跨会话不可见、重连和重启测试验证。

第 3.2 / 3.3 节验证记录（2026-09-26）：

- Composer 新增文档附件：隐藏输入（`aria-label="选择文档"`，`accept=pdf/docx/pptx/xlsx`）+ 可见按钮（`e2e/shared/composer/documents/attach#button`），发送前以列表形式展示类型图标、文件名、大小与可键盘触发的移除按钮；图片保留原有缩略图、放大预览与移除。文档与图片共用 4 个附件上限，文档校验 50 MiB 上限与格式白名单，超限/不支持会在发送前以 `role="alert"` 提示且不加入队列。图片仍走视觉资产路径，并且在 `services.inputFiles` 可用时同时暂存为会话输入文件（`App.tsx` 的 `stageInputFiles`），文档只走输入文件路径；`submitGoal` 现在携带 `inputFileIds`（契约、`renderer-stream-client`、DI 容器同步扩展）。
- 任务消息视图：`UserMessage` 渲染 `document` 部件为文件卡片（格式徽标 + 名称 + 大小），文本与图片渲染逻辑不变；卡片使用受控 `data-testid` 并登记到交互契约清单（127 条声明校验通过）。
- 后续任务可见输入：`StreamSessionService` 增加 `describeSessionInputs`，由 `runtime-process` 用 `session_input_files` 的 bound 记录 + 会话工作目录真实路径生成清单，`LangGraphRunner` 把它作为一条 system 消息注入模型上下文（`本会话上传的文件已在工作目录内可直接读取…`），因此同一会话的后续任务直接得到路径，其他会话看不到。
- 定向用例：`AgentComposer.test.tsx` 新增 2 个（文档附件展示/键盘移除/提交、超限与不支持类型拒绝）、`App.test.tsx` 新增 1 个（文档与图片同时暂存并携带 `inputFileIds`）、`Conversation.test.tsx` 新增 1 个（文档卡片格式/名称/大小）、`renderer-stream-client.test.ts` 扩展 `inputFileIds` 转发、`stream-session-service.test.ts` 新增跨任务同会话可见与跨会话不可见用例、`agent-graph.test.ts` 新增模型上下文注入用例。全量 `pnpm test` 872 用例通过；重启恢复由 `session_input_files` 持久化用例与本机打包端到端（`<userData>/workspace/sessions/*/output` 校验）覆盖。
- 联调中发现并修复三处集成缺陷：① 上传新头部触发 CORS 预检被拒（`x-action-driver-file-name` 现列入允许头，`service-http.test.ts` 增加预检断言）；② 图片同时作为输入文件时被额外写成 `document` 卡片（现按 MIME 过滤，图片保留缩略图部件）；③ 模型适配器遇到 `document` 部件直接报 `Unsupported user message content`（现降级为 `[附件] 名称（MIME）` 文本，字节仍留在会话目录供脚本读取）。
- 端到端复跑（2026-09-26）：`pnpm exec playwright test apps/desktop/e2e/tool-runtime.spec.ts` 18 passed / 1 failed（仅既有的“视觉能力未验证”用例，与本次改动无关）；`pnpm test:e2e:packaged:macos` 1 passed（含沙箱、Office 依赖与图片视觉流程）。

## 4. 成品登记与打开

- [x] 4.1 在任务开始和成功结束时比较本会话 `output/` 的安全基线，只登记新建或更新的支持格式普通文件；用旧文件未改动、任务失败、伪装扩展名、符号链接及多成品测试验证。
- [x] 4.2 为每个登记成品创建应用私有的任务快照和持久化清单，保持历史原件不被后续覆盖或外部应用改写；用同名覆盖、校验摘要及重启恢复测试验证。

第 4.1 / 4.2 节验证记录（2026-09-26）：

- 新增 `SessionOutputStore`（`apps/agent-runtime/src/media/session-output-store.ts`）与数据库版本 14 的 `task_output_files` 表。`baseline(sessionId)` 在任务开始扫描本会话 `output/`，只记录普通文件的大小与修改时间；`detectChanges` 在任务成功结束时比较基线，只保留新建或更新过的候选，并且要求扩展名属于 `pdf/docx/pptx/xlsx/png/jpg/jpeg/webp`、魔数匹配（`%PDF-`、`PK\u0003\u0004`、图片嗅探），跳过符号链接、硬链接（`nlink > 1`）、隐藏文件、空文件与超过 100 MiB 的文件，子目录相对路径保留。
- `register` 把每个成品复制到应用私有 `outputs/<sessionId>/<taskId>/<fileId><ext>` 快照（0600）并写入清单（fileId／会话／任务／名称／格式／字节数／原相对路径／sha256／快照路径／时间）；`readSnapshot` 与 `copySnapshotTo` 会重新校验归属（taskId＋sessionId）、普通文件（非符号链接、非硬链接）与摘要，篡改或缺失返回结构化错误。`StreamSessionService` 在任务开始时取基线、仅在任务以 `completed` 结束时登记，失败、取消或未改动旧文件时不产生记录。
- 定向用例 `session-output-store.test.ts`（4）：新旧文件判定、脚本/预览/伪装扩展名/符号链接/子目录过滤、同名覆盖后快照仍为原版本、重开数据库恢复清单并拒绝跨任务与跨会话读取；`stream-session-service.test.ts` 新增「只登记成功任务的成品」用例（成功登记、同会话未改动不重复登记、失败任务不登记）。全量 `pnpm test` 877 用例通过。
- [x] 4.3 扩展任务投影、流式快照和结果 UI，在对应任务展示文件类型、名称、大小、图片缩略图和“打开文件”；用实时、重连、切换任务和键盘操作测试验证。
- [x] 4.4 增加仅接受登记 fileId 与 taskId 的桌面打开桥接，核验会话归属与真实文件后打开临时副本；用有效打开、缺失、篡改、符号链接、跨任务标识和系统打开失败测试验证。

第 4.3 / 4.4 节验证记录（2026-09-26）：

- 投影与快照：契约新增 `TaskOutputFileProjection`（fileId／会话／任务／名称／格式／字节数／kind），`buildTaskProjection` 接受登记清单并输出 `outputFiles`；`createLocalRuntimeServer` 通过 `outputFiles(taskId)` 把清单并入 `task.get`，`StreamSessionService` 的快照事件同样附带 `outputFiles`（流协议 schema 已扩展并在服务用例中经 `parseStreamServerEvent` 校验），桌面 `StreamTaskProjection` 在实时、重连与历史恢复时把快照里的成品映射进任务，切换任务后各自保留自己的清单。
- 结果 UI：新增 `TaskOutputFiles` 组件，在对应任务的最终回复之后展示格式徽标、文件名、大小与“打开文件”；单个卡片失败只在该卡片显示原因，不影响其他卡片与任务内容；键盘可直接触发打开操作（`tab` + `Enter`）。
- 打开桥接：`desktop:task-output:open` 只接受 `{fileId, taskId, sessionId}`（非法标识直接拒绝），主进程用服务令牌请求 `GET /sessions/:sessionId/outputs/:fileId/content?taskId=`，Runtime 侧由 `SessionOutputStore.readSnapshot` 重新校验归属、普通文件（拒绝符号链接与硬链接）与 sha256，再把字节写入临时副本并交给系统默认应用打开；系统打开失败会返回可读错误，页面不接触原始路径。
- 定向用例：`task-projection.test.ts`（清单投影）、`stream-session-service.test.ts`（成功任务快照携带成品）、`TaskOutputFiles.test.tsx`（卡片展示、键盘打开、失败留在卡片）、`task-output-ipc.test.ts`（有效打开、缺失/跨任务拒绝、系统打开失败）。`pnpm typecheck`、`pnpm lint`、`pnpm test` 全绿（135 个文件、882 用例通过，2 跳过）。
- 端到端复跑：`pnpm test:e2e:packaged:macos` 1 passed（15.6s，含新的主进程打开桥接注册）；`pnpm exec playwright test apps/desktop/e2e/tool-runtime.spec.ts` 18 passed / 1 failed（仍仅为既有的“视觉能力未验证”用例）。

## 5. 兼容性与集成验证

- [x] 5.1 更新系统文档、图片生成和 Office Skill 的工作目录与 `output/` 成品约定，并在 `office-skill-compat.patch` 记录对上游 Skill 的改动；校验补丁与源清单一致，运行各 Skill 的代表性生成检查。
- [x] 5.2 运行类型检查、Lint、Runtime/Desktop 相关测试及开发版与打包版端到端流程，手动确认 PDF、DOCX、PPTX、XLSX、图片的输入和输出卡片、同会话复用、跨会话拒绝与历史打开；把命令结果和未覆盖风险记录在本任务项。

第 5.1 节验证记录（2026-09-26）：

- 四份 Office Skill 与 `imagegen` 的 `SKILL.md` 末尾新增 “Action-Driver working directory” 约定：脚本以当前会话工作目录为起点、从只读 `input/` 读取上传件、把成品写入 `output/`、中间产物放在 `output/` 的私有子目录、通过 `load_workspace_dependencies` 解析运行时而不是安装依赖；`imagegen` 额外说明 `image_generate` 直接交付图片、只有辅助脚本才写文件。
- `office-skill-compat.patch` 由上游快照与本机随包目录重新生成（覆盖 4 个 `SKILL.md`，8.2 KB）。前向校验：把上游 `~/.codex/plugins/cache/openai-primary-runtime/<skill>/26.923.10815/skills/<skill>` 复制到临时目录后 `patch -p1` 应用该补丁，与随包目录逐文件比对 163 个文件全部一致；反向校验：对随包目录 `patch -p1 -R` 后 163 个文件的 SHA-256 全部回到来源清单记录值（零差异）。
- 代表性生成检查（`apps/agent-runtime/tests/session-sandbox.test.ts`，全部经真实脚本工具在沙箱内执行）：`documents` 用 `RUNTIME_PYTHON` 生成 DOCX，再用随包 `soffice` 转出 `output/sample.pdf`（文件头 `%PDF`）；`spreadsheets` 用 `RUNTIME_NODE` + `@oai/artifact-tool` 导出 `output/sample.xlsx` 并复读校验公式结果为 5；`presentations` 导出 `output/sample-deck.pptx`；`pdf` 用 `reportlab` 生成 `output/sample-report.pdf` 并用 `pypdf` 校验页数与文本。

第 5.2 节验证记录（2026-09-26）：

- 命令结果：`pnpm typecheck` 退出 0；`pnpm lint`（含 129 条交互声明校验）退出 0；`pnpm test` 135 个文件通过、2 个跳过，882 个用例通过、2 个跳过。
- 开发版端到端：`pnpm exec playwright test apps/desktop/e2e/tool-runtime.spec.ts` 19 passed / 1 failed，新增 `registers a generated deliverable as a task output card after reload` 通过（实时出现卡片、`打开文件` 可见、刷新后仍归属该任务）；唯一失败仍是既有的 “keeps an image draft and skips provider calls when vision is unverified” 用例，与本次改动无关。
- 打包版端到端：`pnpm test:e2e:packaged:macos` 1 passed（15.7s），覆盖随包解释器与 Office 依赖、每会话沙箱（cwd 在会话目录、无 `ACTION_DRIVER_*` 泄漏、越界读取被拒）、图片视觉流程与新的主进程打开桥接注册。
- 用户反馈后修复的第二个缺陷：发送后续对话时，上一轮的成品卡片会消失。原因是任务投影只带当前任务的 `outputFiles`，历史轮次不携带自己的清单；现改为 `PriorActivityTurnProjection.outputFiles`（由 `local-runtime-server` 按轮次查询 `task_output_files` 填充），`TaskPage` 在每轮回复之后渲染该轮自己的卡片，因此发送后续对话与刷新页面后历史卡片都仍在。端到端用例扩展为：生成成品 → 刷新仍可见 → 发送不再产出文件的新一轮 → 老卡片仍在 → 再刷新仍在（已用“移除修复即失败”的方式验证该用例确实锁定该缺陷）。
- 用户反馈后补充的第三处覆盖：多成品与多次会话。端到端用例现在一次生成两个成品（`report.pdf` 与 `summary.pdf`）并断言两张卡片、两个「打开文件」；随后开启第二个会话再生成两个成品，切回第一个会话后仍显示它自己的两张卡片，且刷新后保持。另用本机真实数据库副本复核：`task-439be815…` 的 `task_output_files` 有 4 条记录，`task.get` 返回的 `outputFiles` 包含 demo.pdf/docx/xlsx/pptx——即 4 个文件没有卡片是运行中的旧 dev 应用实例（02:10 启动）仍在跑旧渲染包，重启后即可看到。
- 联调中发现的真实缺陷：`response.end` 事件最初把登记记录原样写入（含 `checksum`／`createdAt` 等额外字段），流协议严格校验拒绝该事件，任务停留在 “running”。现改为只发送协议字段，由上面的端到端用例锁定。
- 卡片样式按用户反馈重做两轮：最终为占满父容器内容宽度的整行卡片，左侧使用对应 Skill 自带图标（`documents`/`pdf`/`presentations`/`spreadsheets` 的 `assets/*.png`，图片用 `imagegen` 图标，已复制到渲染层 `assets/`），名字与大小分两行，右侧对齐轻量“打开文件”（带外链图标，悬停变强调色）；图片成品在可读取时显示真实缩略图，用户消息里的输入文件卡片同步换成同一套 Skill 图标。视觉检查截图：`test-results/tool-runtime-registers-a-g-9b8db-sk-output-card-after-reload/task-output-files.png`。

未覆盖风险：

- 未在真实 macOS 默认应用中点击验证“打开文件”的最终落地效果（桥接的取数、临时副本、错误分支由 `task-output-ipc.test.ts` 单元用例覆盖，打开动作本身依赖系统环境）。
- `pnpm test:e2e:local` 仍保留一个既有失败用例（设置页 “Token Plan 生图接口” 下拉框与当前界面不一致），本次未修；该失败与生图设置界面有关，不在本变更范围内。
