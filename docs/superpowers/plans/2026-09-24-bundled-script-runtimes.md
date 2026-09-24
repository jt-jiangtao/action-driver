# Bundled Script Runtimes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 macOS arm64/x64 应用内提供 `shell_run`、`python_run`、`node_run` 三个工具，并让用户无需安装 Python/Node 即可离线执行标准库代码。

**Architecture:** 三个模型工具保有各自的 schema 和活动标题，共用 Agent Runtime 内的子进程执行器。Shell 使用系统 zsh；Python/Node 从 Agent Runtime 部署树中解析固定架构的包内解释器。构建阶段校验并复制二进制，运行阶段不下载、不回退宿主机解释器。

**Tech Stack:** TypeScript、Node.js child_process、Electron UtilityProcess、Vitest、Playwright、OpenSpec。

**Spec:** [设计文档](../specs/2026-09-24-bundled-script-runtimes-design.md)，[OpenSpec 变更](../../../openspec/changes/add-bundled-script-runtimes/design.md)。

## Global Constraints

- 模型接口恰好是三个独立工具：`shell_run`、`python_run`、`node_run`。
- 首版只支持 macOS arm64/x64；Python 和 Node 只从应用包内运行，不依赖用户 PATH，不在用户执行时下载。
- 离线保证限于 Python 标准库和 Node 内建模块；不保证任意第三方 `pip`/`npm` 包。
- Shell 使用 macOS zsh，默认工作目录为当前工作区；随包 `rg` 继续可作为普通终端命令调用。
- 旧 `sandbox_shell_run` 不再注册；旧活动记录只读保留，不自动重放。
- 通用执行可以写文件和联网；保留进程取消、超时与输出上限。
- 用户要求直接在 `main` 工作；不要创建功能分支或工作树。

## Review Focus

- 用户 PATH 中没有 Python/Node，甚至放入同名假解释器：专用工具仍必须启动包内二进制。Task 1、Task 3、Task 5 测试。
- `code`/`file` 两者都给或都不给：在创建进程前得到 `TOOL_INPUT_INVALID`。Task 3 测试。
- 输出跨 UTF-8 字节边界或超过上限：正文不能损坏，子进程必须结束。Task 2 测试。
- 取消/超时发生在进程已产生子进程后：进程树终止，工具不得显示成功。Task 2、Task 5 测试。
- 升级后旧 `sandbox.shell.run@1` 历史仍可查看，但新请求不能调用或重试。Task 3、Task 4 测试。

---

## File Map

| 文件                                                            | 职责                                   |
| --------------------------------------------------------------- | -------------------------------------- |
| `apps/agent-runtime/scripts/runtime-lock.json`                  | 固定两架构 Python/Node 归档及 SHA-256  |
| `apps/agent-runtime/scripts/stage-runtimes.mjs`                 | 构建时下载、校验、解包及架构目录整理   |
| `apps/agent-runtime/src/execution/runtime-paths.ts`             | 根据部署树解析包内解释器与 PATH        |
| `apps/agent-runtime/src/execution/process-runner.ts`            | 子进程事件、输出上限、取消与进程树终止 |
| `apps/agent-runtime/src/execution/tools.ts`                     | 三个工具定义、输入和调用参数映射       |
| `apps/agent-runtime/src/sandbox/index.ts`                       | 保留文件工具，移除旧 Shell 注册        |
| `apps/agent-runtime/src/runtime-process.ts`                     | 注册/授予新工具                        |
| `apps/agent-runtime/src/tool-activity.ts`                       | 三种工具的状态标题和摘要               |
| `apps/desktop/src/renderer/src/components/ActivityTimeline.tsx` | 新工具图标与可展开输入输出             |
| `apps/desktop/e2e/support/fake-openai-tool-server.ts`           | 三种工具的模型响应 fixture             |
| `scripts/test-packaged-macos.mjs`                               | 把包内运行时放入 `.app` 并启动冒烟测试 |
| `apps/desktop/e2e/packaged-runtime.spec.ts`                     | 无宿主机解释器的打包执行验证           |

