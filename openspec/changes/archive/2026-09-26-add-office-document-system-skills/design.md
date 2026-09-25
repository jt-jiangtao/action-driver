## Context

四份 Skill 的正文把 `load_workspace_dependencies`、`@oai/artifact-tool`、LibreOffice 与 Poppler 写成前置条件。约束来自本机探针的实测结论：

- Skill 自带脚本通过 `RUNTIME_NODE`、`RUNTIME_NODE_MODULES`、`RUNTIME_BIN_DIR`、`RUNTIME_PYTHON` 读取依赖；`presentations/container_tools/runtime_helpers.py|mjs` 在缺失时直接抛错。
- `documents/render_docx.py` 从 `sys.executable` 结构化推导依赖根：仅当解释器位于 `<deps>/python/bin` 且 `<deps>` 名为 `dependencies` 时才使用同级 `bin/override` 的 LibreOffice；否则退回 `PATH` 查找。
- 现有 `bundled-script-runtimes` 只承诺标准库与内建模块的离线执行，且四个脚本工具当前只注入 `PYTHONHOME`、`PYTHONNOUSERSITE` 与受限 `PATH`。
- 系统 Skill 标识在四处硬编码：`agent-file-store.ts` 的 `BUILT_IN_SKILLS`、`skill-installer.ts` 的 `SYSTEM_SKILL_IDS`、`apps/desktop/src/main/index.ts` 的系统路径判定、`scripts/test-packaged-macos.mjs` 的打包校验清单。

动机与范围见 `proposal.md`，行为契约见 `specs/`。

## Goals / Non-Goals

**Goals:**

- 让四份 Skill 以可追溯的上游快照为基线，仅修正与包内依赖规则冲突的指令，并保存独立 patch。
- 从应用包与旧用户系统 Skill 目录中移除三个无用 Skill。
- 让 docx、pptx、xlsx、pdf 四类文件能在本机真实产出，并能完成至少一条渲染或结构验证路径。
- 保持既有 `python_run`、`node_run`、`ts_run` 的语义与离线承诺不变。

**Non-Goals:**

- 不做许可评估，不把依赖树纳入发布流程。
- 不覆盖 `excel-live-control`（依赖 Excel 桌面版与 ChatGPT add-in 宿主能力）。
- 不为 darwin-x64 提供文档依赖；不联网下载依赖。
- 不为文档依赖引入新的脚本文件系统隔离机制；现有脚本工具的通用文件访问边界不在本变更中重设计。

## Decisions

### 依赖来源：按原布局复制本机 Codex 运行时依赖树

从 `~/.cache/codex-runtimes/codex-primary-runtime/dependencies` 复制 `bin`、`native`、`node`、`python` 到应用包内固定目录，保留目录结构。这样 `render_docx.py` 的结构化推导与 `RUNTIME_*` 契约都按上游预期工作。

替代方案是构建期用 pip/npm 从公开源重装一套 cp313 依赖。不采用，原因有二：`@oai/artifact-tool` 与 `artifact_tool_v2` 是私有包，公开源没有；按原布局复制才能让脚本的路径推导无需改写，而重装会改变解释器版本并需要逐脚本处理版本差异。

### 依赖版本以 Codex 运行时缓存为唯一基准

依赖树内的解释器与各组件版本按来源原样保留，不重装、不升级、不降级、不按包内解释器重新解析第三方库。基准版本为：Python 3.12.14、Node.js v24.19.0、`@oai/artifact-tool` 2.8.59、LibreOffice headless 与 Poppler 随附版本。若某个三方库与包内 Python 3.13 或既有依赖存在版本分歧，以 Codex 侧版本为准，通过 `RUNTIME_PYTHON` 使用随包依赖解释器，而不是修改任一版本。

替代方案是让依赖版本与包内解释器对齐（例如为 3.13 重装 wheel）。不采用：`@oai/artifact-tool` 与 `artifact_tool_v2` 只在 Codex 侧版本可用，对齐会破坏私有包可用性，并使 Skill 自带脚本的实测通过结果失效。

该基准同时固定了验证结论的适用范围：本机探针的全部通过项都是在上述版本组合下取得的，更换任一版本都需要重新验证。

### 依赖树位置：应用包 `dist/` 内，不入库

依赖树约 1.45GB，放在 `apps/agent-runtime/dist/dependencies/`。仓库 `.gitignore` 已忽略 `dist/`，因此不产生入库体积；同时它仍在应用包内，满足规格中"包内绝对路径"的要求。

### 上游快照加最小 patch：新增依赖解析工具 + 注入 `RUNTIME_*`

注册只读 `load_workspace_dependencies` 返回四个绝对路径，并在四个脚本工具的进程环境中注入同名变量与扩展后的 `PATH`。工具满足正文的显式调用指令，环境变量保证即使模型不读工具输出、脚本也能解析依赖。

