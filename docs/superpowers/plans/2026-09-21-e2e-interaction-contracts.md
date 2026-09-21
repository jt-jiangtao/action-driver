# E2E Interaction Contracts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为桌面端全部用户可交互元素建立路由式测试 ID、显式测试覆盖契约和不可绕过的 AST 打包门禁。

**Architecture:** 使用 TypeScript Compiler API 扫描 renderer TSX，识别原生交互节点、交互 role、contenteditable 和受控共享组件。静态 ID 直接解析，动态 ID 必须通过 `e2eId(pattern, params)` 构造；清单将每个 ID 或模式分类为 `functional` 或 `visual-only`，AST 校验负责源码与清单闭合，Playwright 负责实际 DOM 唯一性和可见性。

**Tech Stack:** TypeScript 5.9 Compiler API、Node.js ESM、React 19、Vitest 3、Testing Library、Playwright Electron、pnpm 12。

**Spec:** `docs/superpowers/specs/2026-09-21-e2e-interaction-contracts-design.md`；OpenSpec：`openspec/changes/enforce-e2e-interaction-contracts/`。

## Global Constraints

- 测试 ID 格式固定为 `e2e/<route>/<scope>/<target>#<type>`，路径段使用英文小写 kebab-case。
- 所有按钮、链接、输入框、select、textarea、summary、contenteditable、交互 role 和登记的共享交互组件都必须覆盖；disabled 不是豁免条件。
- 动态 ID 只能使用批准的 `e2eId(pattern, params)`，参数值必须来自稳定业务 ID，不能来自数组下标或可变文案。
- `functional` 必须引用验证实际用户可观察结果的测试；`visual-only` 只验证存在、可见、唯一和契约合规。
- Lint 与 Desktop `prebuild` 必须调用同一个 AST 校验入口；不得增加生产运行时依赖。
- 使用 Corepack 提供的 pnpm 12.4.1，禁止调用系统中旧的 pnpm 6。

## Review Focus

- JSX 展开属性或包装组件不得绕过必填测试 ID；Task 1 fixture 必须覆盖这两类输入。
- 条件菜单和弹窗只有打开后才存在；Task 4 的状态遍历必须覆盖所有既有 Home、Task、Settings 场景。
- 同一个组件渲染多个动态条目时 ID 必须唯一；Task 2 和 Task 4 分别做静态模式与运行时 DOM 检查。
- `disabled`、`visual-only` 和尚未绑定 `onClick` 的按钮仍必须进入清单；Task 3 全量迁移与 Task 4 通用断言必须覆盖。
- 构建脚本可能从根目录或 `apps/desktop` 执行；Task 5 必须分别验证两条入口都被门禁阻断。

---

### Task 1: 测试 ID 语法与 AST 扫描核心

**Files:**
- Create: `apps/desktop/src/renderer/src/testing/e2e-id.ts`
- Create: `scripts/e2e-interactions/validator.mjs`
- Create: `scripts/e2e-interactions/validator.test.ts`
- Create: `scripts/e2e-interactions/fixtures/valid.tsx`
- Create: `scripts/e2e-interactions/fixtures/missing-id.tsx`
- Create: `scripts/e2e-interactions/fixtures/invalid-dynamic-id.tsx`

**Interfaces:**
- Produces: `e2eId(pattern: string, params: Readonly<Record<string, string>>): string`。
- Produces: `validateInteractionSources(options): ValidationResult`，其中 `ValidationResult` 含 `errors: ValidationError[]`，错误含 `file`、`line`、`column`、`code`、`message`。
- Produces: `InteractionReference`，区分静态 `id` 和动态 `pattern`。

- [ ] **Step 1: 编写 ID 和 AST 规则失败测试**

```ts
it('reports a clickable button without a test id', () => {
  const result = validateFixture('missing-id.tsx')
  expect(result.errors).toContainEqual(expect.objectContaining({ code: 'missing-test-id', line: 1 }))
})

it('rejects dynamic expressions that do not call e2eId', () => {
  const result = validateFixture('invalid-dynamic-id.tsx')
  expect(result.errors).toContainEqual(expect.objectContaining({ code: 'unapproved-dynamic-id' }))
})
```

