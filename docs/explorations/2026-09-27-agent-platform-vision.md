# ActionDriver Agent 平台预想与方案讨论记录

记录日期：2026-09-27。

本文保存本次侧边对话中的产品预想、技术调查、候选方案、工程建议和未决问题，作为后续讨论的上下文。按主题整理，不是逐字聊天导出。实现事实是本次调查时的快照，后续可能变化。

本文不是已裁决的架构设计、功能承诺或实施计划。用户要求保存讨论，不代表采纳所有建议。未来改变模块边界、公共接口、安全约束或技术选型时，仍需完成仓库规定的 Battle，并进入 OpenSpec propose/update/apply/archive 流程。本次仅整理文档，不改变运行时或主线程任务。

## 1. 产品预想

用户希望 ActionDriver 成为可以组合通用能力的 Agent 应用，而不局限于代码与办公：

- Agent 理解任务、判断下一步，通过 JS API 调用确定性能力。
- REPL 与执行层管理脚本、会话、生命周期和工程化处理。
- 固定步骤、业务流程、日志查询、测试执行、文档和图表生成可封装为服务。
- 维护软件布局与页面状态，减少反复观察和模型推理，必要时更新。
- 支持工作流、定时任务、本地和云端执行，明确资源归属。
- 参考 VS Code，把业务能力封装为插件，调用 ActionDriver 提供的宿主 API。
- 插件可以提供 UI、网页、原生应用画面、MCP 服务和 Node/Go 后台组件。
- 前端通过事件流展示文本、工具进度、产物和人工交互。

此前主线程背景涉及 Playwright 与 Electron fork，目标包含 Chrome 改动置于 `ACTION_DRIVER` 宏内、Playwright 改动置于自有目录、两套接口兼容并可同时使用，以及第三方源码、工具、构建产物分目录管理。这些只是背景约束，本侧边对话没有继续 fork、构建、移动目录或提交任务。

## 2. Codex Browser Use 与 Computer Use 调查

### 2.1 Skill 与执行能力

Skill 提供使用指导、流程和检查要求；SDK、工具及 helper 才实际执行。Skill 的存在不证明相应底层能力已经接入。

浏览器自动化也应区分：Codex 集成浏览器能力、外部浏览器控制、用于本地 QA 的 `playwright-interactive` 技能，以及另行安装的浏览器插件。不能以第三方插件实现推断 Codex 内部实现。

### 2.2 内部和外部浏览器是否都是 Playwright

Codex 浏览器接口包含 Playwright 风格的能力，但并非所有操作都通过 Playwright。可见表面还包括 AX、截图和输入、能力发现，以及部分浏览器协议能力。

外部浏览器可以通过扩展和浏览器服务控制已有标签页；这不等同于普通 `chromium.launch()`。仅凭 API 不能确认它使用原版 Playwright、特定 fork，或全部 Chromium 内部实现。

### 2.3 接口与本次更正

可见浏览器表面包括浏览器与标签页选择、创建和导航、观察、元素或坐标动作，以及按后端提供的能力。是否支持上传、下载、日志、剪贴板和额外协议接口，应以当前后端实际公布的文档为准，不能把清单中的 API 当作所有后端都支持。

本次早期曾仅依据缓存 `api.json` 的 `unsupportedByDefaultIn: iab` 判断内部浏览器 AX 默认不可用；后续检查实际运行配置与代码后已更正：

- 当前调查配置 `BROWSER_USE_TINYSKY_ENABLED=1`。
- 浏览器服务通过 `apiSupportOverrides` 启用 `Tab.ax`，并禁用旧 `Tab.cua`、`Tab.dom_cua` 表面。
- TinySky Tab 的 `getAXState()`、`getScreenshot()`、`getAXStateAndScreenshot()` 和操作方法绑定到 AX 表面。
- 应以有效配置与运行时能力覆盖为准，不能只读缓存默认值。

### 2.4 底层组件职责

```text
Agent-generated JavaScript
  --> persistent Node REPL
  --> @oai/cua unified App/Tab API
      --> browser backend / @oai/browser-desktop
      --> @oai/sky SDK
          --> trusted service bridge
          --> native Computer Use helper
```

