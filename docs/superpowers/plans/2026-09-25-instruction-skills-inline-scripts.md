# Instruction Skills and Inline Script Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让普通 Skill 从 GitHub 或本地文件夹安装到固定目录并在任务中生效，同时让 Shell、Python、Node、TypeScript 四个独立工具只接收脚本源码。

**Architecture:** `AgentFileStore` 继续拥有 Skill 目录与启停标记，统一安装服务负责来源获取、校验和原子导入；任务仅暴露已启用 Skill 的摘要，正文由 `skill_read` 按需返回。四个脚本工具共享 stdin 进程执行器，解释器由工具名决定，Python/Node/TypeScript 使用包内运行时。现有 Tool Registry 和 Policy Gate 决定权限。

**Tech Stack:** TypeScript、Node.js/Electron、Hono、Zod、React、Vitest、Playwright、OpenSpec。

**Spec:** [书面设计](../specs/2026-09-25-instruction-skills-inline-scripts-design.md)，[OpenSpec design](../../../openspec/changes/install-instruction-skills-and-run-inline-scripts/design.md)，[OpenSpec tasks](../../../openspec/changes/install-instruction-skills-and-run-inline-scripts/tasks.md)。

## Global Constraints

- 当前已确认的工作方式是在 `main` 直接修改；工作区已有其他未提交修改，提交时只暂存本任务文件，不重置或覆盖它们。
- 个人 Skill 根目录是 `~/.action-driver/skills/<id>`；既有 `SKILL.md` 和 `.disabled` 原样保留，生产路径由用户 home 决定，测试可以覆写隔离 home。
- 普通 Skill 不需要 executor；`SKILL.md` 不能授予任何工具权限，安装不执行脚本、不安装 npm/pip 依赖。
- 首版来源是 GitHub 仓库子目录与本地文件夹；重名拒绝，失败后不得留半安装结果。
- 四个工具分别叫 `shell_run`、`python_run`、`node_run`、`ts_run`；新输入恰为非空 `script` 与可选 `args: string[]`，源码走 stdin，不猜测语言。
- Shell 使用 `/bin/zsh`；Python/Node/TypeScript 使用包内解释器，离线保证仅 Python 标准库、Node 内建模块和 Node 原生 TypeScript 类型擦除。
- 旧任务工具记录只读展示，不重新执行；保留取消、超时、输出上限、默认工作区目录和流式活动状态。

## Review Focus

- 本地文件夹等于目标 Skill 目录、或包含指向目录外的链接时，安装应拒绝且原目录不变；Task 3 的测试锁定。
- GitHub 子目录不存在、仓库需要认证或下载中断时，错误应可理解且临时目录被清理；Task 4 的测试锁定。
- Skill 在任务创建后被停用，已有任务再调用 `skill_read` 应失败；Task 5 的测试锁定。
- 子进程先退出再收到大段 stdin，或取消发生在背压期间，应收敛到错误/取消终态而不挂起；Task 7 的测试锁定。
- `ts_run` 遇到 enum 等 Node 不能直接擦除的语法，应清晰失败且不调用系统 `tsc`；Task 8 的测试锁定。

---

## File Map

