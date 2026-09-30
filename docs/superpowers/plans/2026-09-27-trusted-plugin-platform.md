# Trusted Plugin Platform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在已批准的可信插件平台上实施公共 npm API、统一宿主与同包 Skill/执行开发脚手架，再按 OpenSpec 迁移内置能力。

**Architecture:** plugin-contracts 提供可序列化契约，plugin-sdk 提供显式注入接口；每插件独立进程，Runtime/Desktop composition root 注入 ports。贡献目录和执行模块同包，外部装配层拼接 schema/Skill，所有资源由统一宿主追踪。

**Tech Stack:** TypeScript、Node IPC、Zod、semver、esbuild、Vitest、现有 Electron/MCP 适配层。

**Spec:** openspec/changes/archive/2026-09-27-introduce-trusted-plugin-platform/design.md 与 specs/plugin-platform/spec.md、specs/agent-tool-runtime/spec.md。

## Global Constraints

- 用户要求直接在 main 修改；不覆盖浏览器 fork 与其他线程未提交文件。
- 内置与第三方共用 API，禁止内部导入、全局服务定位器及隐式 mock fallback。
- SessionSandbox fail-closed、Computer 应用批准与取消保持；可信插件不提供 OS 沙箱。
- 迭代仅定向测试；全量验证只在准备 git commit 时一次执行。
- Skill/schema/执行同包分发；目录发现无激活/授权副作用。
- npm 包可打包，不自动向 npm registry 发布。

## Review Focus

- 协议畸形/迟到消息不能重建贡献或覆盖新实例结果。
- 取消未停止的调用不能被当作完成；停用期限到后未知结果不重放。
- SDK tarball 在仓库外使用不依赖 workspace:* 或内部 TypeScript 路径。
- 脚手架目标非空/非法名称时不能覆盖文件，失败不能留半套项目。
- Skill 资源必须随插件包分发；目录读取不能启动执行代码。

### Task 1: 公共契约与 npm SDK（OpenSpec 1.2–1.5）

**Files:** packages/plugin-contracts/src/index.ts、tool.ts、packages/plugin-sdk/src/index.ts、context.ts 与两包 package.json/tsconfig。
**Interfaces:** Consumes 既有 Runtime ToolDefinition 兼容形状；Produces PluginManifest、PluginCatalog、PluginContext、PluginModule、createPluginContext(owner, transport, registrations)、DisposableStore。

- [ ] RED：契约输入、SDK 上下文、npm tarball 外部导入失败测试先运行。
- [x] GREEN：公共包无内部依赖；提供 dist JavaScript/声明与正常 npm 版本依赖。
- [x] Verify：corepack pnpm vitest run packages/plugin-contracts/src/index.test.ts packages/plugin-sdk/src/context.test.ts；两包 typecheck/build；npm pack 与临时目录导入。Expected: 全部通过。

### Task 2: 统一生命周期与真实宿主（OpenSpec 2.x、3.1–3.2）

**Files:** apps/agent-runtime/src/plugins/{manager,ports,process-host,host-api,capability-router}.ts、host-entry 与定向测试；src/tool-registry.ts。
**Interfaces:** Consumes Task 1；Produces PluginManager.install/enable/activate/disable/upgrade/uninstall/invoke 与 NodePluginHostFactory.start，贡献绑定 PluginOwner。

