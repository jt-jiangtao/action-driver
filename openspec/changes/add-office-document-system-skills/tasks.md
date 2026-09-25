## 0. 退役旧系统 Skill

- [x] 0.1 移除 `browser-tools`、`computer-tools`、`report-writer` 的随包资源、系统标识与播种逻辑，更新桌面 mock、路径判定和打包清单；验证新安装列表和发布目录均不存在这三个 Skill。
- [x] 0.2 初始化时只删除旧用户目录 `.system/` 下三个退役目录；验证旧副本永久删除，个人 Skill、其他系统 Skill 与 `*-legacy` 备份不受影响。

## 1. 复制四份文档类 Skill

- [x] 1.1 以 Codex 上游快照复制四份 Skill 的全部文件，记录来源版本和逐文件哈希；对冲突的 `spreadsheets`、`pdf` 指令应用独立 patch，验证应用 patch 后随包文件与来源逐一对应且无其他内容改写。
- [x] 1.2 确认复制后各 Skill 的内部相对引用（如 `artifact_tool_docs/API_QUICK_START.md`、`container_tools/runtime_helpers.mjs`、`references/*`）在随包路径下可用，验证引用路径存在性检查通过。

## 2. 系统 Skill 注册

- [x] 2.1 在 `agent-file-store.ts` 的系统 Skill 集合与初始化播种中加入四个新标识，验证初始化后 `.system/` 下四份 Skill 存在且重复初始化不覆盖既有内容。
- [x] 2.2 在 `skill-installer.ts` 的系统标识集合中加入四个新标识，验证以这些名称安装普通 Skill 时被拒绝且不产生半安装目录。
- [x] 2.3 在 `apps/desktop/src/main/index.ts` 的系统路径判定与 `scripts/test-packaged-macos.mjs` 的校验清单中同步四个标识，验证设置页读取路径与打包校验覆盖新 Skill。
- [x] 2.4 验证四份 Skill 在列表中可启停、详情只读、不可重命名或卸载，且启停状态在重启后保持一致。

## 3. 依赖暂存与运行时接线

- [x] 3.1 新增暂存脚本，把本机依赖树的 `bin`、`native`、`node`、`python` 按原布局复制到 `apps/agent-runtime/dist/dependencies/`，缓存缺失时返回可理解的错误；验证复制后 `dependencies/python/bin/python3`、`dependencies/node/bin/node`、`dependencies/bin/override/soffice` 与 `dependencies/bin/override/pdftoppm` 均存在且可执行。
- [x] 3.2 记录并对齐依赖基准版本（Python 3.12.14、Node.js v24.19.0、`@oai/artifact-tool` 2.8.59、随附 LibreOffice 与 Poppler），验证按原样复制后各组件报告版本与来源一致，且流程中不存在重装、升级、降级或按包内解释器重新解析第三方库的步骤。
- [x] 3.3 在构建流程中接入该暂存步骤，并确认它不进入打包发布脚本与 CI 路径。
- [x] 3.4 扩展运行时路径解析，产出 `RUNTIME_NODE`、`RUNTIME_NODE_MODULES`、`RUNTIME_BIN_DIR`、`RUNTIME_PYTHON` 四个包内绝对路径，并把原生二进制目录加入 `PATH`；验证缺失依赖树时返回结构化错误且 `python_run`、`node_run`、`ts_run` 基础执行不受影响。
- [x] 3.5 在四个脚本工具的进程环境中注入上述变量，验证脚本可读取到全部四个变量且取值均为应用包内绝对路径。

## 4. 依赖解析工具

- [x] 4.1 注册只读工具 `load_workspace_dependencies`，返回四个绝对路径，声明只读且无网络副作用，验证工具定义可序列化、按 `proposed → queued → running → completed` 转移且不产生文件或网络副作用。
- [x] 4.2 验证依赖树缺失时该工具返回结构化错误，不回退用户环境。

## 5. 效果验证

- [x] 5.1 用系统 Skill 加随包依赖真实产出 xlsx：构建工作簿、写入公式、执行重算与 `inspect`、导出文件，并验证导出文件可被重新读取且公式结果正确。
- [x] 5.2 真实产出 pptx：构建含原生图表的演示文稿、导出文件并生成原生 PNG 预览，验证预览图存在且非空。
- [x] 5.3 真实产出 docx 并完成渲染验证：生成文档、经随包 LibreOffice 转换为 PDF、再栅格化为页面 PNG，验证产物存在且页数正确。
- [x] 5.4 真实产出 pdf 并完成读取验证：生成 PDF、抽取文本并校验页数，验证抽取结果与写入内容一致。
- [x] 5.5 记录每项验证的实际命令与结果；未通过的路径必须如实标注为未验证，不得声称已通过。

