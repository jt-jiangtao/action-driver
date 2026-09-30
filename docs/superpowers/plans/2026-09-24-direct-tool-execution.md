# Direct Tool Execution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove interactive approval from registered, enabled tool calls without weakening tool discovery, input validation, Sandbox isolation, cancellation, logging, or historical task reading.

**Architecture:** Runtime policy continues to deny tools outside the current grant or with mismatched model names, but returns `allow` for every remaining call. Invocation skips the approval waiter and follows the normal queued/running path. WebSocket and Desktop stop offering approval commands, while persisted legacy approval events remain readable in snapshots.

**Tech Stack:** TypeScript, Zod, Electron, React, SQLite, Vitest, Playwright, OpenSpec.

**Spec:** `docs/superpowers/specs/2026-09-24-direct-tool-execution-design.md`

## Global Constraints

- Work on the existing `main` checkout; preserve unrelated dirty files and do not reset them.
- No new tool may bypass versioned registration, per-run grants, JSON Schema validation, Sandbox limits, timeout, cancellation, or aggregated interaction logging.
- No newly executed tool may emit `tool.waiting_approval` or require a user click.
- Keep legacy persisted approval events readable; do not execute a formerly pending call merely because a newer build starts.
- Preserve activity cursor order, raw I/O, and completed-task reload behavior.

## Review Focus

- A denied or unregistered tool must still fail without calling an executor (Task 2 test).
- An invalid Shell argument must still fail before execution despite auto-allow (Task 2 test).
- Cancellation during auto-executed Shell must not be mistaken for approval rejection (Task 2 test).
- A legacy `waiting_approval` snapshot must render without a live approve/reject action (Tasks 3 and 4 tests).
- Web Search must execute without a click while its input/output and completion order survive reload (Task 5 E2E).

---

### Task 1: Record the new behavior in OpenSpec

**Files:**
- Create: `openspec/changes/remove-interactive-tool-approval/proposal.md`
- Create: `openspec/changes/remove-interactive-tool-approval/design.md`
- Create: `openspec/changes/remove-interactive-tool-approval/specs/agent-tool-runtime/spec.md`
- Create: `openspec/changes/remove-interactive-tool-approval/specs/agent-task-experience/spec.md`
- Create: `openspec/changes/remove-interactive-tool-approval/tasks.md`
- Modify: `openspec/changes/add-searxng-web-search/specs/agent-tool-runtime/spec.md`

**Interfaces:** Consumes the approved design doc. Produces the behavior contract against which Tasks 2–5 are reviewed; no runtime API changes in this task.

- [ ] **Step 1: Write the proposal and design.** Record the approved Battle (alternative: risk-tiered approval; override: no per-call human block). Specify that registered/granted calls run automatically, invalid calls remain denied, and old approval events are read-only. In the still-open SearXNG change, replace its pending per-search approval requirement with this decision instead of changing archived historical documents.
- [ ] **Step 2: Write specification deltas.** In `agent-tool-runtime`, replace the approval lifecycle scenarios with `proposed → queued → running → completed|failed|cancelled` for all valid enabled tools, plus a legacy-history scenario. In `agent-task-experience`, remove the live approval bar requirement and add a scenario asserting the composer remains usable while tools execute automatically. Keep historical approval events readable but never actionable.
- [ ] **Step 3: Write tasks and validate.** Run `openspec validate remove-interactive-tool-approval --strict`; expected: validation succeeds. Run `openspec status --change remove-interactive-tool-approval --json`; expected: proposal, design, specs, and tasks are complete. Commit only the new change files and the SearXNG delta with `git commit -m "docs: specify automatic tool execution"`.

### Task 2: Auto-allow registered tools in Runtime without weakening denials

