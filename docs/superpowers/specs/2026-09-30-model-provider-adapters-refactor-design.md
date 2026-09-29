## Context

`provider-adapters.ts` 同时包含两个协议实现、OpenAI SDK 错误映射、通用 HTTP 失败分类及凭据脱敏；测试从公共导出调用工厂与适配器。参见 proposal.md。

## Goals / Non-Goals

**Goals:** 协议特有实现与共享失败/脱敏规则分离；公共导出与行为保持稳定。

**Non-Goals:** 不新增 SDK、协议、模型能力或错误码，不改凭据存储位置。

## Decisions

1. **公共 façade。** `provider-adapters.ts` 保留类型、常量、`createModelProviderAdapter`、`createOpenAiCompatibleAdapter`、`createAnthropicAdapter` 和需要兼容的 `classifyResponse` 导出，通过内部模块转发。调用方不需迁移。
2. **协议模块。** OpenAI 兼容模块独占 SDK 流式响应、tool call 聚合及图像输入转换；Anthropic 模块独占其请求体、探测与解析。共享模块处理 HTTP 传输失败、响应分类、重试性和密钥脱敏。SDK 异常分类可留在 OpenAI 模块，但最终使用同一个脱敏出口。
3. **替代方案。** 仅把两个适配器复制到独立文件、各自保留错误处理也可缩短主文件，但会使失败码和凭据脱敏规则分叉。用户裁决采用共享失败规则的拆分。

## Risks / Trade-offs

- [循环 import 或类型导出变化] → 公共类型单向依赖，保持 façade 导出并运行 TypeScript 检查。
- [SDK 错误映射或敏感信息输出变化] → 保留现有分类和脱敏测试，补跨协议一致性断言。
- [流式 tool call 顺序变化] → 不改聚合算法，只移动实现并运行适配器定向测试。

用户未覆盖 Agent 推荐。无存储或协议迁移；可回退内部文件拆分。
