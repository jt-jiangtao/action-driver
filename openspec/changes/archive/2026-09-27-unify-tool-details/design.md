## Context

ToolGroup 内已有命令、网页、图片与 CUA 特例，但未知工具使用 essentialJson；ReadOnlyCode 360px、网页 240px、pre 480px、外层组 420px 的限制叠加。工具事件与快照携带原始 I/O，但没有插件语义声明。

## Goals / Non-Goals

统一组件、插件字段所有权、640px 高度、实时与历史语义。保留原日志、脱敏策略、执行结果与授权；不增加插件脚本渲染、HTML 或任意 URL 执行。

## Decisions

Battle 已完成。用户明确确认“插件声明语义字段、界面统一渲染、不整块显示 JSON、最大高度统一 640px”，并要求统一组件。已比较在 Desktop 逐工具硬编码与插件声明方案；前者改动少但新插件继续要求界面代码，后者通过可序列化字段契约支持第三方及本地/云端，采用后者。无实质性异议，关键风险为未知插件只能显示摘要，用户未覆盖推荐。

公共 ToolDefinition 增加可选 presentation {input,output}，字段为 {label,path,kind,language?,hideFalse?}，kind 为 text/code/link/image，path 支持点号与数组通配符。公共 helper 投影为 details {input,output,truncated?}，字段 {label,kind,value,language?,asset?}，value 只允许字符串；图片只携带已校验 asset 引用。对象不 stringify，缺失/空字段跳过，0/false 保留；展示有总长度与字段数上限。

Runtime 把执行时 presentation 快照保存于原有事件 metadata，以脱敏后的输入/输出投影 details，rawToolIO 禁用时不扩大数据曝光。快照优先使用原事件声明，历史内置调用可使用同包公共 presentation 导出。流式输出保持已有通道聚合，用标记字段更新输出而非覆盖已有输入。

Desktop 统一 ToolDetails 接收字段、错误、摘要与图片读取接口，共享 640px 容器。ReadOnlyCode 在工具详情内自然按行高展开，父容器统一滚动，避免嵌套更小滚动区。工具组也设置 640px 最大高度及滚动；滚动区域四边按溢出方向显示渐变。输入/输出不显示可见标题，只保留语义字段和位置；退出码通过可选 placement: footer 标记固定于右下角。移除 ToolGroup JSON/工具专用分支，历史没有 details 的内置记录从同包公共 presentation 提取；未知工具仅显示摘要。

## Risks / Trade-offs

- 未声明字段没有原 JSON 兜底 → 摘要仍可见，原始日志保持；脚手架与内置覆盖。
- 迟到/升级重启改变字段解释 → 执行时事件保存声明，旧数据仅用兼容声明。
- 跨层新增数据可能绕过脱敏 → 只从原持久化脱敏数据投影，并沿用 rawToolIO 开关。
- 链接与图片内容不可信 → 仅 http(s) 无凭据链接、校验 asset 引用，React 文本渲染。
- 更大高度占屏 → 最大值不是最小值，短内容自然高度；遵循本次 640px 裁决。

用户继续裁决：命令使用统一组件的 terminal 布局，收起在状态后显示命令预览并超长省略；展开标题不含命令，正文按终端排列源代码和输出。错误固定左下角，退出码固定右下角；公共布局提示与 footer placement 可选，原执行接口不变。

Ruling：footer 仅允许输出侧 text 状态字段，避免链接/图片失去类型语义；terminal 布局保留富链接与图片，脚本参数也保留。

- 后续执行裁决：用户最新裁决覆盖取整方案：命令显示实际耗时，不足一秒用 ms，达到一秒用 s，四舍五入且最多一位小数（去掉末尾 .0）；毫秒值四舍五入且至少显示 1ms，收起与展开一致；错误位于左下角，退出码位于右下角。