**Files:**
- Modify: `apps/agent-runtime/src/tool-policy.ts`
- Modify: `apps/agent-runtime/src/tool-invocation-service.ts`
- Modify: `apps/agent-runtime/src/tool-invocation-state-machine.ts`
- Modify: `packages/runtime-contracts/src/tool-protocol.ts`
- Test: `apps/agent-runtime/tests/tool-policy.test.ts`
- Test: `apps/agent-runtime/tests/tool-invocation-service.test.ts`
- Test: `apps/agent-runtime/tests/tool-invocation-state-machine.test.ts`
- Test: `packages/runtime-contracts/tests/tool-protocol.test.ts`

**Interfaces:** Consumes `ToolPolicyContext.grants`, `ToolCall`, `ToolDefinition`. Produces `ToolDecision = { kind: 'allow' } | { kind: 'deny'; error: ToolError }` for new calls and the existing `execute(call, context, signal)` async event stream. Preserve the persisted decision/status decoder for legacy records.

- [ ] **Step 1: Write failing policy tests.** Replace Shell and SearXNG approval expectations and retain denial checks:

```ts
expect(policy.decide(shellTool, call(shellTool, { command: 'rg', args: ['needle'] }), { grants: ['sandbox.shell.run@1'] })).toEqual({ kind: 'allow' })
expect(policy.decide(shellTool, call(shellTool, { command: 'rg', args: [] }), { grants: [] })).toMatchObject({ kind: 'deny', error: { code: 'TOOL_DENIED' } })
expect(policy.decide(shellTool, { ...call(shellTool, {}), modelName: 'wrong' }, { grants: ['sandbox.shell.run@1'] })).toMatchObject({ kind: 'deny', error: { code: 'TOOL_DEFINITION_MISMATCH' } })
```

- [ ] **Step 2: Write failing invocation tests.** Replace the one-time approval test with a Shell executor spy, plus invalid Shell input, denied grant, abort, timeout, and one aggregate-log assertion:

```ts
const events = await collect(fixture.service.execute(shellCall(), context(['sandbox.shell.run@1'])))
expect(events.map((event) => event.type)).toEqual(['tool.proposed', 'tool.queued', 'tool.running', 'tool.completed'])
expect(execute).toHaveBeenCalledOnce()
expect(fixture.commits.at(-1)?.invocation.decision).toBe('allow')
```
- [ ] **Step 3: Confirm red.** Run `pnpm exec vitest run apps/agent-runtime/tests/tool-policy.test.ts apps/agent-runtime/tests/tool-invocation-service.test.ts`; expected: new auto-execution assertions fail against `require_approval`/waiter behavior.
- [ ] **Step 4: Implement the smallest runtime change.** Keep the policy's grant and name mismatch branches, then return `{ kind: 'allow' }`; remove the `require_approval` decision variant and waiter execution branch. Persist `argumentsHash: ''` and `decision: 'allow'` for allowed new calls. Leave the now-inert approval methods/types in place until Task 3 removes their stream callers; this keeps Task 2 independently typecheckable. Preserve timeout/abort handling, event persistence, and legacy storage parsing.

```ts
if (!context.grants.includes(`${definition.id}@${definition.version}`)) return { kind: 'deny', error: deniedError }
if (definition.modelName !== call.modelName) return { kind: 'deny', error: mismatchError }
return { kind: 'allow' }
```
- [ ] **Step 5: Verify and commit.** Run the four test files above and `pnpm --filter @action-driver/agent-runtime typecheck`; expected: all pass. Commit only Task 2 files with `git commit -m "feat: execute granted tools without approval"`.

### Task 3: Remove live approval control frames while preserving old snapshots

**Files:**
- Modify: `packages/runtime-contracts/src/stream-protocol.ts`
- Modify: `packages/runtime-contracts/src/tool-protocol.ts`
- Modify: `apps/agent-runtime/src/stream-session-service.ts`
- Modify: `apps/agent-runtime/src/runtime-process.ts`
- Modify: `apps/agent-runtime/src/repositories.ts`
- Modify: `apps/agent-runtime/src/service/websocket-service.ts`
- Test: `packages/runtime-contracts/tests/stream-protocol.test.ts`
- Test: `apps/agent-runtime/tests/stream-session-service.test.ts`
- Test: `apps/agent-runtime/tests/service-websocket.test.ts`
- Test: `apps/agent-runtime/tests/runtime-process.test.ts`
- Test: `apps/agent-runtime/tests/repositories.test.ts`

