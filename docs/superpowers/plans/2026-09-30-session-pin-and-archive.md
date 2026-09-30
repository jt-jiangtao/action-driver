# 聊天置顶与归档 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让侧栏聊天可持久置顶或归档，并从设置页搜索、查看和恢复归档聊天。

**Architecture:** 会话元数据由本地 Runtime 持有。Rollout JSONL 记录变更并重建索引；目录仓储提供筛选、排序和分页；桌面端通过类型化 HTTP 适配器显示两个列表。

**Tech Stack:** TypeScript、Hono、SQLite、React、TanStack Query、Vitest、Testing Library。

**Spec:** `docs/superpowers/specs/2026-09-30-session-pin-and-archive-design.md`

## Global Constraints

- 归档、置顶属于会话；Rollout JSONL 是权威记录，旧日志默认未置顶、未归档。
- 归档或置顶失败时不提前更新列表；运行中或排队中的会话不可归档。
- 首版不做项目分组、项目过滤、永久删除、批量删除。
- 长标题只在溢出时单次左移至末尾；支持键盘聚焦与减少动态效果设置。
- 迭代期仅跑相关定向测试。准备最终一次提交时才运行 `pnpm typecheck`、`pnpm lint`、`pnpm test`；同一提交不重复全量验证。
- 仓库其他未提交文件不得纳入本次提交。

## Review Focus

- 目录中存在超过一页的归档聊天：搜索要筛选全部数据，并可继续加载后续结果（Task 2、5）。
- 最新任务 ID 与会话 ID 不同：操作按会话 ID 持久化，打开时仍使用任务 ID（Task 2、3）。
- 排序时间相同：置顶组和普通组内都用稳定 ID 作次序决胜（Task 2）。
- 请求期间会话变成运行中：Runtime 拒绝归档，客户端保留原状态并显示失败（Task 2、4）。
- 投影数据库丢失或日志尾行不完整：重建后仍恢复已确认的元数据（Task 1）。

---

### Task 1: Rollout 会话元数据

**Files:**
- Modify: `apps/local-runtime/src/rollout/model.ts`, `fold.ts`, `projection.ts`, `session-store.ts`
- Test: `apps/local-runtime/tests/unit/rollout/rollout.test.ts`, `projection.test.ts`

**Interfaces:**
- Produces: `SessionMetadata = { pinned: boolean; archived: boolean; archivedAt: string | null }`；会话级 `session_state` 日志行；`RolloutSessionStore.setSessionMetadata(sessionId, metadata): Promise<void>`。

- [ ] 写失败测试：追加置顶与归档状态后重开 Store、删除并重建索引，三个值一致；旧日志使用默认值；损坏尾行不覆盖之前已确认状态。
- [ ] 运行 `pnpm vitest run apps/local-runtime/tests/unit/rollout/rollout.test.ts apps/local-runtime/tests/unit/rollout/projection.test.ts`，确认新断言失败。
- [ ] 实现 `session_state` schema、fold、索引列迁移与追加操作；先追加并 fsync，再更新可查询索引。
- [ ] 重跑上述定向测试，确认通过。

### Task 2: 会话目录仓储与 Runtime 接口

**Files:**
- Modify: `packages/agent-runtime/src/ports.ts`, `apps/local-runtime/src/rollout/read.ts`, `apps/local-runtime/src/rollout/session-store.ts`, `apps/local-runtime/src/local-runtime-server.ts`, `apps/local-runtime/src/service/http/http-routes-tasks.ts`, `apps/local-runtime/src/mock-adapters.ts`
- Test: `apps/local-runtime/tests/unit/rollout/session-store.test.ts`, `apps/local-runtime/tests/unit/local-runtime-server.test.ts`, `apps/local-runtime/tests/unit/service-http.test.ts`

**Interfaces:**
- Consumes: Task 1 的会话元数据和写入方法。
- Produces: `SessionCatalogRecord = { task: RuntimeTaskRecord; pinned: boolean; archived: boolean; archivedAt: string | null }`；`SessionCatalogPage = { items: SessionCatalogRecord[]; nextCursor: string | null }`；`TaskRepository.listSessions({ archived, query, limit, cursor }): Promise<SessionCatalogPage>`、`setSessionPinned(sessionId, pinned)`、`setSessionArchived(sessionId, archived)`；HTTP `GET /sessions/catalog`、`PUT /sessions/:sessionId/pin`、`PUT /sessions/:sessionId/archive`。