| 组件 | 职责 |
| --- | --- |
| Node.js | JavaScript 执行基础 |
| Node REPL / js_repl | 执行代码、保留绑定、输出文字和图像、重置环境 |
| `@oai/cua-repl` | MCP 工具与官方 REPL 启动、指令注入和运行配置 |
| `@oai/cua` | 统一 App/Tab API、表面选择、文档及观察输出 |
| `@oai/browser-desktop` | 浏览器客户端与可信服务端桥接、浏览器后端调用 |
| `@oai/sky` | 跨平台原生控制 JS SDK、可信 RPC 与平台适配 |
| 原生 helper | AX、窗口、截图、输入、权限等系统操作 |
| Playwright / CDP | 浏览器自动化 API 和协议能力；不代表全部控制路径 |
| MCP / RPC | 发现与调用、请求结果传输，不是浏览器引擎 |

调查还发现图像工具 `sharp`、`pngjs`、`jpeg-js`、`pixelmatch`，Accessibility WASM、ZXing 解码组件、LevelDB 依赖及 Statsig 配置组件。它们分别提供图像、结构处理、识别、存储或配置支撑，不应统称为浏览器控制框架；具体存储和配置用途未全部追踪。

官方插件还通过生命周期 hook 与工具对接。现代统一 CUA 入口会注入当前 API 指令，不能把旧版手动导入 Sky 的 Skill 当作当前唯一入口。

### 2.5 已复制到 ActionDriver 的内容

调查目录：`apps/agent-runtime/vendor/codex-cua/`。

| 包 | 调查时项目内容 | 限制 |
| --- | --- | --- |
| `@oai/cua` 0.2.5 | JS、类型、文档 | 排除了浏览器实现目录 |
| `@oai/cua-repl` 0.1.0 | JS、指令、文档和插件内容 | 已复制不等于启用了官方启动器 |
| `@oai/sky` 0.7.1 | JS、类型、文档 | 不包含原生二进制和原生应用 |
| `@oai/browser-desktop` | 未复制 | 当前项目不能据此宣称已接入官方浏览器后端 |

调查时安装应用的 Sky 为 0.7.4，与项目 vendor 版本不同。

四个安装包的 manifest 未提供可确认的开源许可声明，关联插件出现 Proprietary 标记。可阅读 JS、`private:false`、复制到本地，均不等于取得开源或再分发授权。公开 Codex 仓库的 Apache 2.0 不自动覆盖桌面捆绑 SDK。项目 `SOURCE.md` 的内部使用声明也不是上游许可授予。

### 2.6 为什么是自己的 REPL

项目虽然复制了 `cua-repl`，实际入口是自己的 `JsReplHost` 和 `resources/js-repl/repl-server.mjs`，使用 `vm.SourceTextModule` 等机制执行并保留代码绑定。

官方 `cua-repl` 启动器依赖独立 `node_repl` 可执行文件；项目没有直接使用该启动路径。当前自己的 REPL 加载统一 CUA 时使用 `create_tinysky_alt({ browser: false, computer: true })`。

```text
Agent JS
  --> own REPL
  --> vendored CUA / Sky
  --> trusted host adapter
  --> own local Swift helper
  --> macOS UI
```

REPL 是代码执行层，helper 是系统操作层，可信 host 负责路由与检查。VM 本身不能被当作完整安全沙箱。当前这条 Computer Use 链路也不能当成 Browser Use 已完成的证据。

### 2.7 拆层的价值与代价

收益：运行时与原生服务独立演进；替换后端；明确权限；统一追踪；分层测试；进程故障不必摧毁所有状态。

代价：IPC、协议版本、状态同步、错误传播和调试复杂度。进程分离不自动等于权限隔离，取消脚本也不会撤销已经发生的外部操作。职责分层不要求每层都拆成独立 npm 包。

## 3. Swift 原生层的边界

当前项目 Swift 层是 Native Computer Use Helper，可以控制浏览器窗口，但不提供 DOM、网页 JS、标签页生命周期或 Playwright API。

| 职责 | 实现内容 |
| --- | --- |
| 应用目标 | 查找和解析应用，必要时启动 |
| 观察 | AX 树、文本、元素编号、全文或差异 |
| 截图 | 使用 ScreenCaptureKit 捕获目标窗口 |
| 动作 | AX 操作、CGEvent、点击、拖动、滚动、键盘、粘贴 |
| 引用管理 | 会话元素映射、失效检测 |
| 工程控制 | 界面稳定等待、窗口坐标转换、应用占用检查 |
| 会话监督 | 用户停止、人工输入中断、系统权限与策略检查 |
| 通信 | 私有 Unix Socket、请求校验、结构化响应 |