**Interfaces:** Live `StreamClientEvent` supports auth/create/cancel/resume, not `tool.approve` or `tool.reject`. `StreamSessionService.getTaskSnapshot(taskId)` still returns ordered historical tools and events, including old persisted approval records as read-only history.

- [ ] **Step 1: Write failing protocol and service tests.** Assert `parseStreamClientEvent` rejects `tool.approve` and `tool.reject`; assert `session.ready.capabilities` excludes them. Seed a persisted legacy `tool.waiting_approval` event and verify snapshot/replay remains readable without executing that call. Add a repository migration test for a task with a persisted pending approval: it becomes cancelled/failed before normal task listing, while a completed historical task remains unchanged.

```ts
expect(() => parseStreamClientEvent({ type: 'tool.approve', requestId: 'r', taskId: 't', callId: 'c', argumentsHash: 'h' })).toThrow()
expect(snapshot.tools.find((tool) => tool.callId === 'legacy-call')?.status).toBe('cancelled')
expect(executor).not.toHaveBeenCalled()
```
- [ ] **Step 2: Confirm red.** Run `pnpm exec vitest run packages/runtime-contracts/tests/stream-protocol.test.ts apps/agent-runtime/tests/stream-session-service.test.ts apps/agent-runtime/tests/service-websocket.test.ts`; expected: approval controls still parse or appear in capabilities.
- [ ] **Step 3: Remove active control path.** Delete `decideTool`, approval waiter/methods and `approvals` wiring; remove approval control variants from client-event schema and capability list. Retain the server-event and SQLite decoder needed to replay historical `tool.waiting_approval` records. On startup, a repository transaction changes only persisted calls still in `waiting_approval` to `cancelled` with `TOOL_APPROVAL_REMOVED`, and marks their still-running task/request failed; it must not call an executor or touch completed tasks. Extend this transaction's tests to check idempotence across a second startup.

```ts
await repositories.cancelLegacyPendingApprovals('TOOL_APPROVAL_REMOVED')
const snapshot = await streamSessions.getTaskSnapshot(taskId)
expect(snapshot?.tools.find((tool) => tool.callId === legacyCallId)?.status).toBe('cancelled')
```
- [ ] **Step 4: Verify and commit.** Run Task 3 tests plus `pnpm --filter @action-driver/runtime-contracts typecheck` and `pnpm --filter @action-driver/agent-runtime typecheck`; expected: pass. Commit only Task 3 files with `git commit -m "refactor: remove tool approval stream controls"`.

### Task 4: Remove approval UI and renderer commands

**Files:**
- Delete: `apps/desktop/src/renderer/src/components/ToolApprovalBar.tsx`
- Delete: `apps/desktop/src/renderer/src/components/ToolApprovalBar.test.tsx`
- Modify: `apps/desktop/src/renderer/src/pages/TaskPage.tsx`
- Modify: `apps/desktop/src/renderer/src/App.tsx`
- Modify: `apps/desktop/src/renderer/src/services/desktop-agent-adapter.ts`
- Modify: `apps/desktop/src/renderer/src/services/renderer-stream-client.ts`
- Modify: `apps/desktop/src/renderer/src/components/ActivityTimeline.tsx`
- Modify: `apps/desktop/src/renderer/src/styles/agent.css`
- Modify: `packages/contracts/src/index.ts`
- Test: `apps/desktop/src/renderer/src/pages/pages.test.tsx`
- Test: `apps/desktop/src/renderer/src/services/renderer-stream-client.test.ts`
- Test: `apps/desktop/src/renderer/src/services/stream-task-projection.test.ts`