### Task 1: 固定并打包两架构解释器

**Files:**

- Create: `apps/agent-runtime/scripts/runtime-lock.json`
- Create: `apps/agent-runtime/scripts/stage-runtimes.mjs`
- Create: `apps/agent-runtime/tests/runtime-staging.test.ts`
- Modify: `apps/agent-runtime/package.json`

**Interfaces:**

- Produces: `apps/agent-runtime/dist/runtimes/darwin-<arch>/python/bin/python3` 与 `apps/agent-runtime/dist/runtimes/darwin-<arch>/node/bin/node`。
- Consumed by: Task 2 的 `resolveExecutionRuntimePaths(runtimeDist, arch)`。

- [ ] **Step 1: 写失败测试，覆盖锁定清单、缺失架构和错误摘要。**测试调用导出的 `runtimeArtifactFor('darwin','arm64')` 和 `verifySha256(buffer, expected)`；断言 `x64` 也有项，篡改内容抛出 `RUNTIME_ARCHIVE_CHECKSUM_MISMATCH`。另以生成的临时 tar fixture 验证解包后恰有 `python/bin/python3` 或 `node/bin/node`。

```ts
expect(runtimeArtifactFor('darwin', 'arm64').python.file).toContain('aarch64-apple-darwin')
expect(runtimeArtifactFor('darwin', 'x64').node.file).toContain('darwin-x64')
expect(() => verifySha256(Buffer.from('tampered'), '0'.repeat(64))).toThrow(
  'RUNTIME_ARCHIVE_CHECKSUM_MISMATCH'
)
```

- [ ] **Step 2: 运行 `corepack pnpm exec vitest run apps/agent-runtime/tests/runtime-staging.test.ts`，确认缺少模块时失败。**
- [ ] **Step 3: 写锁定清单与构建脚本。**Python 固定为 `python-build-standalone` 的 `20260901` 发布、CPython `3.13.15`：arm64 SHA-256 `b9054a9d3d54f4cb5573d44907fddb29874b08909bde73f29f2868cf872223ee`，x64 `49f0d97f506b855eed60b74a8ac138595c5b39799a6aa5e0d7ca8abe1019a4d4`。Node 固定为官方 `v22.22.1`：arm64 `679ad4966339e4ef4900f57996714864e4211b898825bb840c3086c419fbcef2`，x64 `07b13722d558790fca20bb1ecf61bde24b7a4863111f7be77fc57251a407359a`。归档 URL 分别来自 `github.com/astral-sh/python-build-standalone/releases/download/20260901/` 和 `nodejs.org/dist/v22.22.1/`；构建脚本仅在校验后用 `tar` 解包到临时目录，再原子移动至目标目录，构建失败绝不调用宿主机解释器。把 stage 命令加入 Runtime `build` 的后段，保留 `copy-rg.mjs`。

```js
const digest = createHash('sha256').update(archiveBytes).digest('hex')
if (digest !== artifact.sha256) throw new Error('RUNTIME_ARCHIVE_CHECKSUM_MISMATCH')
// staging target: dist/runtimes/darwin-${process.arch}/{python,node}/
```

- [ ] **Step 4: 重跑 Task 1 测试和 `corepack pnpm --filter @actiondriver/agent-runtime build`，确认两种运行时存在且版本正确。**当前机器只执行当前架构；另一个架构需至少检查锁定归档和 Mach-O 架构头。
- [ ] **Step 5: 提交 Task 1 文件，提交信息 `build: bundle pinned Python and Node runtimes`。**

### Task 2: 解析包内路径并统一进程生命周期

**Files:**

- Create: `apps/agent-runtime/src/execution/runtime-paths.ts`
- Create: `apps/agent-runtime/src/execution/process-runner.ts`
- Create: `apps/agent-runtime/tests/execution-runtime-paths.test.ts`
- Create: `apps/agent-runtime/tests/process-runner.test.ts`