协议包含 `list-apps`、`app-policy`、`session-start`、`session-end`、`app-state`、`act`、`permissions`，及 `cancel`、`shutdown`、`guidance` 控制请求。取消等请求的具体效果涉及队列和入口路由，不能仅依据 service 中的 accepted 响应认定已完成控制。

`act` 包含坐标和元素点击、拖动、滚动、按键、输入、粘贴、设置值、文本选择、辅助功能次级动作。上层 SDK 包装成易用方法。

核心参考：

- `apps/native-computer-use-helper/Sources/ComputerUseCore/ComputerUseCore.swift`
- `apps/native-computer-use-helper/Sources/ComputerUseCore/NativeComputerUseService.swift`
- `apps/native-computer-use-helper/Sources/ComputerUseCore/ComputerUseWire.swift`
- `apps/native-computer-use-helper/Sources/ComputerUseCore/ComputerUseSocketServer.swift`

Codex 原生 helper 源码没有复制进项目；我们自己的 Swift 实现不是已验证的 Codex 内部实现。

## 4. 模型与确定性执行

讨论的专业术语包括 Code Agent、Code-as-Action、Programmatic Tool Calling、Agent Runtime、Execution Harness、SDK 与 Backend Adapter。不是所有术语都有唯一统一定义。

准确表述：模型生成调用已有 JS API 的代码，接口本身由工程层实现。

| 层级 | 职责 |
| --- | --- |
| 模型 | 理解任务、选择目标、组合动作、解释结果 |
| REPL | 执行脚本、变量持久化、会话隔离、超时、取消、输出 |
| 控制 SDK | 参数校验、前置检查、统一错误、动作结果验证 |
| 驱动 | 连接、协议转换、具体平台操作 |
| 固定流程 | 顺序、条件、状态机、恢复规则 |

封装接口减少写代码；只有限制任意代码执行，才能强制防止绕过流程。可提供固定流程模式与 REPL 探索模式。稳定流程逐渐固化，未知界面保留探索能力。

容错分层：代码超时属于 REPL，连接失败属于驱动，元素失效属于控制层，业务提交结果属于工作流。读取通常可重试；点击付款等超时后先查询实际结果，不能盲目重试。

## 5. 日志与自动化测试服务

可把日志和已有测试执行封装为工具。示意接口：

- `logs.query()`：按任务、时间、组件、严重程度查询。
- `logs.trace()`：根据关联 ID 查询调用链。
- `tests.list()`、`tests.run()`、`tests.result()`、`tests.cancel()`。

服务负责参数、固定命令、进程隔离、超时、取消、退出码、报告与产物；Agent 提出假设、选择定向测试、解释结果。

运行已有测试与生成新测试要分开。后者修改项目，需要开发流程。测试范围约束应体现在服务中，例如本仓库迭代期只能运行定向测试，全量验证属于提交阶段。初期可以模块化包装，无须立刻建立独立服务进程。

## 6. 文档与图表服务

### 6.1 当前 Skill 与底层

本次检查 Codex primary runtime 26.905.11957 的 documents、presentations、pdf、spreadsheets 技能及项目对应内容。Skill 包含模型指导、工程流程和辅助工具，不等于统一服务已实现。

| 格式 | 调查时主要实现 | 验证要求 |
| --- | --- | --- |
| DOCX | python-docx、OOXML/XML helper，允许捆绑 JS 辅助 | 渲染每页，检查样式、模板、批注和修订 |
| PPTX | `@oai/artifact-tool` JS，Python 校验脚本 | 文件结构、尺寸、字体、原生对象、图表与表格检查，加视觉检查 |
| PDF | reportlab、pypdf、pdfplumber、Poppler | 页面渲染、内容、表单逻辑字段与外观一致性 |
| XLSX | `@oai/artifact-tool` JS，Python 辅助分析 | 重算、公式错误、输入变更、视觉与保存后功能检查 |

“全部底层使用 Python”是候选路线，不是当前 Codex 的实现。当前 PPT 技能指定 JS Artifact Tool；Excel 也优先该库。调查时 Artifact Tool 版本 2.8.59，依赖 skia-canvas 与 `@oai/walnut`，存在 artifact-session 导出入口；没有据此声称已运行或确认全部服务能力。

DOCX 典型链路：生成或编辑 --> LibreOffice 转 PDF --> pdf2image/Poppler 页面图片 --> 检查与修复。辅助脚本处理样式、目录、批注、修订、表格、交叉引用等，适合固定接口。

