# 在 JavaScript 入口内逐动作确认

> **已被取代（2026-09-27）**：本变更未实施，其"逐动作确认 + 单元挂起／续接"方向已被
> `align-computer-use-with-codex` 取代。用户在该变更中裁决按应用授权、在调用内阻塞询问，
> 并删除 `ApprovalRequiredError`、`continuation.decisions`、`jsAction` 审批卡等整套协议。
> 保留本文件仅作历史留痕，其中的设计与任务不得再作为实施依据。

## Why

`js` 入口是 `computer-use` Skill 的日常入口，但它一次执行整段模型代码。B2 方案把确认时机从"调用前"挪到"动作前"：单元执行到会改变桌面的方法时就地挂起，只针对这一个动作向用户确认，批准后从原处继续，拒绝则让该次调用拿到 `USER_DENIED`。这样纯观察的调用不打断，用户看到的是具体动作而不是一段代码。

工作在一个已归档变更（`2026-09-26-implement-computer-use`）的第 10.7 节里完成，行为已落地并验证；本变更把这些工作独立留痕。

## What Changes

- JS 会话支持"挂起 + 续接"：子进程在动作前挂起（promise 保持 pending），宿主把这轮以"待审批动作（序号 + 方法 + 参数）"结束；续接时把决定送回同一挂起调用，批准先执行动作、拒绝写入 `USER_DENIED`。
- 图节点用"执行 → `interrupt()` → 恢复 → 用已给出的决定继续同一 `callId`"的循环，让每个动作各弹一次确认；工具调用以 `ToolInvocationContext.continuation.decisions` 拿到该调用已作出的全部决定。
- 审批卡改用 `jsAction` 形态（动作序号 + 方法 + 参数），按 Skill API 的说法描述动作。
- 一次 `js` 调用只允许一个桌面动作：同一单元出现第二个待审批动作时返回 `COMPUTER_ACTION_SPLIT_REQUIRED`（同一轮里第二次 `interrupt()` 会拿到第一个恢复值，这是实测结论）。

## Capabilities

- Modified: `computer-use`（逐动作确认的执行位置与粒度；主线规格 `openspec/specs/computer-use/spec.md` 的 `支持用户控制与接管` 已覆盖该行为契约，故本变更 `skip_specs`）

## Out of Scope

- 一个单元里连续多个桌面动作（需要先澄清 LangGraph 同轮多次 `interrupt()` 的语义）。
- 按动作类型分级确认、任务级一次性授权。
