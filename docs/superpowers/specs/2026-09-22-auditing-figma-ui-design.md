# Figma UI 结构审计 Skill 与校验脚本设计

## 目标

把 ActionDriver Figma 设计中已经反复出现的布局、状态和图标错误转化为可重复执行的验收流程。后续修改页面或组件后，Agent 必须先取得真实 Figma 节点快照，再运行确定性校验，并对无法可靠自动判断的视觉语义执行截图复核。

成功标准：已知坏例能够稳定失败，修复后的快照能够稳定通过；报告必须定位到 page、node id、规则和测量值；脚本不得把主观视觉判断伪装成自动通过。

## 范围与边界

首版覆盖：

- 可见文字超出父容器、被裁切或出现异常负坐标。
- Component Set 内变体重叠、Section 重叠和页面关键区域重叠。
- 模态框未在目标内容区居中、内部垂直留白过大、页脚与正文间距异常。
- 使用 `›`、`‹`、`⌄`、`⌃`、`×`、`…`、`✓`、`→` 等文本字符冒充图标。
- 同类按钮或控件缺少要求的 normal、hover、active/pressed、selected、disabled、loading、error 状态。
- 可交互节点没有 reaction、reaction 目标不存在，或既有状态修改后交互数量意外减少。
- 同一状态组中按钮显隐、对齐、尺寸或位置产生异常漂移。
- 有明确横向或纵向内容流的容器仍依赖逐项 `x`/`y` 坐标，且缺少合理的 Auto Layout 约束。
- 固定宽高用于动态文本或可变列表时没有 `HUG`、`FILL`、min/max、截断、换行或滚动策略。
- 按钮、下拉框和筛选控件的 padding、图标间距或固定尺寸挤压内容，或者制造与内容不相称的大面积空白。
- 固定宽度的动态选项、模型名、连接名和筛选值缺少单行末尾省略策略。

首版不自动裁决图标是否具有正确业务语义、阴影是否美观、整体层级是否符合 Codex 风格，也不以像素相似度代替设计判断。这些项目由 Skill 要求截图复核并记录结论。

## 技术设计

### 两阶段管线

仓库新增项目级 Skill：

```text
.agents/skills/auditing-figma-ui/
├── SKILL.md
├── references/audit-rules.md
└── scripts/
    ├── validate-figma-snapshot.mjs
    └── validate-figma-snapshot.test.mjs
```

Figma 插件 API 是设计结构的事实来源。Skill 提供固定的 `use_figma` 提取程序，遍历指定 Page 或 Frame，输出标准化 JSON；普通 Node 脚本只消费该 JSON，不直接持有 Figma Token，也不假设 REST API 能完整暴露插件属性和 prototype reaction。

校验脚本接收一个或多个快照路径，输出人类可读报告，并支持 JSON 报告供自动化消费。退出码为 `0` 表示没有 error，`1` 表示存在 error，`2` 表示输入或配置无效。warning 不单独阻止通过，但必须出现在报告中。

### 快照契约

快照顶层至少包含：

- `schemaVersion`、`fileKey`、`capturedAt`。
- 被扫描页面的 `id`、`name`、尺寸和扫描范围。
- 每个节点的 id、name、type、visible、absolute/local bounds、clip、layout、effects、text、component/variant 信息。
- Auto Layout 的方向、padding、item spacing、`layoutPositioning`、`layoutSizing*`、min/max 和文本截断属性。
- 可交互节点的 reaction 数量、trigger、action 和目标 node id。
- 审计配置：允许的文本图标、状态组要求、内容区边界、已批准例外及理由。

节点顺序必须稳定，时间戳以外的相同设计应生成可比较的结果。例外必须以规则 ID 和 node id 精确匹配，禁止使用页面级全局忽略。

## 规则分级

确定性结构规则作为 error：

- `TEXT_OUT_OF_BOUNDS`：可见文字越过可裁切父级边界。
- `TEXT_GLYPH_ICON`：命中未获允许的文本伪图标。
- `VARIANT_OVERLAP`、`SECTION_OVERLAP`：同级变体或区块相交。
- `REACTION_TARGET_MISSING`：交互目标不存在。
- `REQUIRED_STATE_MISSING`：配置声明的状态组缺少要求状态。
- `MODAL_OUTSIDE_CONTENT`：模态框越出目标内容区。
- `CONTROL_CONTENT_OVERFLOW`：按钮或下拉框的文字、图标、间距与 padding 总和超过内部可用宽度。
- `CONTROL_LABEL_NO_ELLIPSIS`：固定宽度且内容可变的下拉框、筛选器或模型选择项没有 `textTruncation=ENDING` 和单行约束。
- `CONTROL_PADDING_BREAKS_CONTENT`：左右 padding 直接导致标签或尾部图标被裁切、覆盖或挤出。

需要阈值或上下文的规则默认作为 warning：