PPT 的 finalizer 可校验导入与声明的要求，但不证明美观、事实正确或已在 PowerPoint 中验证。Excel 文件成功导出不证明公式在目标应用中的行为；需要区分公式文本、缓存结果与真实重算。

PDF 表单同时检查 AcroForm 字段、Widget 与 appearance；视觉正确不一定代表逻辑值正确。默认保留交互，扁平化是额外选择。

建议统一 `create`、`patch`、`inspect`、`render`、`validate`、`export` 的任务入口，内部保留格式专用 API；后端可混合 Python、JS、LibreOffice 和 Poppler。模型负责内容与设计意图，服务负责资源、版本、生成和验证。

### 6.2 DOCX 细粒度接口

用户明确提出文字、样式、排版分层；讨论增加文档结构作为承载层：

| 层级 | 对象 | 示例 |
| --- | --- | --- |
| 结构 | 节、段落、表格、图片、页眉页脚 | insertParagraph、insertTable、addSection |
| 文字 | 段内范围与文本片段 | replaceText、insertText、deleteText |
| 样式 | 命名样式、字体、颜色、直接格式 | defineStyle、applyStyle、setRunFormat |
| 排版 | 页面、分页、分栏、布局 | setPageSetup、setParagraphLayout、setTableLayout |

原则：稳定对象 ID、匹配歧义报错、格式保留、命名样式与直接格式区分、批量事务、结构化编辑报告。文字替换不能默认重建整个段落，否则可能丢失链接、批注和格式。

样式可包含排版属性，需要处理继承和覆盖。页是排版引擎计算结果，不是稳定对象；页码定位应映射到段落 ID，编辑后重新渲染。

### 6.3 DOCX 候选方案

- Codex documents：脚本与渲染检查路线。
- Claude 官方 docx Skill：新建使用 docx npm，已有文件解包修改 OOXML，辅助脚本检查与渲染；公开可见不等于开源授权，技能声明 Proprietary。
- knorq-ai/docx-mcp-server：内容、格式、布局、批注与修订工具；段落锚点目前只覆盖正文顶层，不覆盖表格或内容控件内段落。
- GongRzhe/Office-Word-MCP-Server：Python 文档工具、文字范围格式化、段落和样式。
- DocxEngine：Python 包及 MCP，声明关注修订、批注与格式保留；保真度未实测。
- Microsoft Word JS API：成熟对象模型，但依赖 Word 加载项环境。
- Word Copilot：应用内编辑能力；产品文档不揭示完整内部接口。
- ONLYOFFICE AI Agent：编辑器内助手及 MCP；默认工具清单不证明全部细粒度 API。

候选组合：文档对象模型 + 固定服务 + Skill 指导 + 渲染检查；未决定采用某个底座。

### 6.4 图表与渲染讨论

图表候选：Vega-Lite 用声明式规格；ECharts 用于交互与 SSR；Plotly 用于 Python 交互和 Kaleido 导出；Matplotlib 用于精细静态图。Office 原生可编辑图表需专用文档后端，图片或 SVG 不等同于数据系列可编辑。

图形方案：DOM 适合文字与表单；SVG 适合对象、缩放和矢量输出；Canvas 适合重绘与像素处理，但需自己维护语义模型；Konva 提供 Canvas 场景树；React Flow 提供节点编辑；PixiJS 用于二维 GPU 场景；Three.js 用于三维。WebGL/WebGPU 常通过 Canvas 展示，不是完全平行类别。

工程建议：保存场景或图表规格作为事实来源；Agent 操作语义 API；细粒度编辑、批量提交；展示与导出分别验证；提供对象树、数据表和文字说明。用户后续纠正，希望主要推荐 Agent 方案，而非继续展开图表框架。

## 7. UI 结构缓存与复用

用户提出：先查询软件布局、缓存，后续直接调用，失败后再更新，以减少 Agent 重复理解页面。

讨论建议修正为“缓存 + 轻量有效性检查 + 结果验证 + 按变化失效”。原因：列表重排后点击可能成功但目标错误，只有失败才刷新不能发现此类错误。

| 缓存 | 内容 | 更新 |
| --- | --- | --- |
| 应用结构 | 导航区、工具栏、常见路径 | 布局或应用版本变化 |
| 当前状态 | 页面、弹窗、选中项、属性 | 导航、弹窗及相关事件 |
| 定位规则与引用 | Locator、AX 引用、坐标 | 使用前校验，失效后重新定位 |

