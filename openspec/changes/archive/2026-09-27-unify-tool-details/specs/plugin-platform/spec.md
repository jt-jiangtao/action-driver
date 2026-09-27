## ADDED Requirements

### Requirement: Plugin owned semantic tool presentation
插件工具 SHALL 可通过公共 npm API 声明输入输出的语义标签、字段路径与文本、代码、链接或图片类型，catalog SHALL 独立暴露这些声明。内置工具与脚手架 SHALL 提供声明。展示声明 SHALL 不改变模型 schema、执行结果、授权或原始日志。

#### Scenario: External tool with presentation fields
- **WHEN** 外部插件声明输入目标与输出状态字段并通过校验
- **THEN** 统一宿主与界面显示对应语义字段，无需新增插件专用 UI

#### Scenario: Legacy plugin without presentation
- **WHEN** 已有插件没有展示声明
- **THEN** 工具保持可执行，详情显示有效摘要且不整块显示原 JSON