- [ ] **Step 2: 运行测试并确认 RED**

Run: `corepack pnpm vitest run scripts/e2e-interactions/validator.test.ts`

Expected: FAIL，原因是 validator 和 `e2eId` 尚不存在，而不是 fixture 解析错误。

- [ ] **Step 3: 实现最小 AST 扫描与动态构造器**

```ts
export function e2eId(pattern: string, params: Readonly<Record<string, string>>): string {
  return Object.entries(params).reduce(
    (value, [name, replacement]) => value.replace(`:${name}`, encodeURIComponent(replacement)),
    pattern
  )
}
```

Validator 必须识别原生交互标签、`contentEditable`、受控 role 和初始共享组件集合；所有 `data-testid` 都校验路由格式，动态表达式只接受第一参数为字符串字面量的 `e2eId(...)`。

- [ ] **Step 4: 补充展开属性、disabled、条件 JSX、重复静态 ID 和普通容器 fixture**

Run: `corepack pnpm vitest run scripts/e2e-interactions/validator.test.ts`

Expected: PASS；普通 `div` 不误报，disabled button、`role="menuitem"` 和 contenteditable 缺 ID 时均失败。

- [ ] **Step 5: 提交 AST 核心**

```bash
git add apps/desktop/src/renderer/src/testing scripts/e2e-interactions
git commit -m "test: add AST interaction validator core"
```

### Task 2: 交互契约清单与闭合校验

**Files:**
- Create: `apps/desktop/e2e/interaction-contracts.json`
- Create: `scripts/e2e-interactions/contracts.mjs`
- Modify: `scripts/e2e-interactions/validator.mjs`
- Modify: `scripts/e2e-interactions/validator.test.ts`
- Create: `scripts/e2e-interactions/fixtures/duplicate-contract.tsx`
- Create: `scripts/e2e-interactions/fixtures/unregistered.tsx`

**Interfaces:**
- Consumes: Task 1 的 `InteractionReference` 与 `ValidationError`。
- Produces: `loadInteractionContracts(path): InteractionContract[]`。
- Contract shape: `{ target: string, route: string, type: string, coverage: 'functional' | 'visual-only', testFile?: string, testName?: string }`。
- `target` 为完整静态 ID或带 `:param-name` 的动态模式。

- [ ] **Step 1: 编写清单闭合失败测试**

```ts
it('rejects an interaction missing from the contract manifest', () => {
  const result = validateFixture('unregistered.tsx', manifest())
  expect(result.errors).toContainEqual(expect.objectContaining({ code: 'unregistered-interaction' }))
})

it('requires functional contracts to reference a real named test', () => {
  const result = validateContracts([{ target: 'e2e/home/composer/send#button', coverage: 'functional' }])
  expect(result.errors).toContainEqual(expect.objectContaining({ code: 'missing-test-reference' }))
})
```

- [ ] **Step 2: 运行测试并确认 RED**

Run: `corepack pnpm vitest run scripts/e2e-interactions/validator.test.ts`

Expected: FAIL，原因是 manifest 加载和闭合校验尚未实现。

- [ ] **Step 3: 实现清单 schema、重复检查和测试引用检查**

实现必须检查 target 与 route/type 一致、静态 ID/动态模式唯一、源码引用都有契约、契约都有源码引用、`functional` 的 `testFile` 存在且包含 `testName`；`visual-only` 不要求业务断言引用。

- [ ] **Step 4: 验证动态模式与稳定参数**

新增 fixture 使用：

```tsx
data-testid={e2eId('e2e/shared/sidebar/tasks/:task-id#button', { 'task-id': task.id })}
```

Run: `corepack pnpm vitest run scripts/e2e-interactions/validator.test.ts`