浏览器结合 DOM、导航、滚动和尺寸事件；MutationObserver 不覆盖所有视觉变化。桌面结合 AX 通知、观察和引用校验。坐标最容易随布局失效。

控制层保存完整状态，给模型任务相关结构和变化；状态有版本，动作引用版本。优先缓存“怎么找”，不要把旧业务数据当作当前事实。

候选机制：

- Midscene：缓存规划和定位；有效性检查后复用，失效回退模型；查询与断言结果不缓存。引用的定位缓存文档限定 Web DOM，版本能力需重新核对。
- Stagehand：observe/act、动作缓存、Agent 步骤复用和自修复；服务端缓存仍使用页面内容，不意味着完全停止观察。
- Playwright Locator：复用定位规则，每次动作解析最新 DOM，不是缓存旧元素句柄。
- POM：人工或后续 Agent 生成的页面操作模型，适合已知应用。
- Healenium：Selenium 定位自修复，不是 Playwright 插件，也不负责业务理解。
- XState/Stately：状态、合法动作与恢复路径；Stately Agent 2.0 文档当时标为 Alpha。
- Skyvern：参数化、可复用业务工作流。

建议组合：页面对象提供能力，事件维护状态，状态机固化成熟流程，Agent 处理未知情况。评价成功率、误操作率、执行时间和模型调用量，而不只比较速度。

## 8. 通用任务领域

跨业务领域包括检索研究、知识管理、数据分析、文件资产管理、多媒体、沟通协作、流程自动化、监测诊断、计划调度和质量检查。

基础能力可归纳为：获取信息、处理信息、生成产物、执行操作、管理过程、验证结果。任务领域与技术能力不同；研究助手或运维助手可以共享同一底座，通过 Skill、工作流与权限组合。

## 9. 工作流与定时任务

三种结合方式：Agent 调用固定工作流；工作流在某节点调用 Agent；固定执行遇异常交给 Agent，验证后恢复。

示例：读取数据 --> 校验统计 --> Agent 分析原因 --> 图表文档服务 --> 规则与视觉检查 --> 保存。

工作流负责状态、依赖、超时、取消、暂停、恢复和重试；Agent 节点返回结构化结果。探索成功的流程可审核后固化，不能未经验证自动提升为可靠流程。

定时器只决定何时开始，工作流决定如何执行，Agent 完成判断。区分一次性、周期与持续监测；监测保存上次结果，变化有意义才通知。

调度必须考虑时区、幂等运行 ID、重叠策略、关机后的补跑、凭证和会话、通知规则。本地任务依赖电脑与桌面环境；云端可持续运行但不自动获得本地能力。周期报表可独立运行，任务跟进可保留相关上下文。

## 10. 本地、worktree、云端与混合执行

本地/云端是位置，worktree 是代码检出隔离，两者正交。

| 形态 | 价值 | 限制 |
| --- | --- | --- |
| 本地当前工作区 | 现场文件、应用、协同排查 | 与用户共享文件、端口与 UI |
| 本地 worktree | 独立代码目录与分支，便于并行 | 不是沙箱，仍共享系统与 Git 元数据 |
| 云端环境 | 后台、批量、可重建环境 | 依赖预配环境，不能直接访问本机桌面 |

能力由环境和权限决定，不由模型或 worktree 标签决定。配置应分别声明位置、工作区和能力。

混合例：云端分析订单，本地登录浏览器下载发票，回传产物 ID，云端生成报告。

耦合点包括文件、登录、浏览器状态、代码版本、取消、重试、日志与能力差异。共享协议、运行 ID、错误和产物引用；分别管理路径、进程、会话、凭证和资源生命周期。跨端数据流应显式声明。

## 11. Agent 框架与工程实践

| 方案 | 研究用途 |
| --- | --- |
| OpenAI Agents SDK | Agent 循环、工具、会话、交接与追踪 |
| LangGraph | 状态图、检查点、人工中断与恢复 |
| Temporal | 长任务、持久化执行、崩溃恢复与等待 |
| Pydantic AI | 类型化输入输出、依赖注入与验证 |
| MCP | 工具与资源协议，不是工作流引擎 |
| Langfuse | 调用追踪、实验、数据集与评测 |

建议：从单 Agent 和简单流程开始；确定性工作流包住模型判断；聊天、执行、资源状态分开；按需加载上下文；采用结构化工具结果；副作用需要幂等；评测实际业务结果；只有明确收益才引入多 Agent。