**Interfaces:**

- Consumes: Task 1 的 `dist/runtimes/darwin-<arch>` 目录。
- Produces: `resolveExecutionRuntimePaths(runtimeDist: string, arch: NodeJS.Architecture): Promise<{ python: string; node: string; rg: string; path: string }>`；`runProcess(spec: ProcessSpec, signal?: AbortSignal): AsyncIterable<ToolExecutorEvent>`。
- `ProcessSpec` 字段：`executable: string`、`args: string[]`、`cwd: string`、`env: NodeJS.ProcessEnv`、`maxOutputBytes: number`。

- [ ] **Step 1: 写失败测试。**路径测试在临时部署树建立假二进制；缺少 Python 时断言 `BUNDLED_PYTHON_UNAVAILABLE`，即使 PATH 存在系统 `python3` 也不得回退。进程测试用 `process.execPath` 的 `-e` 脚本验证 stdout/stderr、非零退出、拆分 UTF-8 字节、超限、AbortSignal 取消，以及子进程树终止。

```ts
await expect(resolveExecutionRuntimePaths(emptyDist, 'arm64')).rejects.toThrow(
  'BUNDLED_PYTHON_UNAVAILABLE'
)
const events = await collect(
  runProcess({
    executable: process.execPath,
    args: ['-e', 'process.stdout.write("ok")'],
    cwd: workspace,
    env: {},
    maxOutputBytes: 1024
  })
)
expect(events).toContainEqual({ kind: 'content', stream: 'stdout', delta: 'ok' })
```

- [ ] **Step 2: 运行两个测试文件，确认路径解析和进程执行接口缺失。**
- [ ] **Step 3: 实现路径解析与 `runProcess`。**从 Runtime 入口所在 `dist` 解析包内绝对路径；PATH 顺序为包内 Python、Node、`rg`，再接 `/usr/bin:/bin`。用 `spawn(executable,args,{ shell:false, detached:true,cwd,env,stdio:['ignore','pipe','pipe'] })`；按 Buffer 字节数限制输出，用 `StringDecoder` 保留跨 chunk UTF-8 字符；Abort 时发送进程组 SIGTERM，短延迟后 SIGKILL，等待 close 才结束迭代。非零退出抛出包含退出码的错误；正常结束产生 `{ kind:'result', output:{ exitCode, byteLength } }`。

```ts
export type ProcessSpec = {
  executable: string
  args: string[]
  cwd: string
  env: NodeJS.ProcessEnv
  maxOutputBytes: number
}
const child = spawn(spec.executable, spec.args, {
  shell: false,
  detached: true,
  cwd: spec.cwd,
  env: spec.env,
  stdio: ['ignore', 'pipe', 'pipe']
})
signal?.addEventListener(
  'abort',
  () => {
    if (child.pid) process.kill(-child.pid, 'SIGTERM')
  },
  { once: true }
)
```

- [ ] **Step 4: 重跑两个测试文件与 Runtime 类型检查，确认进程组没有在测试清理后存活。**
- [ ] **Step 5: 提交 Task 2 文件，提交信息 `feat: add shared script process runner`。**

### Task 3: 注册三个模型工具并退出旧白名单

**Files:**

- Create: `apps/agent-runtime/src/execution/tools.ts`
- Create: `apps/agent-runtime/tests/script-tools.test.ts`
- Modify: `apps/agent-runtime/src/sandbox/index.ts`
- Modify: `apps/agent-runtime/src/runtime-process.ts`
- Modify: `apps/agent-runtime/tests/runtime-process.test.ts`
- Remove: `apps/agent-runtime/src/sandbox/shell-tool.ts`
- Replace: `apps/agent-runtime/tests/sandbox-shell-tool.test.ts`

**Interfaces:**

