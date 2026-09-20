## 1. 协议与工作区基础

- [x] 1.1 建立 Go 1.24 Workspace、`services/agentd` 与 `packages/runtime-protocol`，锁定 Eino、gRPC、SQLite、Buf 和 TypeScript 协议依赖，并验证 `go test ./...` 与 `pnpm install --frozen-lockfile` 成功。
- [x] 1.2 定义 Runtime Control、Agent Command、Runtime Events 和 Skill Provider v1 Protobuf 契约，生成 Go/TypeScript 代码，并用 Buf lint、breaking check 与生成物 drift 检查验证契约可重复生成。
- [x] 1.3 增加跨语言 golden fixture，验证请求标识、版本握手、错误码、Skill 生命周期和事件游标在 Go 与 TypeScript 间往返一致。

## 2. Go Sidecar 与本地存储

- [ ] 2.1 建立 `actiondriver-agentd` 入口、配置解析、Eino adapter 边界和确定性 Runtime Driver，并用 Go 单元测试验证无模型凭据时仍可启动健康服务。
- [ ] 2.2 实现 SQLite 连接、WAL/foreign-key 配置和嵌入式原子迁移，使用临时数据库测试首次创建、重复启动、checksum 与迁移失败回滚。
- [ ] 2.3 实现任务、消息、步骤、Skill 调用和事件仓储，验证一次状态变化与对应事件在同一事务中提交，失败时两者均不落盘。

## 3. Skill Registry 与 Runtime 编排

- [ ] 3.1 先编写 Registry 测试，再实现按 `skill_id + contract_version` 注册、下线和查找 Provider，验证 Browser 与 Computer Provider 状态互不影响。
- [ ] 3.2 实现确定性 Agent 命令和 Skill 调度状态机，验证未注册能力返回 `CAPABILITY_UNAVAILABLE`，已注册调用先持久化 queued 再发布有序生命周期事件。
- [ ] 3.3 实现按持久化游标读取的事件订阅，验证断线后从 `cursor + 1` 恢复且已确认事件不被重复应用。

## 4. gRPC over UDS 传输

- [ ] 4.1 实现只监听 Unix Domain Socket 的 gRPC Server、会话令牌校验与版本握手，使用临时套接字测试无 TCP 监听、兼容版本成功和主版本不兼容拒绝。
- [ ] 4.2 实现 Agent Command、Runtime Events、Skill Provider 和受控 Shutdown 服务，验证 request id 关联、deadline、流恢复和关闭期间拒绝新命令。

## 5. Electron Sidecar 集成

- [ ] 5.1 先编写 Supervisor 状态机测试，再实现单实例 Sidecar 启动、探活、60 秒内最多 3 次重启、受控退出和运行目录清理。
- [ ] 5.2 实现 TypeScript gRPC Runtime Client 与协议到领域 DTO 映射，验证超时、版本错误、重复游标和结构化克隆安全。
- [ ] 5.3 在 Main 注册明确命名的 IPC Handler，在 Preload 暴露白名单 Agent API，并验证 Renderer 无法访问 socket、gRPC client、数据库路径或通用 IPC 调用。
- [ ] 5.4 增加 `mock | local` 组合根绑定，将生产绑定切换到本地 Runtime Adapter，同时验证现有 47 项测试和视觉回归继续使用 Mock 且页面无视觉变化。

## 6. 定制 Electron Fork 工具链

- [ ] 6.1 定义并测试 Fork manifest、artifact manifest 与 patch index schema，锁定 Electron tag、Chromium revision、Fork commit、patch-set、架构、协议版本和 SHA-256。
- [ ] 6.2 实现补丁顺序、引用完整性和产物校验脚本，验证缺失补丁、错误 checksum、架构不匹配和缺失 Fork 产物都会使生产打包失败且不回退公版 Electron。
- [ ] 6.3 添加 Docker 元数据校验与 macOS Fork 基线构建工作流说明/入口，验证只有上游或 patch-set 变化触发完整 macOS 构建。

## 7. 端到端与交付验证

- [ ] 7.1 增加真实 Sidecar macOS 冒烟测试，验证启动、握手、离线提交任务、事件订阅、进程共享和退出清理的完整路径。
- [ ] 7.2 扩展 Docker quality 流程以运行 Buf、Go、SQLite、TypeScript 和 Renderer 检查，并验证 `docker compose build quality && docker compose run --rm quality` 通过。
- [ ] 7.3 运行格式、类型、Lint、Go race、单元、Electron E2E、视觉回归、协议 drift、OpenSpec strict 和 Fork manifest 全量检查，确认 Phase 0 未实现真实 Browser/Computer 动作且所有规格均有验证证据。
