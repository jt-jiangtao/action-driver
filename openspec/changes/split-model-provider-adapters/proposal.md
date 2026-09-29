## Why

当前提供商适配器文件交织 OpenAI 兼容、Anthropic 和共享失败处理，使协议特有变更易影响另一提供商的行为。按协议拆分可让错误分类和密钥脱敏的共同规则更清晰。

## What Changes

- 将两个提供商的适配实现移入独立模块。
- 抽取共享传输失败映射、响应分类和敏感信息脱敏工具。
- 保留原有工厂、导出类型、超时与失败码；沿用现有 OpenAI SDK 和 HttpTransport，不新增 SDK。

Battle 已完成，用户明确接受该方向。仅拆文件、不共享错误规则是已比较的可行替代；它会继续留下重复或分叉的安全语义。无未裁决关键分歧。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

无。模型连接与完成结果的对外需求不变；`.openspec.yaml` 使用 `skip_specs: true`。

## Impact

涉及 `model-connections/provider-adapters.ts`、相邻内部模块及适配器定向测试。模型协议与连接存储不变。
