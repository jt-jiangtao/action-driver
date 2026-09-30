# Session pinning and archive design

## Purpose and scope

People need to keep important chats near the top of the sidebar and move finished chats out of the recent list without losing them. Success means that pin and archive actions survive restart, an archived chat can be found and restored from Settings, and long titles remain readable when the row actions appear.

This change covers the desktop sidebar, the runtime session catalog, and one Settings page. It does not add project grouping, project filters, permanent deletion, bulk deletion, or a general chat search. The supplied screenshots guide layout and copy; they do not define additional behavior.

## Existing boundaries

`Sidebar` renders `RecentTaskItem` from `TaskCatalog.listRecentTasks()`. The desktop catalog reads `GET /tasks`, whose summaries are built from session tasks. `RecentTaskProjection` has no pin or archive state. The rollout projection already contains an `archived` column, but the authoritative rollout log has no matching metadata event and no mutation route. The Settings navigation has no archive page. A separate SQLite task repository also implements the task repository port and must retain equivalent catalog behavior where used.

## User experience

- Hovering a recent chat row, or moving keyboard focus into it, reveals icon buttons labeled “置顶” or “取消置顶” and “归档”. The title remains the row's main open action. The buttons do not trigger opening the chat.
- Pinned chats appear first, ordered by their latest activity within the pinned group. Other chats retain latest activity order. An archived chat leaves the recent list immediately after the runtime confirms the action.
- A running or queued chat shows a disabled archive action with an explanation. Pinning remains available. A failed action keeps the previous state and presents an error near the list.
- An overflowing title starts at its leading edge. On hover or focus it moves left once, at a readable speed, until the trailing edge is visible, then stays there. Leaving the row restores the leading edge. A title that fits does not move. Reduced motion disables the animation and keeps the normal clipped title with its full text available to assistive technology and a tooltip.
- Settings gets an “已归档的聊天” entry. The page lists archived sessions newest first, shows each title and archive date, supports a text search, opens a chat for viewing, and offers “取消归档”. Restoring moves it back into the recent list. Empty, loading, and error states are explicit. No delete controls appear in this first version.

## Data and interfaces

Pin and archive belong to a session, not an individual turn. Add `pinned`, `archived`, and nullable `archivedAt` to the session catalog summary. Expose a catalog query for archived sessions with a title search and cursor pagination. Expose idempotent runtime commands to set each boolean by session ID, with typed validation and a not-found error. Existing task IDs continue to open the latest task in a session.

The rollout JSONL file remains authoritative. Add a typed session metadata change line with the resulting pin and archive values plus the archive timestamp. Its fold and SQLite projection update the session row. Rebuilding the projection from rollout files must recreate these values. Existing logs default both booleans to false and the timestamp to null. The alternate SQLite repository stores the same metadata in its session-level catalog representation; it must not infer a session's state from whichever turn was returned last. Runtime catalog queries filter archived sessions before applying a page limit and sort pinned sessions first. The archived query filters by title before applying a page limit, then returns a cursor so older matches remain reachable.

The desktop `TaskCatalog` adds methods to list archived chats and set pin/archive state. The mock catalog implements the same contract for component and visual tests. `App` owns recent-list refresh and navigation; the archive page owns its query, search text, and action feedback. Successful mutations invalidate or refresh both catalog views. The currently open task may still be viewed after it is archived from Settings, but its sidebar entry disappears until restored.

## Error handling and consistency

The UI waits for runtime confirmation before changing the displayed state. Each action is disabled while its request is in flight. A failure leaves the row and ordering intact and displays a retryable message. A missing session returns a clear error and triggers a catalog refresh. Duplicate set requests are harmless. Archiving is rejected by the runtime as well as disabled in the UI for queued or running sessions, so a stale UI cannot hide an active run.

Search runs in the runtime catalog and starts a fresh cursor when the query changes. The page offers a “加载更多” action while another page exists; it must not silently search only the first 50 results. The search compares titles without case sensitivity and treats whitespace-only input as an empty query.

## Verification

Targeted runtime tests cover idempotent metadata writes, rebuild from rollout logs, the alternate store, filtering before limit, pinned ordering, archived search, and rejection of active-session archive. Desktop tests cover hover and focus actions, overflow-only motion and reduced motion, pin ordering, archive/restore refresh, Settings navigation, search, and failure states. A focused visual check compares the sidebar row and archive page with the supplied images while respecting the scoped omissions above.

## Decisions and trade-offs

- **Chosen:** durable runtime-owned session metadata. A renderer-only state is faster to draw but loses user organization on restart and cannot provide reliable restoration.
- **Chosen:** one-way title movement to the trailing edge. A looping marquee distracts from actions and makes the title harder to click.
- **Chosen:** no permanent deletion in the first version. The screenshot includes destructive controls, but the approved scope is viewing, searching, and restoring. Deletion needs its own recovery and confirmation decision.
- **Chosen:** no project grouping yet. Current session summaries have no project identifier. Inventing one from the chat title or current workspace would produce misleading groups.
- **Risk:** rollout metadata and the queryable projection can diverge after a crash. Replaying the authoritative log on recovery resolves the projection; mutation success is reported only after the log append and projection update complete.
- **Risk:** archival of a running session could hide a request for attention. Both UI and runtime reject it until the session is no longer queued or running.

The user approved this scope and the durable approach on 2026-09-30. Reopen the decision only if implementation reveals a new data ownership conflict or if project grouping or deletion is requested.
