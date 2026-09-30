## Why

现有生图测试和生成调用按连接域名预选接口，无法证明具体模型能使用该接口。对已配置 Token Plan 连接中的 `wan2.7-image`、`wan2.7-image-pro`、`qwen-image-3.0-pro`，此前实测兼容 Images API 返回 HTTP 400（`invalid_parameter_error` / `url error`），而 Token Plan 多模态生成接口返回 HTTP 200 和图片地址；因此需要把每个模型的真实验证结果作为运行依据。

本变更是接口路由与已验证状态边界的决策型变更。Battle 已完成：用户明确裁决采用逐接口探测、逐模型保存成功接口、生成时只用已验证接口的方向，并已知重复真实生图测试可能消耗 Token Plan 额度；当前没有未裁决的关键分歧。

## What Changes

- 用户显式测试上述三个 Token Plan 生图模型时，逐一真实测试适用的候选生图接口，并分别保存成功或失败及失败诊断；“刷新并测试”复用同一模型测试路径。
- 每个模型只以成功验证的接口获得生图可用资格；实际生成读取该模型保存的成功接口，不按域名临时推断，也不把失败接口作为运行回退。
- 旧记录中的生图成功状态和接口选择若缺少逐接口验证证据，需要重测后才允许这些 Token Plan 模型生图；其余连接的通用 Images API 行为保持原有范围。
- 不增加模型，不接入语音或视频接口，不把测试图片加入会话。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `model-connections-settings`：将指定 Token Plan 模型的生图测试与可用资格改为按模型、按接口保存真实验证结果。
- `conversation-images`：默认生图模型实际生成时只使用其已验证成功的接口。

## Impact

涉及模型连接的测试服务、能力结果和本地持久化、Token Plan 与通用 Images API 适配器选择，以及设置页状态映射。现有模型连接和默认模型引用需保留，但旧生图成功状态不得自动升级为逐接口成功。不会引入新依赖或新的外部接口类型。
