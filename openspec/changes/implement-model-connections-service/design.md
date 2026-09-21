## Context

参见 `proposal.md` 的 Why。当前设置页由 `apps/desktop/src/renderer/src/services/mock-model-connections.ts` 提供数据与确定性结果，`ModelConnectionsService` 是同步接口，`ModelConnection.protocol` 只有 `OpenAI 兼容`，模型测试只有未测试/测试中/成功/失败四态。桌面壳已经建立了"Preload 白名单 + Main IPC Handler"的既有模式（Agent 能力即按此实现），组件与视觉测试绑定 Mock 组合根，生产（local）组合根绑定真实实现。Agent Runtime 已有 `ModelGateway` 端口，但本 change 不接入真实推理。

用户在 2026-09-22 提供了可用的 OpenAI 兼容端点（`https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1`）与 Anthropic 兼容端点（`https://token-plan.cn-beijing.maas.aliyuncs.com/apps/anthropic`）。实测：`GET /compatible-mode/v1/models` 返回 15 个模型；`POST /chat/completions` 对 `qwen3.7-plus` 返回 200；同一接口对 `qwen-image-3.0-pro` 返回 400 `InvalidParameter`；`POST /apps/anthropic/v1/messages` 用 `x-api-key` 返回 200，而 `GET /apps/anthropic/v1/models` 返回 404。

## Goals / Non-Goals

**Goals:**

- 让设置页的每一次连接、发现、测试、启用、刷新与删除都由 Main 进程的真实实现回答，并持久化结果。
- 让 API Key 只存在于 Main 进程，并在磁盘上以操作系统加密形式保存。
- 让两种协议通过同一边界接入，并让误报（把"不支持文本"当成"连接失败"）不再发生。
- 让全部远程调用可以通过注入的传输端口替换，使测试不依赖真实网络与真实凭据。

**Non-Goals:**

- 不接入真实模型推理：Agent Loop 继续使用确定性模型，Runtime 的 `ModelGateway` 保持 Mock/确定性绑定。
- 不实现账号、团队共享凭据、云同步或凭据轮换流程。
- 不改变首页、任务页与设置页已确认的布局结构，除新增协议选择控件与"不支持文本"状态外不引入新页面。
- 不实现真实 HTTP 之外的供应商特性（流式、工具调用、计费查询）。

## Decisions

### 1. 连接配置与凭据由 Main 进程持有

连接配置写入 `app.getPath('userData')/data/model-connections.json`，其中 API Key 使用 Electron `safeStorage.encryptString()` 加密后以 base64 密文保存；只有发起请求时才在 Main 进程内解密。Renderer 侧 DTO 只包含掩码提示（例如 `••••` + 末 4 位）与协议、地址、模型列表。

选择 Main + `safeStorage`，而不是把连接写进 Runtime 的 SQLite：连接配置与模型凭据属于桌面应用配置，不属于会话历史；写入 Runtime 会把密钥交给另一个进程并扩大泄露面。也不选择 macOS Keychain：它更严格，但引入原生依赖与首次授权弹窗，代价超过本阶段收益。明文 JSON 不可接受，因为一次目录泄露即等于凭据泄露；当 `safeStorage` 不可用时系统必须返回可诊断错误而不是降级为明文。

### 2. 协议适配器端口 + 传输端口

Main 侧引入最小端口：

- `HttpTransport`：`request({ url, method, headers, body, timeoutMs })` 返回状态码与已解析 JSON，负责超时、中断与网络错误归一化。默认实现使用 Main 进程内建 `fetch`，不新增第三方 HTTP 依赖。
- `ModelProviderAdapter`：按协议实现 `listModels(connection)` 与 `probeModel(connection, modelId)`。`openai-compatible` 使用 `GET {baseUrl}/models` 与 `POST {baseUrl}/chat/completions`（`max_tokens: 8`）；`anthropic` 使用 `POST {baseUrl}/v1/messages`（`x-api-key`、`anthropic-version: 2023-06-01`、`max_tokens: 8`），且不提供发现接口。

两个端口都通过 Inversify 绑定注入，测试组合根用确定性替身替换，因此单元测试与 E2E 不访问真实网络。选择"端口注入"而不是在服务内直接调用 `fetch`：否则测试只能依赖真实网络或全局猴子补丁，也会让超时与错误分类无法稳定覆盖。

### 3. 错误分类与"不支持文本"

传输层把失败归一化为 `unauthorized | not-found | rate-limited | provider-error | network | timeout | invalid-response`。服务层把结果投影为页面可用的结构：连接测试返回 `{ ok, failure? }`；模型测试返回 `success | failed | unsupported`。当模型探测返回参数或能力类错误（HTTP 400/422 且不属于认证或限流）时判定为"不支持文本"，其余失败判定为 `failed`。