- `MODAL_NOT_CENTERED`：中心与目标内容区中心偏差超过容差。
- `EXCESSIVE_VERTICAL_WHITESPACE`：阴影表面上下空白超过阈值。
- `STATE_GEOMETRY_DRIFT`：状态间尺寸或关键控件锚点异常漂移。
- `REACTION_COUNT_REGRESSION`：与显式基线相比交互数量下降。
- `POSSIBLE_ICON_DUPLICATION`：同一小区域存在多个可见图标节点。
- `MANUAL_FLOW_LAYOUT`：三个以上存在顺序关系的同级子项仍使用手工坐标布局。
- `FIXED_DYNAMIC_CONTAINER`：承载动态文字或列表的容器固定宽高但没有伸缩、边界或溢出策略。
- `CONTROL_PADDING_OUTLIER`：按钮、菜单项或下拉框 padding 偏离已登记组件规格，但尚未产生实际裁切。
- `CONTROL_GEOMETRY_DRIFT`：同一控件的 normal、hover、active/pressed、selected、disabled、loading 或 error 状态中，尺寸、padding、文字锚点或尾部图标位置异常变化。

阈值必须在配置中显式记录，报告输出实际值和阈值。脚本不根据节点名称猜测产品语义。按钮和下拉框优先与登记的权威组件及其状态变体比较；只有没有权威组件时才使用项目密度配置。小图标、状态点、分隔线、标准控件高度、设计画板、固定侧栏、表格列、模态遮罩、菜单、抽屉、Tooltip、原型 Hotspot 和目标高亮属于可登记的合理固定或覆盖场景。

### 控件内容预算

按钮和下拉框按同一个可解释公式审计：

```text
required width = leading icon + label + trailing icon + gaps
available width = control width - padding left - padding right
```

`required width > available width` 是确定性错误。固定宽度的动态标签还必须保留尾部图标空间，并使用单行末尾省略。`HUG` 的静态动作按钮可随标签扩展，不强制省略；图标按钮必须保持正方形并以稳定小尺寸呈现。

padding 不使用全局单一数值。Skill 配置每个控件族的权威组件、允许高度、横向 padding 和图标间距，并验证各交互状态保持一致。仅当 padding 偏差导致实际内容失败时作为 error；尚未破版的偏差作为 warning，交由截图复核。

## Skill 工作流

Skill 在用户要求检查、修改或验收 Figma 页面、组件、模态框、按钮状态、图标、间距、对齐或交互覆盖时触发。

执行顺序：

1. 确认文件、页面、状态范围和已批准例外。
2. 通过 Figma 插件 API 生成快照；禁止用旧快照证明当前设计通过。
3. 运行校验脚本，先处理 error，再审查 warning。
4. 修改后重新提取，确保原问题由失败变为通过且 reaction 未回退。
5. 对模态框、复杂状态页和 warning 涉及节点生成截图，人工确认图标语义、阴影、层级和整体密度。
6. 报告自动通过项、人工确认项、保留例外和未完成范围。

## 测试策略

遵循红绿测试：实现脚本前先建立最小坏快照，确认测试因“校验器尚不存在或规则未实现”失败。fixture 至少覆盖：

- 文本越界、负坐标和隐藏文字不误报。
- 变体/Section 真重叠与边缘相接不误报。
- 模态框居中、偏移、正文与页脚大留白。
- 文本伪图标命中和允许列表。
- Auto Layout 内合理覆盖层与不合理绝对子项；手工坐标流式容器与合法画板布局。
- 按钮/下拉框内容预算刚好适配、被 padding 挤压、padding 过大和尾部图标空间不足。
- 动态长文本单行省略、静态 `HUG` 按钮不省略，以及多状态几何漂移。
- 状态缺失、reaction 目标缺失与数量回退。
- 精确 node 例外生效，过宽例外被拒绝。
- 通过快照输出 exit `0`，错误快照输出 exit `1`，坏输入输出 exit `2`。

除脚本单测外，至少用本轮修复后的 ActionDriver 页面快照运行一次真实审计，并对代表性模态框、日志详情和状态页进行截图复核。

## Battle 结论

- 类型：架构决策。
- 目标：把高频 Figma 布局、状态、图标和交互错误变成可复用校验能力。
- 当前方案：仓库内 Skill、Figma 插件快照和 Node 校验脚本组成两阶段管线。
- 主要质疑：普通 Node 脚本无法直接使用 Figma 插件 API；纯自动规则无法可靠判断图标语义和整体美感。
- 替代方案：使用 Figma REST Token 的直接校验脚本；仅提供 Skill 和操作片段。
- 最终决策：用户明确确认采用两阶段方案 A，并追加确认使用“结果型判定 + 合理例外”；拒绝以手工坐标掩盖流式布局问题，拒绝固定尺寸挤压动态内容，按钮和下拉框必须校验 padding、内容预算、长文本省略和状态几何一致性。Skill 存放在 `.agents/skills/auditing-figma-ui/`。
- 主要权衡：增加一次快照提取步骤，换取无 Token、可测试、可版本控制且不夸大自动化能力的校验流程。
- 用户覆盖：无。
- 重新开启条件：Figma 提供可从仓库安全调用、且能完整读取插件属性与 reactions 的稳定接口，或首版规则出现不可接受的误报率。

## 非目标

- 不修改现有产品页面或运行时 E2E 审计。
- 不自动修复 Figma 节点。
- 不保存用户 Figma Token。
- 不以单一全页截图像素差替代结构和交互审计。
