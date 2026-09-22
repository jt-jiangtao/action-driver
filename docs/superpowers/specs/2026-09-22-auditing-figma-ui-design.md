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

需要阈值或上下文的规则默认作为 warning：

- `MODAL_NOT_CENTERED`：中心与目标内容区中心偏差超过容差。
- `EXCESSIVE_VERTICAL_WHITESPACE`：阴影表面上下空白超过阈值。
- `STATE_GEOMETRY_DRIFT`：状态间尺寸或关键控件锚点异常漂移。
- `REACTION_COUNT_REGRESSION`：与显式基线相比交互数量下降。
- `POSSIBLE_ICON_DUPLICATION`：同一小区域存在多个可见图标节点。

阈值必须在配置中显式记录，报告输出实际值和阈值。脚本不根据节点名称猜测产品语义。

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
- 最终决策：用户明确确认采用两阶段方案 A，并将 Skill 存放在 `.agents/skills/auditing-figma-ui/`。
- 主要权衡：增加一次快照提取步骤，换取无 Token、可测试、可版本控制且不夸大自动化能力的校验流程。
- 用户覆盖：无。
- 重新开启条件：Figma 提供可从仓库安全调用、且能完整读取插件属性与 reactions 的稳定接口，或首版规则出现不可接受的误报率。

## 非目标

- 不修改现有产品页面或运行时 E2E 审计。
- 不自动修复 Figma 节点。
- 不保存用户 Figma Token。
- 不以单一全页截图像素差替代结构和交互审计。