| 文件 | 职责 |
| --- | --- |
| `openspec/changes/manage-agent-skills/{proposal,design,tasks}.md`、其 delta spec | 清除旧 executor 门槛冲突 |
| `packages/runtime-contracts/src/{agent-file-contract,stream-protocol}.ts` | Skill DTO、安装输入、任务摘要契约 |
| `apps/agent-runtime/src/agent-files/agent-file-store.ts` | 目录事实、声明解析、启停和按需读取 |
| `apps/agent-runtime/src/agent-files/skill-installer.ts` | 本地/GitHub 内容准备、校验及原子导入 |
| `apps/agent-runtime/src/agent-files/skill-source.ts` | GitHub URL/仓库子路径归一化与获取 |
| `apps/agent-runtime/src/service/http-service.ts` | 设置页安装 API |
| `apps/agent-runtime/src/stream-session-service.ts` | 新任务 Skill 摘要快照 |
| `apps/agent-runtime/src/agent-files/runtime-tools.ts` | `skill_install`、`skill_read` 工具定义 |
| `apps/agent-runtime/src/runtime-process.ts` | 目录服务及工具注册组合根 |
| `apps/agent-runtime/src/execution/{process-runner,tools}.ts` | stdin 生命周期和四工具分派 |
| `apps/desktop/src/renderer/src/models/agent-files.ts` | Renderer 服务接口 |
| `apps/desktop/src/renderer/src/services/{runtime-agent-files,desktop-agent-files,mock-agent-files}.ts` | HTTP、preload、Mock 适配器 |
| `apps/desktop/src/renderer/src/pages/SkillsPage.tsx` | 列表、详情、安装与管理交互 |
| `apps/desktop/src/main/index.ts`、`apps/desktop/src/preload/desktop-api.ts` | 本地目录选择和在 Finder 中显示的窄 IPC 桥 |
| `apps/desktop/src/renderer/src/components/ActivityTimeline.tsx` | 四工具与 Skill 工具活动名称 |

### Task 1: 消除旧规划冲突并固定契约

**Files:**
- Modify: `openspec/changes/manage-agent-skills/proposal.md`, `design.md`, `tasks.md`, `specs/skill-management/spec.md`
- Modify: `packages/runtime-contracts/src/agent-file-contract.ts`, `stream-protocol.ts`, `index.ts`
- Test: `packages/runtime-contracts/tests/stream-protocol.test.ts`

**Interfaces:**
- Produces: `AgentSkillSummaryDto` 增加 `source: 'builtin' | 'local' | 'github'`；`InstallSkillInput = { source: 'local'; path: string } | { source: 'github'; url: string }`；任务 `skills` 是 `{ skillId: string; description: string }[]`。
- Consumes: 现有 `AgentFileErrorDto`、任务事件编码和 `.disabled` 文件。

- [ ] **Step 1: 写失败测试。**在 stream-protocol 测试中给新任务 `skills: [{ skillId: 'plain', description: '整理资料' }]`，断言编码/解码保留；为 `InstallSkillInput` 的本地/GitHub 判别分支加入类型检查样例。
```ts
expect(parsed.payload.skills).toEqual([{ skillId: 'plain', description: '整理资料' }])
const input: InstallSkillInput = { source: 'local', path: '/tmp/example-skill' }
expect(input.source).toBe('local')
```
- [ ] **Step 2: 运行 `corepack pnpm exec vitest run packages/runtime-contracts/tests/stream-protocol.test.ts`，确认新断言失败。**
- [ ] **Step 3: 修订旧 OpenSpec 的 executor 必需描述，扩展 DTO 和任务 schema。**保留旧 `executorId` 字段仅用于能力映射；将 `z.tuple([])` 换成有界的 Skill 摘要数组，沿用现有事件版本策略。
```ts
const modelSkillSchema = z.object({ skillId: z.string().min(1), description: z.string() }).strict()
skills: z.array(modelSkillSchema)
```
- [ ] **Step 4: 重跑上述测试和 `corepack pnpm --filter @actiondriver/runtime-contracts typecheck`；核对旧规划各文件不再声称普通 Skill 必须有 executor。**
- [ ] **Step 5: 仅暂存本 Task 的文件并提交 `docs: reconcile ordinary skill contract`。**

### Task 2: 普通 Skill 的解析、状态与读取