**Interfaces:** `TaskPage` no longer accepts `onApproveTool` or `onRejectTool`; `AgentCommandService` no longer exposes these methods; `RendererStreamClient` no longer sends approval frames. Historical `waiting_approval` projections are display-only and never create a button.

- [ ] **Step 1: Write failing page/client tests.** Assert `TaskPage` has no `.tool-approval-bar` for either a normal task or a legacy `waiting_approval` fixture; assert tool timeline still displays its summary and the composer remains visible. Remove the test expecting `approveTool` to send a frame; assert no approval method is exposed by the client type.

```ts
expect(container.querySelector('.tool-approval-bar')).toBeNull()
expect(container.querySelector('.activity-tool')).not.toBeNull()
expect(container.querySelector('.agent-composer')).not.toBeNull()
```
- [ ] **Step 2: Confirm red.** Run `pnpm exec vitest run apps/desktop/src/renderer/src/pages/pages.test.tsx apps/desktop/src/renderer/src/services/renderer-stream-client.test.ts`; expected: the old approval bar assertion fails.
- [ ] **Step 3: Remove view and commands.** Delete approval component and CSS, remove its TaskPage props and App callbacks, remove adapter/client approve/reject methods, and remove `waiting_approval` from active-status wording while retaining a neutral historical label for archived records. Update interaction-selector registry if it names deleted buttons.
- [ ] **Step 4: Verify and commit.** Run Task 4 tests, `pnpm validate:e2e-interactions`, and `pnpm --filter @action-driver/desktop typecheck`; expected: pass. Commit only Task 4 files with `git commit -m "refactor: remove interactive tool approval UI"`.

### Task 5: End-to-end proof, history compatibility, and documentation

**Files:**
- Modify: `apps/desktop/e2e/tool-runtime.spec.ts`
- Modify: `apps/desktop/e2e/interaction-contracts.json` if Task 4 removed selectors there
- Modify: `openspec/changes/remove-interactive-tool-approval/tasks.md`
- Modify: `docs/superpowers/specs/2026-09-24-direct-tool-execution-design.md` only if verified behavior clarifies a sentence

**Interfaces:** Exercises the existing Desktop → WebSocket → Runtime → SQLite path; no new production API.

- [ ] **Step 1: Change the E2E oracle before implementation is considered complete.** Replace the existing Shell approve/reject flow and local SearXNG approval cases with tests that submit a task, wait for completion without clicking, confirm no approval bar, and check the final model answer. Reuse the current local SearXNG fixture. Reload the completed task, expand its activity archive, and assert the same tool row and raw I/O remain in cursor order.

```ts
await sendGoal(page, '在 README 中查找 needle')
await expect(page.getByTestId('e2e/tasks/detail/activity/approve#button')).toHaveCount(0)
await expect(page.getByRole('heading', { name: '已读取' })).toBeVisible()
await page.reload()
await page.getByTestId('e2e/tasks/detail/activity/archive#button').click()
await expect(page.locator('.activity-tool')).toHaveCount(1)
```
- [ ] **Step 2: Run E2E.** Run `pnpm --filter @action-driver/agent-runtime build && pnpm --filter @action-driver/desktop build && pnpm exec playwright test apps/desktop/e2e/tool-runtime.spec.ts`; expected: all tool-runtime E2E cases pass with no manual approval.
- [ ] **Step 3: Run cross-package verification.** Run `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, and `openspec validate remove-interactive-tool-approval --strict`. Record any unrelated pre-existing failure separately; do not mark the OpenSpec task complete while a relevant failure remains.
- [ ] **Step 4: Review and archive.** Inspect `git diff` for residual live approval callbacks or buttons; use `rg 'approveTool|rejectTool|ToolApprovalBar|require_approval' apps packages` to confirm remaining references are only legacy readers/tests. Mark OpenSpec tasks complete, commit the final verification change, then archive with `openspec archive remove-interactive-tool-approval --yes` only after verification and user-visible behavior are complete.