- [ ] 写失败测试：先筛选后分页、标题搜索不区分大小写、空白搜索等同无条件搜索、置顶优先且同组按更新时间与 ID 稳定排序、运行中归档被拒绝、重复 set 幂等；覆盖 Rollout 与内存 Mock 契约。
- [ ] 运行上述改动到的 Runtime 定向测试，确认新断言失败。
- [ ] 实现仓储查询和状态变更；HTTP 只收布尔目标状态，校验 ID/limit/cursor/query，未知会话给明确错误。
- [ ] 重跑相同定向测试；必要时运行 `pnpm typecheck` 验证新增端口。

### Task 3: 桌面目录适配器

**Files:**
- Modify: `packages/contracts/src/task-projection.ts`, `apps/desktop/src/renderer/src/models/task-catalog.ts`, `apps/desktop/src/renderer/src/services/agent-session/runtime-agent-http-api.ts`, `apps/desktop/src/renderer/src/services/task-catalog/desktop-task-catalog.ts`, `mock-task-catalog.ts`
- Test: `apps/desktop/tests/unit/renderer/src/services/task-catalog/desktop-task-catalog.test.ts`, `mock-task-catalog.test.ts`

**Interfaces:**
- Consumes: Task 2 的三个 HTTP 端点。
- Produces: `RecentTaskSummary` 增加 `sessionId`, `pinned`, `archivedAt`；`TaskCatalog.listArchivedTasks(query, cursor)`, `setPinned(sessionId, pinned)`, `setArchived(sessionId, archived)`；归档分页结果含 `nextCursor`。

- [ ] 写失败测试：真实适配器保留任务 ID 与会话 ID、正确映射置顶/归档状态和下一页游标；Mock 的操作可恢复且不污染其他实例。
- [ ] 运行这两个目录服务定向测试，确认失败。
- [ ] 实现共享契约、HTTP 调用、桌面与 Mock 适配器；保持 `getTask(taskId)` 行为。
- [ ] 重跑定向测试与 `pnpm typecheck`。

### Task 4: 侧栏行操作与标题运动

**Files:**
- Modify: `apps/desktop/src/renderer/src/components/Sidebar.tsx`, `components/navigation/RecentTaskItem.tsx`, `components/ui/AppIcon.tsx`, `styles/navigation.css`, `App.tsx`
- Test: `apps/desktop/tests/unit/renderer/src/components/Sidebar.test.tsx`, `apps/desktop/tests/unit/renderer/src/App.test.tsx`

**Interfaces:**
- Consumes: Task 3 的 `TaskCatalog` 方法和 `RecentTaskSummary`。
- Produces: 独立的打开、置顶、归档按钮；`App` 在确认成功后刷新最近和归档目录。

- [ ] 写失败测试：hover/focus 显示正确操作；点击图标不打开聊天；运行中归档不可用；操作失败列表不变并显示错误；置顶排序与归档移除成功。
- [ ] 运行上述两个组件定向测试，确认失败。
- [ ] 拆分行内主按钮与操作按钮，按实际溢出量计算标题终点；CSS 一次性动画停在终点并处理 `prefers-reduced-motion`。
- [ ] 重跑定向测试；用实际渲染核对长、短标题和键盘焦点。

### Task 5: 设置页归档列表

**Files:**
- Create: `apps/desktop/src/renderer/src/pages/ArchivedChatsPage.tsx`
- Modify: `apps/desktop/src/renderer/src/components/SettingsSidebar.tsx`, `models/app-route.ts`, `App.tsx`, `styles/settings.css`
- Test: `apps/desktop/tests/unit/renderer/src/pages/ArchivedChatsPage.test.tsx`, `apps/desktop/tests/unit/renderer/src/App.test.tsx`

**Interfaces:**
- Consumes: Task 3 的归档分页与恢复方法。
- Produces: 设置页入口、搜索、加载更多、打开聊天、取消归档，以及加载/空/错误状态。

- [ ] 写失败测试：设置导航进入归档页；不同搜索词重置游标；加载后续页；打开聊天；取消归档后两处列表同步；失败时保留行。
- [ ] 运行这两个页面定向测试，确认失败。
- [ ] 实现页面与路由，复用现有设置壳层；无需项目分组或删除按钮。
- [ ] 重跑定向测试并进行页面视觉核查。

### Task 6: 完成验证和交付

**Files:** 本次任务实际修改的文件及对应 OpenSpec `tasks.md`。

- [ ] 核对设计与 OpenSpec 条目逐项完成；检查变更集仅含本任务文件。
- [ ] 准备一次提交后，顺序运行 `pnpm typecheck`、`pnpm lint`、`pnpm test`，界面/运行时路径另按需追加本地 E2E；记录通过、失败数量和已知无关失败，不重跑全量。
- [ ] 将验证结果写入 OpenSpec 记录或提交信息，只暂存本任务文件并提交一次。