不同框架可以位于不同层，但不能让多个框架同时争夺任务状态所有权。这里列举的是研究候选，不表示替换当前项目技术选型；尤其不覆盖项目现有观测方案。

## 12. 前端流式输出

| 方案 | 职责 |
| --- | --- |
| Vercel AI SDK UI | 流式消息、工具和自定义数据、前端状态 |
| assistant-ui | 聊天组件和自定义 runtime 适配 |
| AG-UI | Agent 与前端的事件协议，不是完整 UI |
| CopilotKit | 前端工具、共享状态与交互组件 |

文本流不够表达任务，应包含运行、消息增量、工具开始/进度/结果、产物、等待用户、完成与失败事件。纯文本 transport 可能缺失工具信息。

工程要求：runId、对象 ID、序号；关键事件持久化；断线补发与去重；前端连接与后台运行分离；合并高频渲染；区分断线与任务失败。协议不自动提供恢复或执行持久化。不应向 UI 暴露模型原始隐藏思维链。

当前建议是适配已有 Runtime，优先评估 assistant-ui 或 AI SDK UI，并参考 AG-UI 事件模型，不为前端替换完整执行层。

## 13. 插件化业务能力

用户希望参考 VS Code，把业务能力做成插件，并调用内部能力。

建议定义稳定的宿主 SDK，开放浏览器、文档、调度、产物等能力；数据库对象、核心状态和 Electron 主进程仍由宿主持有。插件调用宿主服务，不直接导入私有核心模块。

插件可贡献命令、面板、Agent 工具、Skill、工作流和 MCP 服务。插件内部可使用细粒度 API，对 Agent 仅暴露完整业务动作。

```text
Agent / Skill / workflow
  --> plugin tools and business logic
  --> versioned ActionDriver SDK
  --> host services
      --> browser / computer / docs / logs / tests
```

需要 manifest、版本兼容、按需激活、资源清理、日志与能力授权。参考 VS Code 机制不等于必须兼容全部 VS Code API。

### 13.1 展示内容

- MCP Apps：服务提供 UI 资源，宿主用沙箱 iframe 和 AppBridge 展示与通信。
- 普通网页：WebContentsView；iframe 受网站 CSP 等限制；Electron 不推荐继续使用 webview 标签作为首选。
- 插件 UI：隔离 iframe 或 WebContents，受控 UI bridge。
- 原生应用：截图或实时窗口流，控制通过原生 helper；不是把原生窗口转换成 DOM。
- 远程桌面：画面协议与输入通道。

普通 MCP 服务可能没有 UI。MCP Apps 是交互界面扩展，不是所有网页或桌面画面的通用传输协议。

### 13.2 屏幕与应用共享插件

完整能力包括选择目标、开始观看、可选控制、状态显示、断线恢复和停止。

| 方案 | 场景 | 边界 |
| --- | --- | --- |
| Electron desktopCapturer | 本机屏幕或窗口 | 画面捕获，输入另走 helper |
| LiveKit/WebRTC | 跨机、多人、音视频 | 媒体传输，输入控制另做 |
| noVNC | 浏览器访问 VNC | 需要 VNC 服务及 WebSocket 通道 |
| Guacamole | 远程桌面网关 | RDP/VNC/SSH，不能默认单应用共享 |

候选路线：本机先用窗口捕获 + helper，跨端用 LiveKit，远程桌面单独接 noVNC/Guacamole。MCP 控制开始停止，媒体走专用通道，MCP Apps 可提供面板。

观看与控制分别授权；维护缩放、裁剪、尺寸和帧版本；窗口关闭或重建更新目标；插件卸载释放资源；音频、最小化窗口和受保护内容需按 OS 验证。

### 13.3 插件运行环境

插件是 manifest 与组件集合，不限 Node：

| 组件 | 执行 | 通信 |
| --- | --- | --- |
| JS/TS 扩展 | Node 插件宿主 | SDK/RPC |
| 本地 MCP | 语言不限的子进程 | stdio |
| Node 服务 | 明确版本运行时 | RPC/HTTP/MCP |
| Go 服务 | 各平台二进制 | RPC/HTTP/MCP |
| 远程 MCP | 远程服务 | Streamable HTTP |
| UI | 隔离渲染表面 | UI bridge |

MCP 是协议，Node/Go 是语言。宿主管理工作目录、配置、凭证、就绪握手、健康、退出、日志和版本。

