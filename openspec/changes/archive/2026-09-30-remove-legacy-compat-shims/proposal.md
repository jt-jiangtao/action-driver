## Why

仓库里有四条代码路径只为读取早期本地数据或早期草稿结构而存在：Desktop 启动时迁移旧 `data/model-connections.json`、Runtime 启动时取消悬挂旧审批、默认提示词历史版本回写、早期草稿 `session_input_files` 表修复。开发阶段没有需要保护的历史安装，这些未经验证的迁移逻辑只扩大维护面与失败面。

Battle 已完成：用户裁决「当前为开发阶段，不考虑历史债与兼容问题，可以直接处理」。Agent 逐项核对了现有 spec 依据——只有旧审批一处由 `agent-tool-runtime` spec 明确要求，删除必须同步修改该 spec；其余三处没有 spec 依据。删除后不再保证旧桌面配置文件、旧草稿数据库表与被覆盖的旧默认提示词自动恢复，该风险已由用户接受，无未裁决关键分歧。

## What Changes

- **BREAKING** 删除 Desktop 主进程启动时的旧 `data/model-connections.json` 迁移，以及只服务该迁移的旧连接存储与密文模块。
- **BREAKING** 删除 Runtime 启动时取消悬挂旧审批的处理；旧 `waiting_approval` 事件仍 SHALL 可只读解析，但不再在升级时自动结束悬挂调用。
- 删除默认提示词的历史版本刷新逻辑与 `apps/agent-runtime/resources/prompts/legacy/` 快照。
- 删除对早期草稿 `session_input_files` 表结构的修复。
- 明确保留仍是现役行为或 spec 要求的兼容面：升级前数据库备份（`runtime-event-recovery`）、退役内置 Skill 清理（`instruction-skill-installation`）、`legacyComputerHelperRequest`（Desktop 现役 helper 协议）与 `CapabilitySource 'legacy'`（数据库语义值，不是兼容壳）。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `agent-tool-runtime`：去掉「升级时结束悬挂旧审批」的要求，保留历史事件只读解析。

## Impact

影响 `apps/desktop/src/main`（启动流程、`model-connections/connection-store.ts`、`model-connections/secret-cipher.ts` 及其测试）、`apps/agent-runtime`（`runtime-process.ts`、`repositories.ts`、`agent-files/agent-file-store.ts`、`database.ts` 与对应定向测试）和 `apps/agent-runtime/resources/prompts/legacy/`。不新增依赖，不改协议版本，不改公开 DTO。