**Files:**
- Modify: `apps/agent-runtime/src/agent-files/agent-file-store.ts`
- Create: `apps/agent-runtime/src/agent-files/skill-declaration.ts`
- Test: `apps/agent-runtime/tests/agent-file-store.test.ts`, `apps/agent-runtime/tests/skill-declaration.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `AgentSkillSummaryDto`。
- Produces: `parseSkillDeclaration(markdown: string): { name: string; description: string; executorId: string | null }`；`AgentFileStore.listEnabledSkillDescriptions(): Promise<Array<{ skillId: string; description: string }>>`；`AgentFileStore.readEnabledSkillFile(skillId: string, relativePath?: string): Promise<AgentTextFileDto>`。

- [ ] **Step 1: 写失败测试。**覆盖 YAML frontmatter、旧无 frontmatter 的标题/首段回退、未知 executor 不阻止普通 Skill、`.disabled` 重启保留、`source` 回退为 local、停用后读取拒绝和 `../` 路径拒绝。
```ts
expect(parseSkillDeclaration('---\nname: Plain\ndescription: Helps\n---\n# Body')).toMatchObject({ name: 'Plain', description: 'Helps', executorId: null })
expect(await store.listSkills()).toContainEqual(expect.objectContaining({ id: 'plain', source: 'local', available: true }))
await expect(store.readEnabledSkillFile('plain', '../other')).rejects.toThrow()
```
- [ ] **Step 2: 运行 `corepack pnpm exec vitest run apps/agent-runtime/tests/agent-file-store.test.ts apps/agent-runtime/tests/skill-declaration.test.ts`，确认新断言失败。**
- [ ] **Step 3: 用可靠 YAML 解析器与 schema 代替手写 frontmatter 解析，沿用路径 realpath 校验。**新安装要求合法 `SKILL.md`；既有无 frontmatter 文件继续可读。`available` 取决于声明有效性，不取决于 executor 是否注册；Agent 读取只允许已启用 Skill 内的文本。
```ts
const enabled = (await this.listSkills()).filter((skill) => skill.available && skill.enabled)
return enabled.map(({ id, description }) => ({ skillId: id, description }))
```
- [ ] **Step 4: 重跑定向测试与 `corepack pnpm --filter @actiondriver/agent-runtime typecheck`。**
- [ ] **Step 5: 仅暂存本 Task 文件与新增依赖锁文件并提交 `feat: enable instruction skills without executors`。**

### Task 3: 本地文件夹原子安装

**Files:**
- Create: `apps/agent-runtime/src/agent-files/skill-installer.ts`
- Modify: `apps/agent-runtime/src/agent-files/agent-file-store.ts`
- Test: `apps/agent-runtime/tests/skill-installer.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `InstallSkillInput`、Task 2 的声明解析。
- Produces: `installSkill(input: InstallSkillInput): Promise<AgentSkillSummaryDto>`；同一入口供 HTTP 和 Agent 工具调用。

- [ ] **Step 1: 写失败测试。**从临时源文件夹导入 `SKILL.md` 和 references；断言默认启用、复制快照、重名原目标未变。覆盖源目录等于目标、越界符号链接、过大文件、缺入口、复制中断，断言没有临时目录残留。
```ts
const installed = await installer.installSkill({ source: 'local', path: sourceDir })
expect(installed).toMatchObject({ id: 'plain', source: 'local', available: true })
await expect(installer.installSkill({ source: 'local', path: sourceDir })).rejects.toThrow('已存在')
```
- [ ] **Step 2: 运行 `corepack pnpm exec vitest run apps/agent-runtime/tests/skill-installer.test.ts`，确认缺少服务而失败。**
- [ ] **Step 3: 实现目录扫描、文件数/总字节数上限、符号链接拒绝、入口校验与目标同级临时目录复制。**目标名称只来自通过目录 id 校验的 Skill 名称；写入来源元数据后原子 rename，异常时清理临时目录；源文件夹始终不被修改。
```ts
const staging = join(skillsRoot, `.install-${randomUUID()}`)
try { await copyValidated(sourceDir, staging); await rename(staging, destination) }
finally { await rm(staging, { recursive: true, force: true }) }
```
- [ ] **Step 4: 重跑安装测试和文件服务测试；确认失败后重新安装同一 id 可成功。**
- [ ] **Step 5: 仅暂存本 Task 文件并提交 `feat: install local instruction skills atomically`。**

### Task 4: GitHub 子目录安装

**Files:**
- Create: `apps/agent-runtime/src/agent-files/skill-source.ts`
- Modify: `apps/agent-runtime/src/agent-files/skill-installer.ts`
- Test: `apps/agent-runtime/tests/skill-source.test.ts`, `skill-installer.test.ts`