Node 提供固定运行时与已构建依赖，避免启动时临时安装；Go 发布对应平台/架构二进制并检查动态依赖；stdio 的 stdout 只传协议，日志走 stderr；HTTP 管理动态端口和认证；安装目录与数据目录分开。

进程隔离不是权限沙箱。未受 OS 约束的插件可绕过 SDK 调用系统 API，需区分可信插件和受限插件。

### 13.4 VS Code 实际机制

VS Code 有本地 Node、远程 Node 与 Web Worker 扩展宿主。宿主选择受 main/browser 入口、extensionKind、安装位置和环境影响；通常多个扩展共享一个宿主，并非每插件独立进程。

JS/TS 扩展注册命令、面板和服务；Go 等通常通过薄 JS 扩展启动，独立进程执行，通过协议通信。语言服务器是典型例子。Go 服务不直接 import vscode。

扩展可通过 `vscode.lm.registerMcpServerDefinitionProvider` 注册 MCP 定义。Web 扩展没有 Node API，不能启动本机可执行文件，需要远程或本地宿主桥接。

借鉴点：SDK 接宿主，协议接服务，面板接展示；不要误把 VS Code 进程分离当成逐插件权限隔离。

## 14. 未决问题与后续验证

以下尚未裁决，不是实施任务：

1. 固定流程模式与探索 REPL 的切换和授权边界。
2. 自有 Browser Use API 与 Playwright、Chrome 扩展能力的接口关系。
3. 第三方 SDK 许可、替换与分发策略。
4. 页面缓存粒度、目标身份、失效机制和误操作验证。
5. 文档服务对象模型、保真度、公式引擎与渲染一致性。
6. 任务事实来源、工作流与 Agent 状态所有权。
7. 定时补跑、通知和跨端离线行为。
8. 插件信任等级、沙箱、能力授权、版本和升级机制。
9. 插件 UI、MCP Apps 与外部网页的集成边界。
10. 单窗口共享的跨平台表现与人工控制互斥。
11. 哪个流式协议适配当前 Runtime，如何恢复和回放。
12. 是否引入框架，或只借鉴机制并保留现有实现。

候选框架在本次主要进行了文档与接口核查，没有运行系统性对比测试。选型前应通过少量真实任务验证成功率、误操作、恢复、性能、成本、许可与发布条件。

## 15. 参考资料与调查路径

### 官方与项目资料

