## Context

参见 `proposal.md` 的 Why 与 `specs/figma-ui-auditing/spec.md`。仓库已有运行时 DOM 交互审计和 Figma 组件核对表，但没有能够读取 Figma Plugin API 节点结构、验证设计源文件并区分确定性错误与视觉复核项的工具。普通 Node 进程不能直接使用 Plugin API，且 Figma REST 接口无法等价提供全部布局、实例和 reaction 信息。

## Goals / Non-Goals

**Goals:**

- 让 Figma 数据获取与确定性校验解耦，使规则能够用本地 fixture 红绿测试。
- 对布局、控件内容预算、状态和 reaction 生成可定位、可复跑的报告。
- 用项目配置表达语义、权威组件、动态标签和合理例外，降低启发式误报。
- 让 Skill 强制执行新鲜快照、脚本校验和截图复核三层证据。

**Non-Goals:**

- 不从 Node 脚本直接连接 Figma 或保存用户 Token。
- 不自动修改 Figma，也不在本变更中修复审计发现的设计问题。
- 不把图标语义、阴影美感和 Codex 风格等主观判断降格为简单数值规则。
- 不替换 Desktop 的运行时交互审计、组件测试或视觉回归。

## Decisions

### 1. 使用 Figma 快照与 Node 校验器的两阶段架构

Skill 通过 Figma Plugin API 按页面提取稳定 JSON，Node ESM 脚本仅消费快照与项目配置。快照包含层级、可见性、局部/绝对几何、Auto Layout、padding、sizing、min/max、文本截断、组件来源、状态与 reaction。

替代方案是 Node 直接调用 Figma REST API。它需要 Token，并且无法保证与 Plugin API 在实例、布局和 prototype 数据上等价。另一替代方案是只提供操作说明，不提供脚本；这无法建立确定性回归测试。用户最终裁决选择两阶段架构。

### 2. 以结果型规则替代属性黑名单

绝对定位和固定尺寸本身不作为 error。校验器只有在它们造成越界、覆盖、裁切、不可达，或与显式动态内容契约冲突时失败；其余高风险模式以 warning 呈现。合理覆盖层和稳定小尺寸元素通过精确角色或 node id 登记。

替代方案是禁止所有 absolute/fixed，首轮只读扫描已证明会把单选圆点、Tab 指示条、模态遮罩、菜单、Hotspot、浏览器目标高亮、侧栏和表格列大量误报。用户确认采用“结果型判定 + 合理例外”。

### 3. 控件规则使用内容预算和权威组件配置

按钮和下拉框按 `required width = visible inline content + gaps`、`available width = control width - horizontal padding` 计算。项目配置登记控件来源、动态标签槽、允许高度、padding/gap 范围、必要状态和尾部图标。固定宽度动态标签必须使用末尾省略与单行限制，静态 HUG 按钮不强制省略。

替代方案是全局规定统一 padding。首轮扫描中 Tab、菜单项、复合筛选栏和浮动控件使用不同内部结构，单一阈值产生明显误报，因此不采用。

### 4. Error、warning 与精确例外分离

几何事实、缺失字段、无效 reaction 目标和配置声明的缺失状态是 error；阈值型密度、潜在手工流式布局、交互数量下降和主观视觉风险是 warning。例外必须包含 `ruleId`、单一 `nodeId` 和非空理由；不接受通配符或整页忽略。

CLI 在无 error、存在 error、输入无效时分别返回 `0`、`1`、`2`。真实设计存在违规时，退出 `1` 是一次成功发现问题的审计，不应通过吞掉状态码伪装为通过。

### 5. Skill 与脚本共同验证，但不夸大 Skill 行为测试

脚本使用 `node:test` 覆盖所有规则与 CLI 状态；Skill 使用官方 quick validator 检查结构，并以真实 Figma 全面审计验证操作流程。当前用户未授权子代理，因此不声称完成独立 Agent 压力测试；该限制会在验证报告中明确记录。

## Risks / Trade-offs

- [快照提取仍依赖 Agent 正确执行 Figma Plugin API 程序] → Skill 固定提取契约，每页一次调用，并验证必要字段和页面范围。
- [启发式手工流式布局规则可能误报编辑器画布或复杂表格] → 默认 warning，优先使用配置角色，并要求截图确认后才转为问题或例外。
- [实例 ID 会随复制变化] → 配置优先匹配权威 source component identity 和状态属性；单一节点例外只用于稳定的页面节点。
- [过多例外会侵蚀校验价值] → 拒绝通配符、空理由和整页忽略，并在报告中完整列出例外。
- [真实全面审计可能以 error 结束] → 将工具实现通过与设计文件通过分开报告，后续设计修复另行执行。
- [用户覆盖] → 无。用户采纳了推荐的结果型规则与两阶段架构。

## Migration Plan

1. 先用失败 fixture 建立快照、布局、控件和交互规则。
2. 加入 ActionDriver 页面与组件配置，并暴露根级测试/校验命令。
3. 创建并验证项目 Skill。
4. 对六个页面提取新鲜快照，运行全面审计并提交报告。
5. 若需回滚，删除新增 Skill、配置和命令即可；现有产品与 E2E 流程不依赖这些文件。