**Interfaces:**
- Consumes: Task 3 的 `installSkill(input)` 及其统一校验/提交逻辑。
- Produces: `fetchGithubSkill(url: string, destination: string, signal?: AbortSignal): Promise<void>`，只产生待校验临时目录，不直接写正式 Skill 根目录。

- [ ] **Step 1: 写失败测试。**URL 解析覆盖仓库根和 `/tree/<ref>/<subdir>`；无效主机、空子目录、相对越界均拒绝。以本地 HTTP/Git fixture 验证成功、公有下载错误、认证回退与中断清理，不依赖真实 GitHub 网络。
```ts
expect(parseGithubSkillUrl('https://github.com/acme/tools/tree/main/skills/review')).toEqual({ owner: 'acme', repo: 'tools', ref: 'main', subdir: 'skills/review' })
```
- [ ] **Step 2: 运行 `corepack pnpm exec vitest run apps/agent-runtime/tests/skill-source.test.ts apps/agent-runtime/tests/skill-installer.test.ts`，确认失败。**
- [ ] **Step 3: 实现 GitHub 来源获取到临时目录，公有下载失败时按设计使用本机 Git 认证做 sparse checkout。**路径解析后仅拷贝选定子目录；将内容交 Task 3 的统一校验，不执行仓库中的安装脚本，不持久化凭据。
- [ ] **Step 4: 重跑定向测试与 Runtime typecheck；断言 GitHub 重名/失败没有覆盖本地 Skill。**
- [ ] **Step 5: 仅暂存本 Task 文件并提交 `feat: install GitHub skill subdirectories`。**

### Task 5: 任务发现与按需读取工具

**Files:**
- Modify: `apps/agent-runtime/src/stream-session-service.ts`, `runtime-process.ts`, `apps/agent-runtime/src/service/http-service.ts`
- Create: `apps/agent-runtime/src/agent-files/runtime-tools.ts`
- Test: `apps/agent-runtime/tests/stream-session-service.test.ts`, `runtime-process.test.ts`, `service-http.test.ts`, `skill-runtime-tools.test.ts`

**Interfaces:**
- Consumes: Task 2 的 `listEnabledSkillDescriptions()` 与 `readEnabledSkillFile()`，Task 3/4 的 `installSkill()`。
- Produces: Tool Registry 中的 `skill_read`（`{ skillId, path? }`）和 `skill_install`（Task 1 的安装来源输入）；HTTP `POST /agent-files/skills/install`。

- [ ] **Step 1: 写失败测试。**新任务发现已启用 Skill、停用 Skill 不进入任务；同任务创建后停用时 `skill_read` 拒绝；读取 references、路径越界和输出上限；`skill_install` 的结果在 HTTP 列表可见，Tool Policy 未授权调用失败。
```ts
expect(graphRequest.skills).toContainEqual({ skillId: 'plain', description: 'Helps' })
await files.setSkillEnabled('plain', false)
await expect(readTool({ skillId: 'plain' })).rejects.toThrow()
```
- [ ] **Step 2: 运行四个定向测试文件，确认真实 Runtime 仍给出空 Skill 列表。**
- [ ] **Step 3: 将 `StreamSessionService` 的固定空数组改为目录服务快照，将 `skill_read`/`skill_install` 作为普通受控工具注册并接 HTTP 安装路由。**新任务使用同一目录事实来源；模型可见摘要不含正文，按需读取再校验启用状态。
- [ ] **Step 4: 重跑定向测试，确认 Skill Markdown 指令不能扩大 Registry grants，且恢复旧任务不会重放安装。**
- [ ] **Step 5: 仅暂存本 Task 文件并提交 `feat: expose enabled skills to agent tasks`。**

### Task 6: 设置页安装与详情管理