Expected: PASS，并确认数组下标表达式和未登记模式失败。

- [ ] **Step 5: 提交交互清单基础**

```bash
git add apps/desktop/e2e/interaction-contracts.json scripts/e2e-interactions
git commit -m "test: enforce interaction contract registry"
```

### Task 3: 共享组件 API 与全页面测试 ID 迁移

**Files:**
- Modify: `apps/desktop/src/renderer/src/components/ui/IconButton.tsx`
- Modify: `apps/desktop/src/renderer/src/components/ui/TextButton.tsx`
- Modify: `apps/desktop/src/renderer/src/components/ui/Checkbox.tsx`
- Modify: `apps/desktop/src/renderer/src/components/ui/RadioOption.tsx`
- Modify: `apps/desktop/src/renderer/src/components/**/*.tsx`
- Modify: `apps/desktop/src/renderer/src/pages/*.tsx`
- Modify: `apps/desktop/src/renderer/src/**/*.test.tsx`
- Modify: `apps/desktop/src/renderer/src/styles/home.css`
- Modify: `apps/desktop/e2e/interaction-contracts.json`

**Interfaces:**
- Consumes: Task 1 的 `e2eId`。
- Shared interactive components receive required `testId: string` and forward it as `data-testid`。
- Every migrated target has exactly one Task 2 contract entry。

- [ ] **Step 1: 先把共享组件测试改为要求必填路由式 testId**

```tsx
render(<IconButton testId="e2e/shared/sidebar/search#button" icon="search" aria-label="搜索" />)
expect(screen.getByTestId('e2e/shared/sidebar/search#button')).toHaveAccessibleName('搜索')
```

Run: `corepack pnpm vitest run apps/desktop/src/renderer/src/components/ui/ui.test.tsx`

Expected: FAIL，现有共享组件尚未接受或强制 `testId`。

- [ ] **Step 2: 实现共享组件必填 testId 并保持可访问语义**

更新 `IconButton`、`TextButton`、`Checkbox`、`RadioOption` 及 validator 受控组件列表。运行 UI 测试与 desktop typecheck，Expected: PASS。

- [ ] **Step 3: 迁移 Shared 与 Home**

为侧栏、新任务、搜索、设置、最近任务、首页输入、添加、模型选择和发送加入契约。最近任务使用 `e2eId('e2e/shared/sidebar/tasks/:task-id#button', ...)`。运行 AST 校验，Expected: 该范围无 missing/unregistered 错误。

- [ ] **Step 4: 迁移 Task**

覆盖 Agent composer、浏览器尺寸、标签栏、导航栏、Skill 控制、模型 selector/option 和所有动态任务/模型目标。运行相关组件测试与 AST 校验，Expected: PASS。

- [ ] **Step 5: 迁移 Settings**

覆盖返回、搜索、导航、添加、连接卡片、模型 toggle、菜单、删除确认和两步弹窗全部状态。动态 connection/model 目标使用稳定业务 ID。运行 Settings 测试与 AST 校验，Expected: PASS。

- [ ] **Step 6: 消除旧命名并提交全量迁移**

Run: `rg -n "data-testid=\"(sidebar|home-composer|task-page|agent-panel|browser-panel-slot|settings-page|user-message|agent-response)\"" apps/desktop/src`

Expected: 无输出。随后运行 `corepack pnpm typecheck` 和 validator 测试并提交。

```bash
git add apps/desktop/src apps/desktop/e2e/interaction-contracts.json
git commit -m "refactor: migrate interactive elements to route test ids"
```

### Task 4: 功能行为与 visual-only 运行时覆盖

**Files:**
- Create: `apps/desktop/e2e/interaction-audit.ts`
- Modify: `apps/desktop/e2e/app.spec.ts`
- Modify: `apps/desktop/e2e/interaction-contracts.json`
- Modify: relevant `apps/desktop/src/renderer/src/**/*.test.tsx`