- [ ] RED：single-flight、原子注册、实例令牌、取消/崩溃/期限、回退数据策略、跨插件授权与循环限制测试。
- [x] GREEN：注入 repository/factory/clock/transport，生命周期兜底回收全部资源，未知调用不重放。
- [x] Verify：corepack pnpm vitest run apps/agent-runtime/src/plugins/*.test.ts apps/agent-runtime/tests/tool-registry.test.ts。Expected: 全部通过。

### Task 3: npm create 脚手架（OpenSpec 1.6）

**Files:** packages/create-action-driver-plugin/{package.json,src/index.mjs,src/generate.mjs,templates} 与 generate.test.ts。
**Interfaces:** Consumes npm plugin-sdk，PluginModule/PluginCatalog；Produces generatePlugin({id,directory,sdkVersion}): Promise<void> 与 CLI bin。

- [ ] RED：非空目录和非法 ID 不写；生成包能构建、读目录、真实宿主加载和停用。
- [x] GREEN：原子临时目录生成，同包 skills/src/catalog/src/extension/src/execution，build/test/package 配置。
- [x] Verify：corepack pnpm vitest run packages/create-action-driver-plugin/src/generate.test.ts。Expected: 生成项目完整行为通过。

### Task 4: 首个 search 迁移（OpenSpec 5.1）

**Files:** plugins/search/plugin.json、src/{catalog,extension,execution}.ts；Runtime plugins/composition.ts、runtime-process.ts、构建入口与 search 回归测试。
**Interfaces:** Consumes Task 1–2；Produces 保持 web.search@1/web_search 的独立目录与执行插件。

- [ ] RED：schema 无需 endpoint/激活读取；缺少 endpoint 不发布工具；真实插件返回既有结果。
- [x] GREEN：迁入业务实现，配置与 grants 由 composition root 管；删除重复手工注册。
- [x] Verify：corepack pnpm vitest run apps/agent-runtime/tests/searxng*.test.ts plugins/search/src/*.test.ts。Expected: 旧工具 ID/结果/取消保持。

### Task 5: 服务与 Desktop ports（OpenSpec 3.3–4.3）

**Files:** Runtime plugins/services/storage/artifacts/credentials/logging adapters；Desktop main/plugins 面板与 capability 适配、构建配置与 fixture。
**Interfaces:** Consumes PluginOwner/InvocationContext；Produces ProcessSupervisor、PanelHost、CredentialBroker、ArtifactStore、CapabilityTransport 注入适配器。

- [ ] RED：平台产物缺失、stdio 非协议、HTTP 断开、私有存储归属、非法面板消息、原 Computer 取消。
- [x] GREEN：复用现有本机能力和批准，不给页面 Node/任意 IPC，不注入全局凭据。
- [x] Verify：相关新增 fixture 与既有 Computer/SkillProvider 定向回归。Expected: 全部通过。

### Task 6: 后续迁移（OpenSpec 5.2–5.7）

**Files:** plugins/{command,web-reader,image-generation,computer-use,browser-use} 与对应旧装配、native 构建打包定位。
**Interfaces:** Consumes Task 1–5；Produces 各插件同包贡献目录与执行模块，稳定工具标识。

- [ ] RED：SessionSandbox fail-closed、产物、凭据、应用批准/停止和无 browser 驱动不发布工具。
- [x] GREEN：每能力仅一个注册者；native 迁移保留签名身份/来源/许可证/权限。
- [x] Verify：直接相关执行/Web/image/Computer 定向测试与 native 签名/产物验证。Expected: 现有行为保持。

### Task 7: 验证与交付（OpenSpec 6.x）

**Files:** 插件开发文档、打包文档、OpenSpec tasks/实施记录。
**Interfaces:** Consumes 前六项；Produces 真实第三方与内置共用路径证据、导入约束检查、提交验证记录。

- [x] 执行导入约束、停用/卸载/数据保留与打包验证，记录未验证平台。
- [x] 准备提交时一次运行 corepack pnpm typecheck、lint、test，按实际 UI/打包影响追加 E2E；只提交本任务文件。
- [x] Fresh reviewer 审查整体 diff；重要问题定向修复并验证。
- [x] 更新 tasks，用户确认同步主规范并归档；归档前逐块核对两份规范。

实施与验证证据见 openspec/changes/archive/2026-09-27-introduce-trusted-plugin-platform/validation.md。Verify 勾选表示相应检查已执行；CUA 批准等待的已知基线失败、未验证 x64 和首次全量失败均保留记录，不代表无条件全部通过。RED 历史项未回溯补造记录。