这一区分来自实测证据：同一端点上 `qwen-image-3.0-pro` 对文本请求返回 400，而连接本身完全正常。若沿用二态结果，用户会误以为连接坏了，且无法保存包含媒体模型的模型集。

### 4. Renderer 领域接口改为异步并新增协议

`ModelConnectionsService` 的 `list()` 变为 `Promise`，`ModelConnection` 增加 `protocol: 'OpenAI 兼容' | 'Anthropic 兼容'` 与 `apiKeyHint: string`，`ModelTestState` 增加 `'unsupported'`。设置页因此在挂载时异步读取数据，并新增协议选择控件（第一步表单内）与"不支持文本"状态文案。

选择"改接口"而不是"用内存缓存假装同步"：真实存储无法同步读取，凡是显示过期的内存快照都会在重启、删除或失败后显示错误数据。

### 5. IPC 与 Preload 白名单

新增 `shared/model-ipc-contract.ts` 定义通道与 DTO，Main 注册具名 Handler（list、test-connection、discover、refresh、test-models、test-connection-models、set-model-enabled、add、delete），Preload 暴露 `window.actionDriverDesktop.modelConnections.*`，复用 `agent` 命名空间已有的 `{ ok, value } | { ok: false, error }` 响应约定与错误序列化。

这与既有 `desktop-shell` 要求一致：页面不能传入任意通道名，也不能读取明文密钥；因此通道名是常量，DTO 里没有原始 Key 字段。

### 6. 组合根绑定

Renderer 组合根在 `mock` 模式继续绑定 `MockModelConnectionsService`（组件测试与视觉验收），在 `local` 模式绑定新的 `DesktopModelConnectionsService`；Main 组合根在 `local` 模式注册模型连接 Handler 并在容器中绑定真实服务（Mock 模式不注册，保持现有测试可控）。

### 7. 交互契约与视觉基线

协议选择控件按既有规范提供 `e2e/settings/add-model-set/protocol#select` 测试标识并登记为 `functional`；"不支持文本"状态复用现有状态胶囊组件。因为新增控件改变了添加模型集弹窗的布局，涉及 `settings-add-connection`、`settings-select-models` 等相关基准截图需要重新生成并复核。

Battle 于 2026-09-22 裁决：用户已确认 Main + `safeStorage`、双协议、三态测试结果与"本阶段不做真实推理"四点。被否方案是把连接写进 Runtime SQLite、改用系统钥匙串、只支持 OpenAI 兼容协议以及保持同步 `list()`。

## Risks / Trade-offs

- [密钥可能经日志、错误对象或调试输出泄露] → 服务层只输出掩码与错误分类；错误序列化复用既有 `AgentIpcError` 形状；单元测试断言序列化结果不含明文密钥。
- [磁盘上的密文随系统账号一同泄露] → `safeStorage` 绑定当前用户凭据；文档与设置页不展示密钥；用户需要轮换时可直接删除并重建连接。
- [`safeStorage` 在部分环境不可用] → 返回 `MODEL_SECRET_UNAVAILABLE` 诊断错误并拒绝保存明文，而不是静默降级。
- [不同端点的发现接口不一致（Anthropic 404）] → 把发现失败与连接失败分开；无发现接口时保留手动添加模型入口。
- [媒体模型不会被文本探测覆盖] → 新增"不支持文本"状态，并允许保存其余成功模型。
- [真实网络让测试不稳定] → 所有远程调用经由注入的传输端口；E2E 与单元测试使用确定性替身，真实端点只在人工验证时通过环境变量注入凭据。
- [视觉基线变化被误当成回归] → 在 tasks 中显式包含基准截图更新与复核步骤。

## Migration Plan

1. 新增 Main 侧服务、端口与 IPC，保持 Renderer 仍绑定 Mock，验证既有测试与视觉用例不受影响。
2. 扩展 Renderer 领域接口（异步 `list()`、协议、三态结果）与设置页控件，更新组件测试。
3. 在 local 组合根切换到真实服务，更新交互契约、视觉基准与端到端验证。

回滚时可把 Renderer 与 Main 组合根切回 Mock 绑定；磁盘上的 `model-connections.json` 不参与 Mock 模式，删除该文件即可清空真实配置。

## Open Questions

- 真实推理（把 Runtime `ModelGateway` 接到这些连接）与代理调用方式留待后续 change 设计，本 change 的产物足以支撑该扩展，不需要现在决定。
