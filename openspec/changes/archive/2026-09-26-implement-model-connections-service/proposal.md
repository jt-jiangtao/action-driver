## Why

设置页目前由 Renderer 内的 `MockModelConnectionsService` 提供数据与"测试成功"结果：连接不落盘、协议固定为 OpenAI 兼容、API Key 没有保护、任何测试都只返回确定性结果。用户已提供可用的 OpenAI 兼容与 Anthropic 兼容端点与凭据，需要把这些操作接到真实后端，让"添加模型集、测试连接、发现与测试模型、启用/停用、刷新、删除"产生真实且可诊断的结果。

## What Changes

- 新增 Main 进程的模型连接服务，统一负责连接配置的读取、写入、协议适配与验证；配置持久化在应用 userData，API Key 使用 Electron `safeStorage` 加密，Renderer 只获得掩码。
- 支持两种协议：`OpenAI 兼容`（`GET /models` 发现模型、`POST /chat/completions` 最小调用验证）与 `Anthropic 兼容`（`POST /v1/messages` 最小调用验证；该协议没有发现接口，模型手动添加）。
- 连接测试与单模型测试执行真实 HTTP 调用，带超时与错误分类（认证失败、地址或路径错误、限流、服务错误、网络或超时）。
- 非文本模型（图片、音频、视频）在文本探测返回参数错误时标记为"不支持文本"，而不是判定连接失败。
- **BREAKING**（Renderer 领域接口）：`ModelConnectionsService.list()` 变为异步；`ModelConnection.protocol` 扩展为两种协议；添加模型集第一步新增协议选择。
- Preload 白名单新增类型化 `modelConnections.*` 通道；Renderer 依旧无法访问通用 IPC、数据库路径或明文密钥。
- 组件测试与视觉验收继续绑定 Mock 实现，真实后端只绑定在生产（local）组合根。
- Agent Loop 继续使用确定性模型；真实推理与 Runtime 侧 ModelGateway 接入不在本 change 范围。

## Capabilities

### New Capabilities

- `model-connections-backend`: 定义 Main 进程模型连接服务的可见行为：加密凭据存储、协议适配、模型发现、连接与模型验证、错误分类和掩码投影。

### Modified Capabilities

- `model-connections-settings`: 把 Mock 数据与 Mock 操作替换为真实后端行为，新增协议选择与"不支持文本"测试状态。
- `desktop-shell`: 在渲染边界白名单中新增模型连接能力，并保证凭据只存在于 Main 进程。

## Impact

- 新增 `apps/desktop/src/main/model-connections/`（凭据仓储、协议适配器、服务、HTTP 端口）与 `apps/desktop/src/shared/model-ipc-contract.ts`。
- `apps/desktop/src/preload/desktop-api.ts` 新增 `modelConnections` 命名空间；Renderer 新增 `DesktopModelConnectionsService`，并在 local 组合根绑定。
- 设置页新增协议选择控件与"不支持文本"状态；交互契约登记与相关视觉基线需要同步更新。
- 依赖：仅使用 Main 进程内建 `fetch` 与 Electron `safeStorage`，不新增第三方 HTTP 或钥匙串依赖。
- 安全：明文密钥不进入 Renderer、日志、Runtime、SQLite 或会话历史；单元测试与 E2E 使用 Mock HTTP 端口，绝不写入真实密钥。

## Battle Status

- 类型：混合（产品可见行为 + 架构边界与安全约束）。
- 状态：已裁决（2026-09-22）。
- 目标：把设置页的模型连接从 Mock 数据切换为真实后端，并保证密钥、网络调用与数据所有权边界清晰。
- 当前方案：Main 进程持有连接配置与密钥（`safeStorage` 加密后写入 userData），协议适配在 Main 完成，Renderer 只通过白名单桥接调用并只看到掩码；同时支持 OpenAI 兼容与 Anthropic 兼容；模型测试新增"不支持文本"结果。
- 主要质疑：把密钥交给 Runtime 或 Renderer 会改变数据所有权并放大泄露面；只做 OpenAI 兼容会让用户提供的 Anthropic 端点不可用；把非文本模型的参数错误当作"连接失败"会给出错误结论；同步 `list()` 接口无法承载真实存储。
- 替代方案：把连接配置写入 Runtime SQLite（数据所有权错误，密钥离开 Main）；用 macOS Keychain 替代 `safeStorage`（更严但引入原生依赖与授权弹窗，本阶段不采用）；先只支持 OpenAI 兼容协议（无法使用用户提供的 Anthropic 端点）。
- 最终决策：采用 Main 进程 + `safeStorage` + 双协议 + "不支持文本"状态；Renderer 接口改为异步。
- 主要权衡：设置页需要新增协议选择控件并更新视觉基线；模型测试语义从二态扩展为三态。
- 用户覆盖：无。
- 仍未解决的关键分歧：无。真实推理（Runtime ModelGateway 接入真实模型）明确留待后续 change。
- 重新开启条件：需要把推理请求也交给真实模型，或安全要求升级为系统钥匙串/团队共享凭据。
