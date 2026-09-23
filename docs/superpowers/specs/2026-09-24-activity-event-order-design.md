# Activity event ordering and runtime-owned titles

## Intent and success criteria

The task page must show process text and tools in the order they occurred, with every tool attached to the activity active when it started. Running, replayed, and snapshot-restored views must agree. The runtime, not an LLM-visible `activity_update` tool, creates activities and assigns safe rule-based titles. The completed view keeps the process inside the top duration archive and places the final answer after it.

Success is a test sequence such as `text A → tool A → text B → tool B` rendering in that order during streaming, after reconnect, and after reopening the task. Tool output updates its existing tool row rather than creating another row. An activity always exists, including before the first tool and when no tool is called.

## Decision and alternatives

Use the existing persisted event `cursor` as the sole ordering authority. A stable `activityId` groups process items, and `callId` identifies one tool invocation. The first persisted tool lifecycle event anchors its row; later events update that row. Runtime rules revise the activity title immediately before each external tool invocation, with a monotonically increasing `titleRevision`.

Rejected: an LLM-visible `activity_update` meta-tool. It spends a tool call and can be omitted or interleaved incorrectly. Rejected: a second LLM call for titles. It adds latency, cost, and another failure mode without improving order guarantees. Rejected: adding a second `sequenceNumber` or `outputIndex` to the display protocol. Existing `cursor` and first-seen item position already provide those semantics.

## Runtime and persistence

Remove `internal.activity.update` from discovered model tools and from the tool-call interception path. The Graph creates the default activity at task start, updates its title from each external tool's type and safe arguments, and completes it at the end. Tool execution context and all tool lifecycle records carry the active `activityId` and stable `callId`.

The event store serializes append operations for a task. An event is broadcast only after its durable append succeeds. `cursor` is the persisted order, not `occurredAt` or arrival time. Concurrent tools may finish in any order: their rows retain the position of their first event while each output updates its own `callId`. If the process restarts or a subscriber reconnects, duplicate events are ignored by stable identity/cursor.

The model stream's text segments are written as ordered process events when the model continues to tools. A model call that finishes the turn marks its text as the final-answer item; it is not duplicated in the process timeline. Classification may be finalized at the model terminal event, but the original text event positions are retained for audit/replay. The persisted assistant message remains conversation state, not a second source of display order.

## Projection and rendering

One pure reducer consumes persisted events in cursor order and produces the activity title/status, a flat ordered process list, and mutable tool/text items keyed by their IDs. Both live streaming and snapshot recovery use this reducer. A snapshot is taken at a consistent high-water cursor; later events are applied only if their cursor is greater than that value. A missing or expired replay range triggers a fresh snapshot rather than a partial merge.

The task page renders the user message, then the process view from that ordered projection, then the final answer. It does not render cumulative assistant `response.content` above a separately grouped activity view. While running, the duration header remains above the process. When terminal, the process is folded under the duration header and the final answer follows it.

## Failure modes and compatibility

- A title-rule failure leaves the existing safe default title; it cannot block tool execution.
- A missing activity on a historical event is represented by a legacy fallback group during projection, without displaying the old category cards.
- Existing persisted `activity_update` events remain readable, but new model requests never advertise that tool.
- Failed, cancelled, and approval-waiting tools retain their anchored row and original activity association.
- A snapshot never combines state newer than its advertised cursor with earlier replay events.

## Verification

Add failing tests for the Graph's advertised tools and rule-based title updates, ordered process text and tool lifecycle events, cursor-consistent snapshots, replay idempotency, and desktop rendering of interleaved text/tool items in running and terminal states. Exercise one ordinary model/tool stream end to end and compare live, reconnect, and fresh-open projections. Keep visual checks for timer placement, archive, and raw I/O expansion.