## 6. 集成与回归

- [x] 6.1 运行定向单元测试、类型检查、Lint 与运行时构建，记录结果；仅针对实际失败修复。
- [x] 6.2 运行 OpenSpec 严格校验，确认变更产物内部一致；复查 diff 与工作区状态，确认依赖树未被加入版本控制。

## 7. 本地预置依赖修正

- [x] 7.1 删除 PDF Skill 中缺失依赖时通过 pip、Homebrew 或 apt 临时安装的指令，更新独立兼容 patch；仅在已安装副本与记录的上游原件一致时同步本机 `.system/pdf`，验证文档类依赖均已在本地依赖树中、patch 能从来源清单重建随包 Skill，且运行时不执行条件安装。

本机补充验证（2026-09-26）：`dist/dependencies/` 约 1.6GB，含 Node、`@oai/artifact-tool`、Python、LibreOffice、`pdftoppm`、`pdfinfo`，包内 Python 可导入 `reportlab`、`pdfplumber`、`pypdf`。随包、构建目录和本机 `.system/pdf/SKILL.md` 内容一致，均不再包含 pip／Homebrew／apt 条件安装指令；本机副本更新前的 SHA-256 与来源清单一致。独立 patch 正反应用后分别匹配来源哈希与随包文件；四个相关测试文件共 13 个用例通过。运行时仍只报告缺失依赖，不执行安装。

## 本机验证记录（2026-09-25，darwin-arm64）

依赖根：`apps/agent-runtime/dist/dependencies/`；下列命令均使用该目录内的解释器与第三方库。测试构建器和产物位于 `/tmp/actiondriver-office-smoke.S96sdo/`，未入库。四份 Skill 的 `mark_artifact_operation_started.mjs` 分别在首次生成前用包内 Node 执行一次，均退出 0。

| 格式 | 实际主要命令 | 结果 |
| --- | --- | --- |
| xlsx | `dist/dependencies/node/bin/node /tmp/actiondriver-office-smoke.S96sdo/create-xlsx.mjs` | 退出 0；`recalculate()`、导出前后 `inspect()` 均显示 `C2=5`；重新导入 XLSX 后公式结果为 5。 |
| pptx | 带 `RUNTIME_NODE`、`RUNTIME_NODE_MODULES`、`RUNTIME_BIN_DIR`、`RUNTIME_PYTHON` 四变量运行包内 Node 执行 `create-pptx.mjs` | 退出 0；PPTX 含 `ppt/slides/charts/chart1.xml` 与 `<c:chart>`；原生 PNG 预览为 1280×720、15,522 字节，已目视检查。首次未设置变量的尝试按预期报 `RUNTIME_NODE_MODULES is required`，设置后通过。完整 finalization 门禁未执行。 |
| docx | 包内 Python 执行 `create-docx.py`，再以包内 `bin/override` 为 `PATH` 执行 `documents/render_docx.py sample.docx --output_dir docx-render --emit_pdf` | 两步均退出 0；经包内 LibreOffice 与 Poppler 得到 1 页 PDF、1547×2002 PNG；目视检查后修正默认 Title 样式的蓝色边线，重新渲染通过。 |
| pdf | `dist/dependencies/python/bin/python3 /tmp/actiondriver-office-smoke.S96sdo/create-pdf.py` | 退出 0；`pypdf` 重读为 1 页，抽取文本与写入的 `Bundled PDF validation` 一致。 |

依赖版本实测：Python 3.12.14、Node v24.19.0、`@oai/artifact-tool` 2.8.59、LibreOfficeDev 26.8.0.0.alpha0、Poppler 26.05.0。暂存保留来源的相对符号链接；来源树另有 3 个指向已不存在临时目录的绝对链接，位于 Python 的 `pkgconfig` 和 man 手册文件，不参与上述运行与验证。

集成检查：`pnpm --filter @actiondriver/agent-runtime build:office-local`、`pnpm --filter @actiondriver/desktop build`、`pnpm typecheck`、`pnpm lint`、`pnpm test` 均退出 0；单元测试为 127 个文件通过、2 个跳过，819 个用例通过、2 个跳过。运行时构建目录仅有 `documents`、`imagegen`、`pdf`、`presentations`、`skill-creator`、`spreadsheets`；本地桌面端到端的 Skill 列表用例单独运行通过。`pnpm test:e2e:local` 共 7 项，6 项通过，1 项失败：既有“生图接口设置”用例仍查找当前界面已不存在的下拉框，失败与本次 Skill 列表改动无关；该用例未声称通过。macOS 安装包脚本的清单已更新，但未构建完整安装包。
