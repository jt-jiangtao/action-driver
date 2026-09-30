# Unified CUA JS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Browser Use and Computer Use execute through one persistent Codex-style CUA JS entry while preserving Action-Driver-owned browser and computer hosts.

**Architecture:** `@action-driver/browser-runtime` owns the one Browser/Tab client and generic command protocol. `@action-driver/browser-desktop` reuses that client and implements desktop-specific service behavior. `@action-driver/cua` combines injected browser and computer backends; the Action-Driver runtime hosts a persistent JS REPL and routes each privileged RPC through its existing policy and task boundaries.

**Tech Stack:** TypeScript 5.9, Node ESM, Electron 38, React, Playwright Core, Swift macOS helper, Vitest, Playwright E2E.

**Spec:** `docs/superpowers/specs/2026-09-28-browser-and-vendor-cutover-design.md`; OpenSpec `openspec/changes/integrate-browser-use-desktop`.

## Global Constraints

- Browser and Computer services must not depend on Codex App private services or `thirdparty/backup` at runtime.
- Only Action-Driver-created browser sessions are visible to Agent; external browser support is macOS Chrome with an isolated profile.
- Browser RPC and computer RPC each enforce their own Skill/Policy Gate, task ownership, cancellation and takeover state.
- Preserve Computer Use approval, image storage, timeout, reset and cleanup behavior.
- Do not migrate old Browser Use JSON tool records.
- During iteration run targeted tests and needed typechecks only. The full verification suite runs once when preparing the commit, as required by `AGENTS.md`.
- Preserve unrelated worktree changes; stage only this change's files.

## Review Focus

1. A JS cell that calls browser and computer APIs must fail at the unapproved surface without gaining its permissions from the approved surface; Task 3 tests this.
2. Closing or replacing a browser tab while a cell awaits its result must reject the original target and never act on another tab; Task 2 tests this.
3. Reset or cancellation during a browser RPC must release the owned session and prevent a late result from writing into a new cell; Task 3 tests this.
4. Opening a task again must show actual JS code and bounded output, including image references but no screenshot Base64 text; Task 4 tests this.
5. An unavailable Chrome or macOS helper must fail its own surface while the other surface remains usable when authorized; Task 3 and Task 5 test this.

---

### Task 1: Preserve one shared browser client and separate hosts

**Files:** `packages/browser-runtime/src/{default-runtime,host-port,local-browser-host}.ts`, `packages/browser-desktop/src/{index,service,session-controller}.ts`, `apps/desktop/src/main/browser-session/{embedded-host,external-chrome-host}.ts`, package exports and focused tests.

**Interfaces:** `setupBrowserRuntime({host})` remains the one Browser/Tab client bootstrap; `setupBrowserDesktop({host,environment})` delegates to it. `ProductBrowserHost` remains the injected `setup/execute/displayImage/close` port. Action-Driver's Chrome launcher and Electron WebContentsView stay outside generic browser-runtime code.

- [ ] Write a failing package-boundary test that detects duplicate client implementations, browser-desktop importing only the public runtime entry, and a generic runtime importing Electron or the Action-Driver task layer.
- [ ] Run the focused test and confirm the intended failure before editing implementation.
- [ ] Move `createLocalBrowserHost` and its concrete CDP adapter to the Action-Driver host layer, exposing only the generic port types and required resource access from browser-runtime; keep browser-desktop's desktop-specific service implementation separate from the shared client.
- [ ] Run browser-runtime/browser-desktop and Desktop host targeted tests and typechecks; compare the public client behavior and desktop-specific failures with the fixed offline evidence.

### Task 2: Adapt the browser service to the task's managed sessions

**Files:** `apps/desktop/src/main/browser-session/{manager,provider,task-binding}.ts`, `apps/agent-runtime/src/browser-use/*`, `packages/browser-desktop/src/session-*.ts`, corresponding tests.

**Interfaces:** The trusted browser RPC receives the runtime-injected `taskId`, resolves only that task's managed `sessionId`/`tabId`, and returns browser-runtime's serializable command response. It does not accept a model-provided task owner or attach to existing Chrome.

- [ ] Write failing tests for embedded and external Chrome discovery, tab creation/navigation, a closed tab, takeover and task mismatch through the same browser RPC port.
- [ ] Run these tests RED; implement the adapter that maps browser-runtime commands onto browser-desktop sessions and the existing Electron/Chrome hosts.
- [ ] Run targeted unit tests and a real Electron local-page test proving `cua.getTab()` controls the visible right-hand page and `cua.createBrowserTab()` controls only a managed Chrome session.

### Task 3: Compose browser and computer inside the persistent CUA REPL

**Files:** `apps/agent-runtime/resources/js-repl/{repl-server,owned-cua}.mjs` or source equivalents; `apps/agent-runtime/src/computer-use/{cua-runtime,js-repl,cua-tools,entry}.ts`; `packages/cua/src/{session,runtime-factory}.ts`; `packages/cua-repl/src/*`; focused tests.

**Interfaces:** A single JS tool accepts `{code,title?,timeout_ms?}` and a reset tool. The child initializes `createCUASession({agent,computer,getHost})` once per owned session. The host recognizes separate `browser_rpc` and `computer_rpc` messages, checks the corresponding surface authority for every request, and serializes results or bounded image assets.

- [ ] Write failing tests for browser-only, computer-only and mixed JS cells, persistent variables, reset, denied surface, cancellation and host failure.
- [ ] Run the tests RED; add browser transport to the REPL and route it through the trusted host without changing the desktop helper's approval path.
- [ ] Run the focused tests and typechecks; verify the browser and computer backends can be unavailable independently and no private Codex service or backup is loaded.

### Task 4: Register the unified tool and show real input/output

**Files:** `plugins/{browser-use,computer-use}/src/*`, `apps/agent-runtime/src/{runtime-process,tool-activity,stream-session-service,local-runtime-server}.ts`, `apps/desktop/src/renderer/src/components/agent/{ToolGroup,ToolDetails}.tsx`, related tests.

**Interfaces:** The model receives the unified CUA JS and reset definitions after the required skills are available; production grants no longer include `tools.local.browser-use.command@1` after the new tool passes Task 5. Tool projection carries the supplied title, actual JS source, bounded text/error output, and image asset references through live stream and `task.get`.

- [ ] Write failing tool-registry and renderer tests showing a browser JS call, a computer JS call, and a mixed call with the correct title and exact input/output.
- [ ] Run the tests RED; update registry, activity projection and presentation without fabricating scripts from JSON commands.
- [ ] Run focused tests and a task reload E2E; verify Browser Use/Computer Use labels, real code, output, and no Base64 body.

### Task 5: Real acceptance, removal and documentation

**Files:** `apps/desktop/e2e/browser-session.spec.ts`, Computer Use E2E, `openspec/changes/integrate-browser-use-desktop/{proposal,design,tasks}.md`, acceptance notes and packaging checks.

- [ ] In a real Electron window, let the Agent execute JS against the embedded page, independent Chrome and a desktop application; check persistent variables, reset, takeover, denial, cancellation, task reload and resource cleanup.
- [ ] Remove the model-visible JSON Browser Use tool and its production grant only after the JS flow passes; retain internal UI session commands.
- [ ] Run OpenSpec strict validation and targeted dependency/packaging scans; record remaining Codex desktop service parity gaps honestly.
- [ ] When preparing the task commit, run the repository's one-time full typecheck, lint, test and applicable E2E gates; stage only relevant files and record exact results. Do not claim complete parity or archive OpenSpec while a required gate fails.