**Interfaces:**
- Produces: `auditRenderedInteractions(page, contracts): Promise<AuditResult>`。
- Audit result reports missing ID、invalid format、duplicate ID、unregistered target 和未渲染 visual-only target。
- Consumes manifest test references for functional coverage validation。

- [ ] **Step 1: 编写运行时审计失败测试**

在 E2E 中临时断言现有页面全部交互节点都有新格式 ID；运行单个测试，Expected: RED，直到 Task 3 所有状态入口都被遍历并登记。

- [ ] **Step 2: 实现 DOM 审计助手**

选择器覆盖：`button,a[href],input,select,textarea,summary,[contenteditable="true"],[role="button"],[role="link"],[role="menuitem"],[role="option"],[role="checkbox"],[role="radio"],[role="switch"],[role="tab"]`。验证当前 DOM 中 ID 存在、格式正确且唯一，并将动态实际值匹配到 manifest pattern。

- [ ] **Step 3: 覆盖全部视觉状态**

在既有 14 个 Figma 状态与 1024×700 场景中调用审计；打开模型菜单、连接菜单、删除确认和添加模型集各步骤后分别审计。Run: `corepack pnpm test:e2e`，Expected: PASS。

- [ ] **Step 4: 绑定 functional 测试引用并验证 visual-only**

每个 functional 条目引用现有或新增测试名；视觉占位按钮由通用审计验证存在与可见。运行 validator，Expected: 无 missing-test-reference、stale-contract 或 unseen-visual-only。

- [ ] **Step 5: 提交自动化覆盖**

```bash
git add apps/desktop/e2e apps/desktop/src/renderer/src
git commit -m "test: cover every desktop interaction contract"
```

### Task 5: Lint 与正式 Build 强门禁

**Files:**
- Create: `scripts/validate-e2e-interactions.mjs`
- Modify: `package.json`
- Modify: `apps/desktop/package.json`
- Modify: `openspec/changes/enforce-e2e-interaction-contracts/tasks.md`
- Create: `docs/testing/e2e-interaction-contracts.md`

**Interfaces:**
- Produces CLI: `node scripts/validate-e2e-interactions.mjs`，成功退出 0，任何契约错误退出非 0。
- Root script: `validate:e2e-interactions`。
- Root `lint` and Desktop `prebuild` call the same root command。

- [ ] **Step 1: 编写 CLI 退出码测试**

使用子进程分别运行 valid fixture 与 missing/unregistered/duplicate fixture。Expected before CLI implementation: RED，入口文件不存在或未返回预期退出码。

- [ ] **Step 2: 实现 CLI 与结构化错误输出**

错误格式固定为：

```text
<relative-file>:<line>:<column> [<code>] <message>
```

Run: `corepack pnpm vitest run scripts/e2e-interactions/validator.test.ts`，Expected: PASS。

- [ ] **Step 3: 接入脚本和双打包入口**

根 `package.json` 增加 `validate:e2e-interactions`，`lint` 先运行它；Desktop `package.json` 增加 `prebuild`，通过 `corepack pnpm --dir ../.. validate:e2e-interactions` 调用同一入口。

- [ ] **Step 4: 验证门禁不可绕过**

对 fixture 注入由测试进程完成，不直接破坏产品文件。分别验证：

```bash
corepack pnpm validate:e2e-interactions
corepack pnpm build
corepack pnpm --dir apps/desktop build
```

合规代码均 PASS；CLI 测试中的每类违规均非零退出。

- [ ] **Step 5: 完整验证与文档**

Run:

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm test
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm build
corepack pnpm test:e2e
corepack pnpm exec openspec validate enforce-e2e-interaction-contracts --strict
git diff --check
```

Expected: 全部通过。更新维护文档中的契约数量、动态模式和新增共享组件步骤；将 OpenSpec 任务逐项标记完成并提交。

```bash
git add package.json apps/desktop/package.json scripts docs/testing openspec/changes/enforce-e2e-interaction-contracts/tasks.md
git commit -m "build: enforce E2E interaction contracts"
```
