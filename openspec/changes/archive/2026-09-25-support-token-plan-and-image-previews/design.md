## Context

参见 [proposal.md](./proposal.md) 和已确认的[书面设计](../../../docs/superpowers/specs/2026-09-25-token-plan-image-generation-design.md)。当前模型连接由 Runtime 的 `ModelConnectionService` 和 SQLite store 管理，设置页通过模型连接 DTO 保存能力开关。`image.generate@1` 在有默认生图模型时向 Agent 暴露，调用现有 Images API 适配器；会话图片由 `SessionAssetStore` 验证并存到会话目录。输入框图片预览用 `object-fit: cover`，用户消息图片由 `ConversationImage` 加载对象 URL 并显示。

## Goals / Non-Goals

**Goals:**

- 在同一模型连接中让生图模型显式选择 Images API 或 Token Plan 调用方式，不改变聊天模型协议。
- Token Plan 图片进入现有会话资产、事件和消息路径；配置不足时向 Agent 提供真实状态。
- 宽幅图片在输入预览、用户消息和历史恢复中完整可见。

**Non-Goals:**

- 图片编辑、异步生图、自动计费探测、自定义 Token Plan 代理路径或更换现有图片存储。
- 自动打开 Wan 生图开关或自动选择标准版、Pro 版作为默认模型。

## Decisions

### 1. 生图协议附着在模型行

`ModelOptionDto` 增加 `imageGenerationApi: 'openai-images' | 'token-plan'`。SQLite 模型行增加同名语义列，非空且默认 `openai-images`；读写、刷新合并、添加模型、HTTP 校验、桌面服务和 Mock 采用同一枚举。设置页仅在模型打开生图能力时展示协议选择器，但持久化的协议不会随开关关闭而消失；开关和默认选择仍分开保存。旧配置经迁移继续走 Images API。Token Plan 设置仅接受直连的官方 `*.maas.aliyuncs.com` HTTPS 网关；不支持的连接给出可修改的设置错误，不向陌生端点尝试发送凭据。

替代方案是依据模型名或网关地址自动识别协议，减少一个设置项，但代理地址、模型 ID 和新供应商会使识别不可靠。另一个方案是给每个生图协议单独创建连接，要求用户重复维护同一凭据。用户裁决采用显式逐模型选择，保留单连接复用。

### 2. 适配器只负责供应商协议，资产仍由工具保存

`ModelConnectionService.generateImage` 验证默认引用后按模型协议分发。现有 Images API 适配器保持原行为；新增 Token Plan 适配器从连接 URL 的 origin 拼官方同步路径，使用已有凭据，发送单图请求 `model`、用户文本 `input.messages` 与 `parameters: { size: '1024*1024', n: 1 }`。官方[Token Plan 接入文档](https://help.aliyun.com/zh/model-studio/token-plan-multimodal-gen)和[Wan 2.7 API 参考](https://help.aliyun.com/zh/model-studio/wan-image-generation-and-editing-api-reference)支持该请求结构。响应从 `output.choices[*].message.content[*].image` 取 HTTPS URL，立即下载为有界字节数组；工具继续调用 `SessionAssetStore.saveGenerated` 做图片格式、尺寸与资产验证。URL 不写入消息、事件或长期存储。

现有工具按最多四条需求发出独立并行请求，不依赖提供方批量 `n`。适配器复用现有超时、取消、响应大小上限和禁止重定向策略；HTTP、下载、JSON 和缺图错误映射为稳定错误码，不回显凭据或整份提供方响应。可执行替代是给 Wan 单独注册工具，但会分裂模型可见的生图能力和既有部分成功语义，因此不采用。

### 3. 可用性判断与配置说明由 Runtime 同步读取

维持 `isAvailable` 对 `image.generate` 的过滤；默认生图模型不存在时，不暴露无法执行的工具。在每次向聊天模型发请求时，Runtime 根据同一默认模型状态附加简短系统说明，指出应用支持生图但当前需要在“设置 → 模型连接”启用并设为默认。配置好后该说明消失，工具出现在列表。构造每轮模型请求时重新读取，避免切换配置后继续使用旧状态。调用开始与执行中默认引用变化时给出配置错误。

替代方案是始终暴露生图工具并让工具报未配置错误；这会导致重复无效调用，也会改变已确认的未配置时工具不可用规则，因此不采用。动态说明不能完全控制模型文案，测试将检查实际传给模型的状态与工具列表，并用端到端场景观察用户回复。

### 4. 预览保留全图和明确信息层次

输入预览由裁切小方块改为有界的完整比例图片卡片，图片区域用 `object-fit: contain`，文件名和移除按钮分别布局。用户消息的图片缩略图也保持完整比例，白底图片以边框与页面分开；纯图片消息不产生空白文字占位，图文混合消息的文字与图片分别保留可读空间。放大查看仍用原资产对象 URL。对图片加载失败显示已有错误占位，并用宽幅白底文字图验证发送前、发送后和历史恢复。

替代方案是继续正方形裁切并只在点击后看全图，布局紧凑但输入时和历史列表中难以分辨截图，因此不采用。这里不改资产传输或缩略图服务。

## Risks / Trade-offs

- [Token Plan 与 Images API 的响应格式不同] → 分适配器解析，使用有界下载和图片存储的格式验证；不从原始 JSON 猜测成功。
- [Token Plan 直连要求官方域名与地域凭据一致] → 选择协议时及调用时验证地址，明确提示当前连接不受支持；首版不支持自定义代理路径。
- [多张并行可能产生多笔费用] → 每条只请求一张，保留现有最多四条的工具上限；迁移与设置保存不会发起生成。
- [系统上下文说明依赖模型遵循] → 验证提供给模型的事实；对模型文字输出做端到端回归，不能把单条 prompt 当成绝对保证。
- [白底宽幅图片缩到有限空间后文字仍可能偏小] → 显示完整构图并保留放大入口，避免图片被裁切或无边界地融入背景。
- [用户覆盖] → 用户选择显式逐模型协议而非按网关自动识别，接受设置页多一个操作；没有其他覆盖项。

## Migration Plan

1. SQLite 升级模型行协议列，默认 `openai-images`；原能力开关和默认引用不变，按现有数据库备份机制执行。
2. 扩展共享 DTO、服务校验和设置 UI；旧桌面缓存/Mock 缺失字段时规范化为 `openai-images`。
3. 增加 Token Plan 适配器与 Runtime 配置说明；工具及资产协议不迁移。
4. 改善图片 UI 并验证旧会话、宽幅图片、未配置与已配置生图路径。回滚时新增列由旧版本忽略，既有图片文件保留。
