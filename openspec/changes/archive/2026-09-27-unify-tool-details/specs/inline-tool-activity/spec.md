## ADDED Requirements

### Requirement: Unified semantic tool details
所有工具详情 SHALL 使用统一组件呈现带名称的输入、输出和错误字段，MUST NOT 用整块 JSON 作为默认或兜底展示。对象与列表 SHALL 提取已声明字段，代码、有效链接与图片 SHALL 按类型呈现。输入与输出 SHALL 只按位置区分，不显示可见分区标题；退出码 SHALL 固定在右下角，错误 SHALL 固定在左下角。命令类工具收起时 SHALL 在状态后呈现单行命令预览，超长省略；展开标题 MUST NOT 重复命令，正文 SHALL 呈现终端式源代码与输出。命令耗时 SHALL 按毫秒四舍五入且至少显示 1ms；不足一秒 SHALL 使用 ms，达到一秒 SHALL 使用 s，四舍五入后最多一位小数且去掉末尾 .0。空内容 SHALL 不占无意义空间，数值零与有效 false SHALL 不丢失。历史数据 SHALL 沿用可用语义声明及摘要，原始日志不改写。

#### Scenario: Expand search and command details
- **WHEN** 用户展开搜索或命令工具
- **THEN** 分别可见查询与结果字段、脚本与输出及退出码，不显示 transport 对象

#### Scenario: Rounded execution duration
- **WHEN** 命令实际耗时分别为 0ms、40.5ms、1234ms 或 1250ms
- **THEN** 收起与展开状态分别显示 1ms、41ms、1.2s 或 1.3s，不显示 0ms 或中文秒单位

#### Scenario: Restore historical details
- **WHEN** 重新打开旧调用或新版调用
- **THEN** 输入输出保留有意义的展示，未声明或无效数据不回退到整块 JSON

### Requirement: Shared tool detail height
所有工具详情 SHALL 共享 640px 最大高度；短内容 SHALL 自然撑开，长内容 SHALL 内部滚动。任务组 SHALL 同样具有 640px 最大高度与内部滚动。代码、文本、网页、图片区域 MUST NOT 另设更小的固定高度造成二次裁切；滚动区域上下左右 SHALL 按溢出方向显示渐变，多个方向渐变 SHALL 同时有效。

#### Scenario: Long details of different tool types
- **WHEN** 用户展开长脚本、网页、搜索、Skill 或图片工具详情
- **THEN** 各详情具有相同 640px 上限与可滚动内容，短内容不强制撑满