上游快照的文件清单与哈希保留，改动只针对指向用户环境的回退指令。独立 patch 记录精确差异，验证时先按来源清单重建基线再应用 patch，对比随包文件。替代方案是对四个脚本工具增加 macOS 文件隔离，以保持上游正文逐字不变；该方案会扩大运行边界、增加兼容风险，且本机可用的 `sandbox-exec` 已标为 deprecated。用户最终选择最小 patch。

### 退役三个旧系统 Skill

停止播种和打包 `browser-tools`、`computer-tools`、`report-writer`，同时在初始化时只删除 `.system` 下三个对应目录，防止升级后旧副本继续显示。个人 Skill 与 `*-legacy` 备份不属于删除范围。替代方案是只从列表隐藏并保留旧目录；可逆性更高，但会留下用户认为无用的安装副本。用户明确选择永久删除已安装的系统副本。

### Python 采用双轨

`python_run` 继续使用包内 3.13 标准库解释器；文档 Skill 通过 `RUNTIME_PYTHON` 使用依赖树内的 3.12 解释器及其三方库。两者版本不一致是刻意保留的状态：按上文基准，依赖侧版本不向包内解释器对齐。

替代方案是把 `python_run` 直接切到依赖解释器。不采用：会改变既有工具语义、推翻 `bundled-script-runtimes` 的解释器承诺，并把"通用脚本工具"与"文档验证专用依赖"耦合在一起。

### 暂存为构建期脚本，缺失即明确失败

新增暂存脚本从本机缓存复制依赖，缓存不存在时返回可理解的错误。替代方案是联网下载依赖归档并校验，但私有包无公开来源，因此不采用。

### 最终裁决

Agent 推荐先做"复制 + 适配层"并把补齐依赖推迟；用户覆盖该建议，裁决采用完整补齐，理由是本次仅做本机验证、不发布。该覆盖项与代价记录于 Risks。

新版上游暴露回退指令后，用户改为裁决“上游快照 + 记录 patch”，覆盖此前“完全逐字复制”的要求；同时裁决永久删除三个退役系统 Skill 的旧安装副本。

## Risks / Trade-offs

- [不可发布] 依赖树含 OpenAI 私有包与第三方原生二进制，未做许可与再分发评估 → 缓解：只存在于被忽略的 `dist/dependencies/`，不进入打包发布脚本与 CI；proposal 与 tasks 明确标注"仅本机验证"。用户理解并接受该代价。
- [体积] 应用包内新增约 1.45GB → 缓解：不入库、不进入发布产物；验证完成后可直接删除该目录回滚。
- [架构与来源限制] 依赖仅 darwin-arm64 且依赖本机 Codex 缓存存在 → 缓解：暂存脚本在缓存缺失时返回结构化错误；x64 不支持，文档 Skill 在该架构下按"依赖缺失"路径处理。
- [解释器版本双轨] 3.12 与 3.13 并存可能造成脚本误用解释器 → 缓解：文档依赖解释器只通过 `RUNTIME_PYTHON` 暴露，`python_run` 语义不变；Skill 正文原本就要求使用随包解释器。
- [系统 Skill 名单分散] 四处硬编码需要同步，遗漏会导致列表显示或打包校验不一致 → 缓解：tasks 逐处列出并要求相关测试覆盖。
- [验证覆盖不足] 本机探针只验证了 authoring、导出、原生预览、docx 渲染与 PDF 读取，未覆盖 presentations 的完整 finalization 门禁 → 缓解：作为显式验证任务列出，未通过的部分不得声称通过。
- [上游正文与实际能力偏差] 正文含 Google Docs/Slides 与 Excel add-in 的交付路径，本项目无对应宿主 → 缓解：不视为缺陷，Agent 在缺少宿主时按 Skill 的失败说明处理；不为其新增工具。
- [旧内容删除] 升级时删除三个 `.system` 目录可能丢失用户在磁盘上直接修改的副本；用户明确接受该不可逆影响。个人目录与 `*-legacy` 备份不删除。
- [上游偏差] 最小 patch 会使两份随包 Skill 不再与上游逐字相同 → 缓解：保存上游哈希清单和 patch，验证唯一差异来自 patch；上游更新时重新比对。

## Migration Plan

无数据库迁移。新四份 Skill 仍使用非覆盖播种。升级时删除三个退役系统 Skill 的 `.system` 目录；这是用户裁决的内容删除，回滚代码不会恢复旧目录中的本地改动。其余回滚方式为删除 `apps/agent-runtime/dist/dependencies/`、新四份随包 Skill 目录与对应系统 Skill 名单条目。

## Open Questions

- presentations 的 finalization 门禁是否还需要依赖树中未纳入验证的额外组件；该问题只影响验证深度，不改变规格、方案或任务划分，可在实施验证阶段回答。
