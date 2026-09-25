## Why

ActionDriver 需要随包提供 Codex 的 Word、PPT、Excel、PDF 四份 Skill，并让它们真的能产出与验证文件，而不只是可读的说明文本。当前这些 Skill 的正文把 `load_workspace_dependencies`、`@oai/artifact-tool`、LibreOffice 与 Poppler 写成硬前置条件，ActionDriver 既没有该工具，也没有这些依赖；本机探针已验证补齐依赖后四类文件可以真实产出，因此现在把这个能力固化下来。

## What Changes

- 以 Codex 的 `documents`、`pdf`、`presentations`、`spreadsheets` 四份 Skill 的全部文件为基线复制到随包系统 Skill 目录；仅对与本应用包内依赖约束冲突的指令应用可审查 patch，并保留上游版本及逐文件哈希清单。
- 移除无用的 `browser-tools`、`computer-tools`、`report-writer` 系统 Skill：停止随包提供与播种，并在初始化时删除旧安装目录中的系统副本。
- 新增本机依赖暂存步骤，把 Codex 运行时的依赖树按原布局复制为随包依赖：Node 包目录（含 `@oai/artifact-tool`）、Python 解释器及其三方库、Poppler 与 LibreOffice headless 的 `bin`/`native` 目录。
- 依赖版本一律以 Codex 运行时缓存为基准，按原样复制，不重装、不升级、不降级、不按包内解释器重新解析第三方库。
- 扩展四个脚本工具的进程环境，注入 `RUNTIME_NODE`、`RUNTIME_NODE_MODULES`、`RUNTIME_BIN_DIR`、`RUNTIME_PYTHON`，并把依赖 `bin` 目录加入 `PATH`，使 Skill 自带脚本无需改写即可运行。
- 新增只读工具 `load_workspace_dependencies` 返回上述路径，使 Skill 的依赖解析指令继续可用。
- 修订 `bundled-script-runtimes` 中"任意第三方 pip/npm 包不属于离线保证"的表述，明确新增的文档依赖树属于本机验证专用范围。

本次范围**仅用于本机验证，不作为发布产物**。

## Battle

- 类型：产品与架构混合决策。
- 状态：**已完成，用户明确裁决**。
- Battle 记录：Agent 提出 B 中三块依赖的可获得性差异，推荐先做"复制 + 适配层"（方案 A）并把补齐依赖推迟；用户覆盖该建议，明确裁决采用完整补齐（方案 B），理由是本次只做本机验证、不发布。
- 已比较替代方案：方案 A（复制并改写工具契约，不引入依赖）能力降级但零风险；方案 C（只复制到开发侧 `.agents/skills/`）不改产品能力；方案 B（完整补齐依赖）覆盖 PPT/Excel 原生构建链但引入体积与分发问题。最终采用 B。
- 可行性证据：已在脱离 Codex 宿主的环境下实测通过 `@oai/artifact-tool` 导入、xlsx 构建与导出、pptx 构建与原生 PNG 预览、docx → PDF → PNG 渲染、PDF 生成与文本抽取。
- 版本补充裁决：用户明确要求依赖版本出现分歧时以 Codex 为准，因此依赖树按来源原样复制，不为包内 Python 3.13 重新解析或重编译任何第三方库。
- 实施中重新裁决：新版上游 `spreadsheets` 指示工具不可用时读取用户 Codex 缓存，`pdf` 指示改用系统 Poppler 或安装 Poppler，与包内依赖约束冲突。比较了保持逐字复制并新增运行时文件隔离、与最小正文 patch 两案；用户最终选择最小 patch 并要求记录 patch，不增加本次运行时文件隔离。
- 清理裁决：用户要求移除 `browser-tools`、`computer-tools`、`report-writer`，并明确选择同时永久删除旧安装目录中的系统副本，理解可能丢失其中本地改动。仅删除这三个已知系统标识的 `.system` 目录，不清理个人 Skill 或 `*-legacy` 备份。
- 未解决关键分歧：`excel-live-control` 依赖 Excel 桌面版与 ChatGPT add-in 宿主能力，无法在本项目验证，本次不纳入；若需纳入应另行裁决。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `instruction-skill-installation`: 新增"随包提供文档类系统 Skill"的需求，定义四份 Skill 的播种、受保护状态、列表展示与只读内容读取行为。
- `bundled-script-runtimes`: 新增"文档依赖树与运行时路径解析"的需求，定义依赖暂存、`RUNTIME_*` 环境注入、`PATH` 扩展与新的离线/架构边界表述。
- `agent-tool-runtime`: 新增"工作区依赖解析工具"的需求，定义只读 `load_workspace_dependencies` 工具的定义、输出与权限边界。

## Impact

- Runtime：新增依赖暂存脚本与依赖根解析；`execution/runtime-paths.ts` 与 `execution/tools.ts` 增加依赖环境注入；新增一个只读工具定义。
- 随包资源：`apps/agent-runtime/resources/system-skills/` 新增四份 Skill（约 1.7MB 源文件）并移除三份旧 Skill；保留来源清单与最小 patch。`apps/agent-runtime/dist/dependencies/` 新增依赖树（约 1.45GB，已被 `dist/` 忽略，不入库）。
- 系统 Skill 名单：`agent-file-store.ts`、`skill-installer.ts`、`apps/desktop/src/main/index.ts` 与 macOS 打包校验脚本需要同步新增四个标识。
- 契约与兼容：新增一个模型可见工具名；既有 `python_run`、`node_run` 的解释器与语义不变，依赖解释器通过 `RUNTIME_PYTHON` 单独暴露。
- 不发布约束：依赖树包含 OpenAI 私有包与第三方二进制，未做许可评估，只能用于本机验证，不得进入发布流程。
