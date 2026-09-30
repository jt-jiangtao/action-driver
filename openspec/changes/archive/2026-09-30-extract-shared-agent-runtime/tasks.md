## 1. 包边界与命名

- [x] 1.1 在并行产品更名完成后，建立 `packages/agent-runtime` 的包配置与明确出口，并将现有应用标识规划为 `apps/local-runtime` / `@action-driver/local-runtime`；用 workspace 包解析与定向 typecheck 验证两个名称不冲突。
- [x] 1.2 加入跨包边界检查，禁止共享 Runtime、模型契约包和供应商运行包导入 `apps/`、Electron、SQLite、本地执行模块或互相循环依赖；保留 `model-connections` 不引入 OpenAI SDK 的既有断言，用刻意注入违规导入的测试确认检查会失败，再恢复并确认通过。

## 2. 共享 Agent Runtime

- [x] 2.1 将 Agent 图、Runtime 端口和纯逻辑投影迁入共享包；把对应单包测试移入 `packages/agent-runtime/tests/`，运行迁入测试与包 typecheck，确认本地装配仍能创建原图。
- [x] 2.2 迁入工具/Skill 注册、策略、调用及状态逻辑；消除对本地执行异常类的反向导入，保持原错误码、输出和取消语义，运行相关定向测试。
- [x] 2.3 迁入流会话编排及其纯逻辑依赖；将资产、输入、输出与桌面审批的具体类型引用收窄为实际所需操作，并将纯 URI 格式化逻辑移到既有资源契约层；运行流式、回放、图片/文件、资源 URI 及审批相关定向测试。
- [x] 2.4 调整本地适配器和装配入口只通过 `@action-driver/agent-runtime` 的公开出口使用共享逻辑，运行本地 Runtime 装配与纯 Node 启动/关闭测试，确认包边界检查通过。

## 3. 模型协议复用

- [x] 3.1 建立 `packages/model-provider-runtime`，将 OpenAI/Anthropic 协议适配、HTTP 传输、供应商错误归一化及其测试迁入该包；运行供应商解析、超时、失败映射和模型流定向测试、包 typecheck 与现有 `model-provider-boundary` 测试。
- [x] 3.2 将 `ConnectionModelGateway` 接到共享 Runtime 的 `ModelGateway` 端口，保留本地 `ModelConnectionService` 与凭据存储装配；运行模型请求、日志/trace 与本地连接服务定向测试，并确认共享包间无循环、`model-connections` 仍是纯契约包。

## 4. 本地宿主迁移与验证

- [x] 4.1 迁移应用到 `apps/local-runtime`，将本地装配入口及相关内部标识改为明确的本地名称；检查本次迁移的文件名、导出和测试名，运行宿主生命周期与装配测试。
- [x] 4.2 更新根与桌面构建命令、原生模块脚本、插件/技能 staging、运行资源路径、Electron 启动路径及 pnpm 锁文件；构建本地宿主并运行桌面启动与打包路径定向测试，确认没有活跃代码引用旧目录/包名。
- [x] 4.3 按 `docs/testing/test-placement.md` 将单包测试放在所属包，跨包测试放在根 `tests/`；运行受影响定向测试，确认测试不再通过 `apps/local-runtime/src` 相对路径读取共享实现。
- [x] 4.4 核对现行架构文档和本次变更范围内的名称，修正误导性名称及当前文档引用；用文本搜索确认新名称一致，历史归档记录保持原样。
- [x] 4.5 在准备提交时按仓库规范一次性运行 `pnpm typecheck`、`pnpm lint`、`pnpm test`，并按运行时/打包影响补本地与 macOS 打包端到端验证；记录命令结果及已知无关失败，只提交本变更文件，不包含其他会话的工作区改动。