- [OpenAI Computer Use](https://developers.openai.com/api/docs/guides/tools-computer-use)
- [Codex 集成浏览器说明](https://learn.chatgpt.com/docs/browser?surface=app)
- [本地安全与 Browser/Computer 边界](https://learn.chatgpt.com/docs/enterprise/chatgpt-work-local-security)
- [Skills 概念](https://developers.openai.com/plugins/concepts/skills)
- [公开 Codex 许可](https://github.com/openai/codex/blob/main/LICENSE)
- [Code execution with MCP](https://www.anthropic.com/engineering/code-execution-with-mcp)
- [CodeAgent](https://huggingface.co/docs/smolagents/main/index)
- [Building effective agents](https://www.anthropic.com/engineering/building-effective-agents)
- [OpenAI Agents SDK](https://openai.github.io/openai-agents-python/agents/)
- [LangGraph interrupts](https://github.com/langchain-ai/docs/blob/main/src/oss/langgraph/interrupts.mdx)
- [Temporal AI](https://docs.temporal.io/ai)
- [Pydantic AI 输出](https://pydantic.dev/docs/ai/core-concepts/output/)
- [Langfuse](https://langfuse.com/docs)
- [MCP](https://modelcontextprotocol.io/)

### 文档与图形

- [Claude DOCX Skill](https://github.com/anthropics/skills/blob/main/skills/docx/SKILL.md)
- [knorq DOCX MCP](https://github.com/knorq-ai/docx-mcp-server)
- [Office Word MCP](https://github.com/GongRzhe/Office-Word-MCP-Server)
- [DocxEngine](https://github.com/ruwadgroup/docxengine)
- [Word JS Paragraph](https://learn.microsoft.com/en-us/javascript/api/word/word.paragraph?view=word-js-preview)
- [Word Copilot](https://support.microsoft.com/en-us/word/copilot/edit-rewrite-content)
- [ONLYOFFICE AI Agent](https://helpcenter.onlyoffice.com/desktop/configuration/desktop-AI-agent.aspx)
- [Vega-Lite](https://vega.github.io/vega-lite/docs/)
- [ECharts SSR](https://echarts.apache.org/handbook/en/how-to/cross-platform/server/)
- [Plotly 静态导出](https://plotly.com/python/static-image-export/)
- [Matplotlib](https://matplotlib.org/stable/users/getting_started/)
- [React Flow](https://reactflow.dev/learn/customization/custom-nodes)
- [Konva](https://konvajs.org/docs/overview.html)
- [PixiJS](https://pixijs.com/8.x/guides/concepts/render-loop)
- [Three.js](https://threejs.org/manual/pages/creating-a-scene.html)
- [W3C 复杂图形说明](https://www.w3.org/WAI/tutorials/images/complex/)

### UI 自动化与工作流

- [Midscene 缓存](https://v1.midscenejs.com/zh/caching)
- [Midscene 当前 API](https://www.midscenejs.com/reference/)
- [Stagehand 缓存](https://github.com/browserbase/stagehand/blob/main/packages/docs/v3/best-practices/caching.mdx)
- [Stagehand act](https://github.com/browserbase/stagehand/blob/main/packages/docs/v3/basics/act.mdx)
- [Playwright Locator](https://playwright.dev/docs/locators)
- [Playwright POM](https://playwright.dev/docs/pom)
- [Healenium](https://github.com/healenium/healenium)
- [Stately Agent](https://stately.ai/docs/packages/agent)
- [Skyvern 工作流](https://www.skyvern.com/docs/cloud/building-workflows/manage-workflows)
- [MutationObserver](https://developer.mozilla.org/en-US/docs/Web/API/MutationObserver/observe)

### 前端、插件与共享

- [AI SDK UI](https://ai-sdk.dev/docs/ai-sdk-ui/chatbot)
- [assistant-ui 自定义运行时](https://www.assistant-ui.com/docs/runtimes/custom/overview)
- [AG-UI](https://docs.ag-ui.com/introduction)
- [AG-UI events](https://docs.ag-ui.com/concepts/events)
- [CopilotKit Generative UI](https://docs.copilotkit.ai/concepts/generative-ui-overview)
- [MCP Apps](https://apps.extensions.modelcontextprotocol.io/api/documents/Overview.html)
- [Electron Web Embeds](https://www.electronjs.org/docs/latest/tutorial/web-embeds)
- [Electron Security](https://www.electronjs.org/docs/latest/tutorial/security)
- [Electron desktopCapturer](https://www.electronjs.org/docs/latest/api/desktop-capturer)
- [LiveKit 屏幕共享](https://docs.livekit.io/transport/media/screenshare/)
- [noVNC](https://novnc.com/)
- [Guacamole](https://guacamole.apache.org/)
- [Theia 扩展](https://theia-ide.org/docs/extensions/)
- [VS Code Extension Host](https://code.visualstudio.com/api/advanced-topics/extension-host)
- [VS Code 远程扩展](https://code.visualstudio.com/api/advanced-topics/remote-extensions)
- [VS Code Web Extensions](https://code.visualstudio.com/api/extension-guides/web-extensions)
- [VS Code Language Server](https://code.visualstudio.com/api/language-extensions/language-server-extension-guide)
- [VS Code MCP 扩展](https://code.visualstudio.com/api/extension-guides/ai/mcp)

### 本地调查位置

- 应用捆绑库：`/Applications/ChatGPT.app/Contents/Resources/cua_node/lib/node_modules/@oai/`
- CUA 插件配置：`/Users/jiangtao/.codex/plugins/cache/openai-bundled/unified-computer-use/26.924.22138/.mcp.json`
- 原生服务配置对应 `Codex Computer Use.app`；未将该应用源码视为已公开。
- 文档技能：`/Users/jiangtao/.codex/plugins/cache/openai-primary-runtime/{documents,presentations,pdf,spreadsheets}/26.905.11957/skills/`
- 捆绑依赖：`/Users/jiangtao/.cache/codex-runtimes/codex-primary-runtime/dependencies/`
- 项目 vendor 来源：`apps/agent-runtime/vendor/codex-cua/SOURCE.md`
- 项目执行入口：`apps/agent-runtime/src/computer-use/{cua-runtime,js-repl}.ts`
- 项目 REPL 与桥接：`apps/agent-runtime/resources/js-repl/{repl-server,codex-service-host,codex-module-loader}.mjs`
- 项目技能：`apps/agent-runtime/resources/system-skills/`

文档中的 API 名称除明确对应现有协议或官方文档外，均为讨论示例，不代表项目已经提供。
