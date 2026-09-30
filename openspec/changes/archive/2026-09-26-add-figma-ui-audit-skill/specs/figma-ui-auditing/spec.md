## Purpose

定义对 Action-Driver Figma 源文件执行可重复结构审计的行为契约，使布局、动态内容、控件状态与交互问题能够被确定性脚本定位，同时保留对主观视觉质量的截图复核边界。

## ADDED Requirements

### Requirement: 使用新鲜且可追踪的 Figma 快照
审计流程 SHALL 从指定 Figma 文件和页面提取当前节点结构，并 MUST 记录文件、页面、节点、几何、布局、文本、组件状态与 prototype reaction 信息；历史快照 MUST NOT 被用于证明当前设计通过。

#### Scenario: 修改设计后重新审计
- **WHEN** Agent 修改了任一被审计页面或组件
- **THEN** 审计流程重新提取受影响范围的快照后再运行校验，并在报告中标识文件与页面范围

#### Scenario: 快照缺少必要字段
- **WHEN** 输入快照缺少版本、页面、节点或审计配置中的必要信息
- **THEN** 校验以输入错误结束，输出缺失字段且不得把该范围标记为通过

### Requirement: 区分确定性错误与视觉复核项
校验器 SHALL 将可确定的结构违规报告为 error，将依赖阈值或视觉语义判断的风险报告为 warning，并 SHALL 输出规则、page id、node id、实际测量值和阈值。无 error、存在 error、输入无效 MUST 分别产生不同退出状态。

#### Scenario: 文字越出裁切父级
- **WHEN** 可见文字越过可裁切父容器边界且没有精确例外
- **THEN** 校验输出 `TEXT_OUT_OF_BOUNDS` error，并给出各方向的越界量

#### Scenario: 主观视觉风险
- **WHEN** 节点可能存在图标语义、阴影、密度或层级问题但无法由几何事实确定
- **THEN** 校验输出 warning 并要求截图复核，不得自动宣告视觉通过

### Requirement: 按布局结果审计定位与固定尺寸
审计流程 SHALL 优先接受 Auto Layout、HUG、FILL、min/max、截断、换行或滚动等可适应内容的约束，并 MUST 报告手工坐标或固定尺寸造成的实际越界、覆盖、裁切或操作不可达。必要的小图标、状态点、画板、侧栏、表格列、遮罩、菜单、抽屉、Tooltip、Hotspot 与目标高亮 MAY 通过精确角色或 node 例外保留。

#### Scenario: 手工坐标掩盖内容流
- **WHEN** 三个以上存在明确顺序关系的同级内容依赖手工坐标，且内容变化会导致错位或覆盖
- **THEN** 校验报告 `MANUAL_FLOW_LAYOUT`，并指出应由布局约束表达的父节点与子节点

#### Scenario: 合理覆盖层
- **WHEN** 绝对定位节点被显式登记为菜单、遮罩、Hotspot 或目标高亮且未越出允许区域
- **THEN** 校验不把定位方式本身视为违规

### Requirement: 验证按钮与下拉框的内容预算
校验器 MUST 计算按钮、下拉框、筛选器和模型选择项的文字、前后图标、间距、左右 padding 与可用宽度，并 MUST 在所需宽度超过可用宽度时报告 error。动态固定宽度标签 SHALL 使用单行末尾省略并保留尾部图标空间；静态 HUG 动作按钮 MAY 随内容扩展而不省略。

#### Scenario: Padding 挤压按钮文字
- **WHEN** 控件的文字、图标和间距本可容纳，但左右 padding 使所需宽度超过内部可用宽度
- **THEN** 校验输出 `CONTROL_PADDING_BREAKS_CONTENT` 或 `CONTROL_CONTENT_OVERFLOW` error，并给出 required width 与 available width

#### Scenario: 动态选项过长
- **WHEN** 固定宽度下拉框或模型选择项承载超长动态标签
- **THEN** 标签保持单行末尾省略，尾部 Chevron 或状态图标仍完整可见且不改变控件高度

#### Scenario: 控件状态尺寸漂移
- **WHEN** 同一控件的 hover、active/pressed、selected、disabled、loading 或 error 状态改变了未获允许的 padding、尺寸或标签锚点
- **THEN** 校验输出 `CONTROL_GEOMETRY_DRIFT`，并列出发生差异的状态与测量值

### Requirement: 验证状态与交互闭合
审计流程 SHALL 验证配置声明的组件状态完整存在、reaction 目标可解析且交互数量没有低于显式基线。纯视觉状态 MUST 明确登记，不得通过删除 reaction 或省略状态来获得通过结果。

#### Scenario: 状态变体缺失
- **WHEN** 权威组件缺少配置要求的 normal、hover、active/pressed、selected、disabled、loading 或 error 状态
- **THEN** 校验输出 `REQUIRED_STATE_MISSING` error 并列出缺失状态

#### Scenario: 交互目标丢失
- **WHEN** 节点 reaction 指向不存在的目标或页面交互数量低于已登记基线
- **THEN** 校验输出目标缺失 error 或数量回退 warning，且报告受影响节点

### Requirement: Skill 执行全面审计并诚实报告范围
项目 SHALL 提供可发现的 Figma UI 审计 Skill。Skill MUST 提取新鲜快照、运行脚本、处理 error、逐项复核 warning，并在最终报告中分别列出自动通过项、确认问题、批准例外、截图复核结果和未扫描范围。

#### Scenario: 全面检查 Action-Driver 设计
- **WHEN** 用户要求全面检查当前 Action-Driver Figma 文件
- **THEN** Skill 覆盖 Components、Home、Task、Model Configuration、Agent Configuration 与 Logs 页面，并按 page 与 node id 输出去重后的结果

#### Scenario: 当前设计仍有错误
- **WHEN** 全面检查发现尚未修复的 error
- **THEN** Skill 报告校验脚本和 Skill 自身已成功运行，但 MUST NOT 声称 Figma 设计已经通过或完成

