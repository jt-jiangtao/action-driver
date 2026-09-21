## 1. Main 侧凭据仓储与传输端口

- [x] 1.1 定义 `shared/model-ipc-contract.ts` 的通道常量、DTO（连接、掩码提示、协议、测试结果、错误）与响应联合类型，并用单元测试验证 DTO 不含原始密钥字段且错误可序列化。
- [x] 1.2 实现 `HttpTransport` 端口与默认 `fetch` 实现（超时、中断、JSON 解析、网络错误归一化），用注入替身验证 200、401、404、429、5xx、超时与非法 JSON 六类结果。
- [x] 1.3 实现凭据仓储：读写 `userData/data/model-connections.json`，API Key 经 `safeStorage` 加密保存、按需解密，注入加密替身验证"密文落盘、掩码返回、加密不可用时报 `MODEL_SECRET_UNAVAILABLE` 且不写明文"。

## 2. 协议适配与服务

- [x] 2.1 实现 `openai-compatible` 适配器：`GET {baseUrl}/models` 发现模型，`POST {baseUrl}/chat/completions`（`max_tokens: 8`）探测模型，验证地址拼接、请求头与超时参数正确。
- [x] 2.2 实现 `anthropic` 适配器：`POST {baseUrl}/v1/messages` 探测模型并携带 `x-api-key` 与 `anthropic-version`，验证发现接口缺失时返回空列表而不是失败。
- [x] 2.3 实现 `ModelConnectionService`：列出、添加、删除、启用/停用、刷新发现、连接测试、单模型测试与连接内模型测试，验证成功、认证失败、地址错误、限流、超时、能力错误（标记不支持文本）与非法响应的分类结果。
- [x] 2.4 增加密钥脱敏守卫测试：序列化连接、错误与日志载荷时都不出现明文密钥，掩码只暴露末 4 位。

## 3. Electron Main 注册与 Preload 白名单

- [x] 3.1 在 Main 注册具名模型连接 IPC Handler，并在 local 组合根绑定真实服务、mock 组合根保持不注册，用容器与 Handler 单元测试验证绑定与响应形状。
- [x] 3.2 在 Preload 暴露 `modelConnections.*` 白名单 API（list/testConnection/discover/refresh/testModels/testConnectionModels/setModelEnabled/add/delete），用单元测试验证未知通道、原始密钥与通用 IPC 不可访问。

## 4. Renderer 领域接口与设置页

- [x] 4.1 把 `ModelConnectionsService.list()` 改为异步并为 `ModelConnection` 增加 `protocol` 与 `apiKeyHint`、为测试状态增加 `unsupported`，同步更新 Mock 实现与组件测试，验证设置页在异步读取与空列表下行为不变。
- [x] 4.2 实现 `DesktopModelConnectionsService`：把白名单 API 映射为现有领域接口，并验证错误映射（认证失败、限流、超时、网络错误、不支持文本）与结构化克隆安全。
- [x] 4.3 在添加模型集第一步新增协议选择控件（OpenAI 兼容 / Anthropic 兼容）并登记交互契约，验证两步流程在两种协议下的可见状态与步骤间数据保留。
- [x] 4.4 在模型行展示"不支持文本"状态并允许保存其余成功模型，验证测试中、成功、失败、不支持文本四种状态渲染与视觉语义。

## 5. 组合根、契约与视觉验收

- [x] 5.1 在 Renderer 组合根按 `mock | local` 绑定 Mock 与 Desktop 模型连接服务，用容器测试验证可替换且组件不直接构造基础设施实现。
- [x] 5.2 运行 `pnpm validate:e2e-interactions` 与组件测试，确认新增协议控件已登记、无未登记或重复契约。
- [x] 5.3 更新受影响的 Playwright 视觉基准（添加模型集连接步骤、模型选择步骤及相关设置状态）并复核布局、文案与状态语义，验证 `pnpm test:e2e:visual` 通过。

## 6. 交付验证

- [x] 6.1 运行 `pnpm typecheck && pnpm lint && pnpm test`，确认全部通过且仓库内不存在真实密钥。
- [x] 6.2 在 local 组合根用环境变量注入真实凭据做一次人工验证（列出连接、发现模型、测试文本模型与媒体模型），确认"不支持文本"分类正确且明文密钥未出现在任何输出中。
- [x] 6.3 运行 `openspec validate implement-model-connections-service --strict`，确认规格与任务一致。
