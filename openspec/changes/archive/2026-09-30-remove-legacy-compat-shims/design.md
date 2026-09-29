## Context

见 [proposal.md](proposal.md)。仓库里带 `legacy` 字样的代码并非都是债务：一部分是现有 spec 要求的数据安全保证，一部分是现役协议面。本变更只删除「只为读旧数据或旧草稿结构而存在、且当前没有 spec 依据」的路径，并为唯一有 spec 依据的一处提交 delta。

## Goals / Non-Goals

**Goals:**

- 删除四条未经验证的旧数据兼容路径，缩小维护面与启动失败面。
- 对确实由 spec 要求的一处同步修改 spec，保持规划与实现一致。
- 明确列出保留项，避免把现役协议面或语义值当作债务删除。

**Non-Goals:**

- 不删除升级前数据库备份（`runtime-event-recovery` 要求）与退役内置 Skill 清理（`instruction-skill-installation` 要求）。
- 不删除 `legacyComputerHelperRequest`：`list-apps`、`permissions`、`cancel`、`shutdown`、`guidance` 仍是 Desktop 主进程现役调用（权限查询、指引窗口、helper 关闭），删除会破坏现役功能。
- 不重做 `CapabilitySource 'legacy'`：它是数据库 CHECK 约束与 DTO 的语义值，取消需要新的 schema 设计与替代取值，不属于机械清理。

## Decisions

### 删除四处仅面向旧数据的兼容路径

1. Desktop 旧连接迁移：`migrateLegacyModelConnections` 及其专用的 `model-connections/connection-store.ts`、`model-connections/secret-cipher.ts`。Runtime 服务已是连接的唯一事实源，旧桌面 JSON 不再被任何现役路径读取。
2. 旧审批启动清理：`repositories.cancelLegacyPendingApprovals` 与 `runtime-process.ts` 的启动调用。旧审批只保留历史只读语义，新调用不会再产生该状态。
3. 旧默认提示词回写：`refreshLegacyDefaultPrompt` / `isSupersededDefault` 与 `resources/prompts/legacy/`。默认提示词以当前打包版本为准，不再比对历史快照。
4. 早期草稿表修复：`database.ts` 的 `repairSessionInputFiles`。迁移 13 已产出最终形状，不再为早期草稿的表结构做重建。

替代方案：保留全部迁移，只登记删除条件。这是本仓库在正式发布前的默认保守做法，成本是继续维护四条无人验证的路径。用户在知悉「旧数据不再自动恢复」后选择直接删除，故采用删除方案。

### 修改 agent-tool-runtime spec，而不是只改代码

旧审批清理是 spec 明确要求（原「旧审批记录恢复」场景要求升级时发现悬挂旧审批就安全结束）。只删实现会让 spec 与代码冲突，因此本变更提交 MODIFIED requirement：保留「历史事件可只读解析」，删除升级时自动结束悬挂调用。

## Risks / Trade-offs

- [旧桌面配置或旧草稿数据库不再自动恢复] → 开发阶段本地数据可重建；用户已接受该代价。
- [旧审批记录可能长期停留在 `waiting_approval`] → 该状态不再由新调用产生且仍可只读展示；需要干净状态时重新初始化本地数据库。
- [误删现役协议面] → 每条删除都以调用点证据确认专用于旧数据；`legacyComputerHelperRequest` 等现役面列入 Non-Goals。
- [与并行线程在同一文件冲突] → 实施前重新确认目标文件未被并行改动占用，提交时只暂存本变更文件。

## Migration Plan

无数据迁移。回滚 = revert 本次提交；回滚后旧数据重新可读，但期间被忽略的旧文件不会自动消失，也不会被删除。