- Consumes: Task 2 的 `resolveExecutionRuntimePaths`、`runProcess`。
- Produces: `createScriptTools(options: { workspaceRoot: string; runtimeDist: string; arch: NodeJS.Architecture }): Promise<RegisteredTool[]>`，每项含 `definition` 和 `executor`。
- 模型名称固定：`shell_run`、`python_run`、`node_run`；工具 id 固定：`local.shell.run@1`、`local.python.run@1`、`local.node.run@1`。

- [ ] **Step 1: 写失败测试。**模型发现列表恰含三个新名称且无 `sandbox_shell_run`；Shell 可运行管道/重定向；Python/Node `code`、`file`、`args` 可执行；两者同时提供或都缺失产生 `TOOL_INPUT_INVALID` 且模拟 `spawn` 调用次数为 0；旧历史快照重开不重新执行。

```ts
expect(registry.list().map((tool) => tool.modelName)).toEqual(
  expect.arrayContaining(['shell_run', 'python_run', 'node_run'])
)
expect(registry.list().map((tool) => tool.modelName)).not.toContain('sandbox_shell_run')
```

- [ ] **Step 2: 运行 `script-tools.test.ts` 与 `runtime-process.test.ts`，确认新工具尚未注册。**
- [ ] **Step 3: 定义三个工具并接入 Runtime。**Shell 通过 `/bin/zsh -lc <command>`；Python 通过包内 `python3 -c <code>` 或 `python3 <file>`；Node 通过包内 `node -e <code>` 或 `node <file>`。Python/Node JSON Schema 顶层为 `type:'object'`，`oneOf` 的两个完整对象分支分别要求 `code` 或 `file`、`additionalProperties:false`；不要使用 `not`，当前 Zod 转换器不支持。三个定义声明 `filesystem:'write'`、`network:true`，`timeoutMs:120000`，执行器的输出上限为 1 MiB。`createSandboxTools` 仅返回原文件工具；`runtime-process.ts` 注册文件工具与新脚本工具，并授予新 id。删除旧 Shell 实现与其白名单测试。

```ts
const stringArray = { type: 'array', items: { type: 'string' } }
const scriptInputSchema = {
  type: 'object',
  oneOf: [
    {
      type: 'object',
      properties: { code: { type: 'string', minLength: 1 }, args: stringArray },
      required: ['code'],
      additionalProperties: false
    },
    {
      type: 'object',
      properties: { file: { type: 'string', minLength: 1 }, args: stringArray },
      required: ['file'],
      additionalProperties: false
    }
  ]
}
```

- [ ] **Step 4: 运行 Runtime 工具/进程/恢复测试和 `corepack pnpm --filter @actiondriver/agent-runtime typecheck`；确认 `z.fromJSONSchema` 在真实调用链中拒绝歧义输入。**
- [ ] **Step 5: 提交 Task 3 文件，提交信息 `feat: expose shell Python and Node tools`。**

### Task 4: 活动标题与桌面工具流程

**Files:**

- Modify: `apps/agent-runtime/src/tool-activity.ts`
- Modify: `apps/agent-runtime/tests/tool-activity-title.test.ts`
- Modify: `apps/desktop/src/renderer/src/components/ActivityTimeline.tsx`
- Modify: `apps/desktop/src/renderer/src/components/ActivityTimeline.test.tsx`
- Modify: `apps/desktop/e2e/support/fake-openai-tool-server.ts`
- Modify: `apps/desktop/e2e/tool-runtime.spec.ts`

**Interfaces:**

- Consumes: Task 3 的三个 id 和模型名称；活动工具协议不新增字段。
- Produces: 状态标题、图标、可展开命令/代码与受限 stdout/stderr；历史旧 id 仍可渲染。

- [ ] **Step 1: 写失败测试。**新工具运行/完成/失败/取消状态分别显示“正在执行命令”“已运行 Python”“Node.js 执行失败”等准确标题；Python/Node 活动行使用终端图标及代码/文件摘要。历史 `sandbox.shell.run@1` 快照可展开且不会显示审批控件。桌面 fixture 分别让模型请求三个工具，确认工具结果回到模型、最终正文没有过程文本。