**Files:**
- Modify: `apps/desktop/src/renderer/src/models/agent-files.ts`, `services/runtime-agent-files.ts`, `services/desktop-agent-files.ts`, `services/mock-agent-files.ts`, `pages/SkillsPage.tsx`, `styles/settings.css`
- Modify: `apps/desktop/src/main/index.ts`, `apps/desktop/src/preload/desktop-api.ts`
- Test: `apps/desktop/src/renderer/src/pages/AgentSettingsPages.test.tsx`, `services/runtime-agent-files.test.ts`, `services/mock-agent-files.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `InstallSkillInput`、Task 5 的 HTTP 安装路由。
- Produces: `AgentFilesService.installSkill(input: InstallSkillInput): Promise<AgentSkillSummary>`；桌面桥 `chooseSkillFolder(): Promise<string | null>`、`revealSkillFolder(skillId: string): Promise<void>`；设置页添加菜单和详情状态。

- [ ] **Step 1: 写失败 UI/服务测试。**“添加”可选择 GitHub URL 或本地文件夹，安装成功即时列出来源，错误可见；开关、Markdown、附属文件、复制、打开目录和卸载仍可用；键盘能触达操作。
```tsx
await user.click(screen.getByRole('button', { name: '添加 Skill' }))
await user.click(screen.getByRole('menuitem', { name: '从 GitHub 安装' }))
expect(await screen.findByText('GitHub')).toBeVisible()
```
- [ ] **Step 2: 运行 `corepack pnpm exec vitest run apps/desktop/src/renderer/src/pages/AgentSettingsPages.test.tsx apps/desktop/src/renderer/src/services/runtime-agent-files.test.ts`，确认失败。**
- [ ] **Step 3: 为运行时/Mock 服务增加同构安装方法，接入现有 SkillsPage 状态与样式。**Desktop Main 通过 `dialog.showOpenDialog({ properties: ['openDirectory'] })` 返回本地来源路径；通过固定根目录和合法 skillId 调用 `shell.showItemInFolder`，Renderer 不接收任意文件系统能力。GitHub 输入 URL；安装后失效化现有 `['skills']` 查询，卸载仅触及应用管理目录。
- [ ] **Step 4: 重跑 UI 与服务测试、`corepack pnpm --filter @actiondriver/desktop typecheck`；手动检查列表/详情间距和焦点。**
- [ ] **Step 5: 仅暂存本 Task 文件并提交 `feat: manage installed skills in settings`。**

### Task 7: 进程执行器接收 stdin 源码

**Files:**
- Modify: `apps/agent-runtime/src/execution/process-runner.ts`
- Test: `apps/agent-runtime/tests/process-runner.test.ts`

**Interfaces:**
- Produces: `ProcessSpec` 新增必填 `stdin: string`；`runProcess(spec, signal)` 返回既有 `ToolExecutorEvent` 流。
- Consumes: 现有 AbortSignal、字节输出上限和进程组终止逻辑。

- [ ] **Step 1: 写失败测试。**用当前 Node 从 stdin 读源码，验证 stdout；覆盖空/大输入、进程提前退出、写入背压中取消、非零退出和输出超限仍能终止。
```ts
const result = await collect(runProcess({ ...baseSpec, args: ['-'], stdin: 'console.log("stdin-ok")' }))
expect(JSON.stringify(result)).toContain('stdin-ok')
```
- [ ] **Step 2: 运行 `corepack pnpm exec vitest run apps/agent-runtime/tests/process-runner.test.ts`，确认 stdin 测试失败。**
- [ ] **Step 3: 将 spawn 的 stdin 改为 pipe，按背压状态写入源码并关闭流；输入大小超限在 spawn 前失败。**写入错误与子进程 close 竞争只结算一次；Abort 期间停止写入并沿用进程组 SIGTERM/SIGKILL。
```ts
stdio: ['pipe', 'pipe', 'pipe']
// writeSource(child.stdin, spec.stdin, signal) resolves on finish or rejects on error/abort
```
- [ ] **Step 4: 重跑进程测试与 Runtime typecheck；确认取消没有悬挂句柄。**
- [ ] **Step 5: 仅暂存本 Task 文件并提交 `feat: stream script source to process stdin`。**

### Task 8: 四个独立脚本工具

**Files:**
- Modify: `apps/agent-runtime/src/execution/tools.ts`, `runtime-process.ts`, `tool-activity.ts`, `apps/desktop/src/renderer/src/components/ActivityTimeline.tsx`
- Test: `apps/agent-runtime/tests/script-tools.test.ts`, `runtime-process.test.ts`, `apps/desktop/src/renderer/src/components/ActivityTimeline.test.tsx`

**Interfaces:**
- Consumes: Task 7 的 `ProcessSpec.stdin`。
- Produces: 四个 `ToolDefinition`，版本 `2`，输入 `script: string`、`args?: string[]`；`ts_run` 使用包内 Node 类型擦除模式。

- [ ] **Step 1: 写失败测试。**四个工具定义恰好包含 `script` 和 `args`；`command`/`code`/`file` 及空白脚本在 spawn 前拒绝；Shell 管道、Python 标准库、Node 内建模块、TS 可擦除标注均产生输出。enum 脚本失败且不调用系统 `tsc`；活动列表出现 TypeScript 标题，旧记录只读。
```ts
expect(tools.map((tool) => tool.definition.modelName)).toEqual(['shell_run', 'python_run', 'node_run', 'ts_run'])
expect(JSON.stringify(await collect(tsTool, { script: 'const n: number = 2; console.log(n)' }))).toContain('2')
```
- [ ] **Step 2: 运行三个定向测试文件，确认新工具/输入断言失败。**
- [ ] **Step 3: 升级三个旧模型定义到版本 2，新增 `ts_run`；全部走 Task 7 的 stdin。**Shell 用 `/bin/zsh -s`，Python 用包内 `python3 -`，Node 用包内 Node stdin 模式，TS 用包内 Node `--input-type=module-typescript`；输入 schema `additionalProperties: false`，工具名称和活动标题同步。
- [ ] **Step 4: 重跑定向测试，补充旧版本活动记录重开不重放断言，再跑 Runtime 和 Desktop typecheck。**
- [ ] **Step 5: 仅暂存本 Task 文件并提交 `feat: run four inline script tools`。**

### Task 9: 集成与发布验收

**Files:**
- Modify: `apps/desktop/e2e/tool-runtime.spec.ts`, `packaged-runtime.spec.ts`, `support/fake-openai-tool-server.ts`, `real-tool-smoke.spec.ts`
- Modify: `apps/desktop/e2e/interaction-contracts.json`（仅当新增 UI 操作需要稳定 selector）
- Test: 上述 E2E 与受影响的 Runtime、contracts、desktop 测试。

**Interfaces:**
- Consumes: Tasks 1–8 的端到端能力；不新增公开接口。
- Produces: 两架构包内运行时、离线脚本与 Skill 安装/发现的可复现验收结果。

- [ ] **Step 1: 写失败端到端场景。**从本地文件夹和 GitHub fixture 安装 Skill，开启新任务检查摘要、按需读取正文、停用后不发现；四种脚本各执行一次，重开旧记录不再执行；打包环境屏蔽系统 Python/Node 与网络仍运行包内脚本。
- [ ] **Step 2: 跑受影响 E2E 定向命令，确认 fixture/接口待接通处失败。**`corepack pnpm exec playwright test apps/desktop/e2e/tool-runtime.spec.ts apps/desktop/e2e/packaged-runtime.spec.ts`。
- [ ] **Step 3: 更新模型 fixture 与交互契约；按可运行架构构建 `.app` 并执行 `corepack pnpm test:e2e:packaged:macos`。**另一架构至少校验包内二进制架构与路径，若 CI 提供对应架构则运行同一打包 E2E；记录当前机器未执行的架构限制。
- [ ] **Step 4: 运行 `corepack pnpm typecheck`、`corepack pnpm lint`、`corepack pnpm test`、`corepack pnpm build`、`corepack pnpm exec openspec validate install-instruction-skills-and-run-inline-scripts --strict`、`git diff --check`；只对实际失败或剩余风险扩展测试。**
- [ ] **Step 5: 对照 OpenSpec 全部场景标记 tasks 完成，提交本任务改动；完成验证后按 `openspec-archive-change` 归档变更，保留其他工作区修改。**
