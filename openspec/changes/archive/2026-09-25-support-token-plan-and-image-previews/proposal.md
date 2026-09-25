## Why

用户请求生图时，应用在没有默认生图模型的情况下把工具从模型请求中隐藏，模型因而误称应用没有生图能力。现有生图适配器只调用 Images API 兼容端点，而用户已配置的 Wan 模型使用 Token Plan 官方多模态生成端点；此外，宽幅图片在输入预览中被裁切，发送后的白底图片不易辨认。

## What Changes

- 为每个模型增加显式生图接口选择：Images API 或 Token Plan；保留手动能力开关和唯一默认生图模型。
- 接入 Token Plan 同步文字生图，沿用现有 `image_generate` 工具、最多四张并行、会话图片存储及对话展示。
- 未配置默认生图模型时，向聊天模型提供准确的配置状态和设置指引，避免“没有生图工具”的误导性回复。
- 改善输入框附件预览和用户消息图片缩略图，使宽幅白底图片完整可辨，并保留放大和失败占位。
- 不自动启用模型、不自动产生生图请求，也不改变聊天连接协议。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `model-connections-settings`：模型行选择生图接口并持久化，旧配置兼容；默认模型仍由用户指定。
- `conversation-images`：Token Plan 生图及未配置反馈，图片预览和用户消息的完整显示。

## Impact

涉及模型连接 DTO 与 SQLite 迁移、Runtime 生图适配与模型上下文、设置页模型行、输入框预览及对话图片样式。`image_generate` 工具 schema、聊天模型协议、会话图片资产引用保持现有契约。Battle 已完成：用户裁决采用显式逐模型接口选择；没有未裁决的关键分歧。书面设计见 `docs/superpowers/specs/2026-09-25-token-plan-image-generation-design.md`。