```ts
expect(toolActivityTitle('local.python.run', { code: 'print(1)' }, 'running')).toContain('Python')
expect(screen.getByText(/Node.js/).closest('.activity-tool')).toHaveClass('is-completed')
```

- [ ] **Step 2: 运行标题、组件和工具流程 E2E，确认新 id 尚未映射。**
- [ ] **Step 3: 实现 Runtime 标题与 Renderer 展示。**按 id 显示 Shell/Python/Node，不把整段代码放进一行标题；原始输入输出仍只放可展开详情。更新 fake provider 的旧 `sandbox_shell_run` fixture 为 `shell_run` 和 `{command:'rg needle README.md'}`，将 timeout 场景改为 `sleep 12`；保留单独历史旧 id 组件 fixture。
- [ ] **Step 4: 重跑受影响单元测试及 `corepack pnpm exec playwright test apps/desktop/e2e/tool-runtime.spec.ts`，确认三种调用顺序与任务组默认折叠规则兼容。**
- [ ] **Step 5: 提交 Task 4 文件，提交信息 `feat: show script tool activity`。**

### Task 5: 打包应用验证与收尾

**Files:**

- Modify: `scripts/test-packaged-macos.mjs`
- Modify: `apps/desktop/e2e/packaged-runtime.spec.ts`
- Modify: `apps/agent-runtime/tests/package-build.test.ts`
- Modify: `openspec/changes/add-bundled-script-runtimes/tasks.md`

**Interfaces:**

- Consumes: Task 1 的运行时部署目录、Task 3 的模型工具、Task 4 的桌面 fixture。
- Produces: 可复验的 macOS `.app` 冒烟结果及已勾选的 OpenSpec 任务。

- [ ] **Step 1: 扩展打包 E2E（先失败）。**构造清理用户 HOME、PATH 只含 `/usr/bin:/bin` 的 Electron 启动环境；在打包 `.app` 中调用三种工具。Python 输出 `sys.executable` 并导入 `json`，Node 输出 `process.execPath` 并导入 `node:fs`；断言路径以当前 `.app/Contents/Resources/agent-runtime/dist/runtimes/` 开头。Shell 使用管道与 `rg`；追加取消阻塞脚本和非零退出测试。

```ts
expect(pythonExecutable).toContain(
  '/ActionDriver.app/Contents/Resources/agent-runtime/dist/runtimes/'
)
expect(nodeExecutable).toContain(
  '/ActionDriver.app/Contents/Resources/agent-runtime/dist/runtimes/'
)
expect(shellOutput).toContain('needle')
```

- [ ] **Step 2: 运行 `corepack pnpm test:e2e:packaged:macos`，确认未复制运行时时失败。**
- [ ] **Step 3: 调整部署脚本。**确保 Runtime `dist/runtimes` 与 `dist/bin/rg` 在 `pnpm deploy --prod` 后进入 `.app`；若 deploy 过滤构建产物，显式从已校验的构建目录复制，不从用户 PATH 或系统安装处取文件。打包测试运行前检查二进制 Mach-O 架构与可执行位。按目标机器架构生成对应 `.app`，在每个可用架构运行冒烟。
- [ ] **Step 4: 运行 `corepack pnpm check`、`corepack pnpm exec playwright test apps/desktop/e2e/tool-runtime.spec.ts`、`corepack pnpm test:e2e:packaged:macos`、`corepack pnpm exec openspec validate add-bundled-script-runtimes --strict` 和 `git diff --check`；逐项将 `tasks.md` 勾选。**若当前机器不能运行另一个架构，记录该架构只完成静态包检查，不能声称跨架构运行验证。
- [ ] **Step 5: 提交剩余文件，提交信息 `test: verify bundled script runtimes in packaged app`，确认 `main` 工作树清洁。**
