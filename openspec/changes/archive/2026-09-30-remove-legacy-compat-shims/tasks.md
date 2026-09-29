## 1. Desktop 旧连接迁移

- [x] 1.1 删除 `apps/desktop/src/main/index.ts` 的 `migrateLegacyModelConnections`、其启动调用与专用于它的导入
- [x] 1.2 删除整个 `apps/desktop/src/main/model-connections/`（`connection-store.ts`、`secret-cipher.ts`、只被该迁移使用的 `http-client.ts`）与对应测试，并跑 Desktop 主进程定向测试

## 2. 旧审批

- [x] 2.1 删除 `apps/agent-runtime/src/repositories.ts` 的 `cancelLegacyPendingApprovals` 与 `apps/agent-runtime/src/runtime-process.ts` 的启动调用
- [x] 2.2 删除 `apps/agent-runtime/tests/unit/repositories.test.ts` 中旧审批用例并跑该文件
- [x] 2.3 本变更的 `agent-tool-runtime` MODIFIED spec delta 与实现一致

## 3. 旧默认提示词

- [x] 3.1 删除 `refreshLegacyDefaultPrompt` / `isSupersededDefault` 与 `apps/agent-runtime/resources/prompts/legacy/`，删除对应测试并跑 `agent-file-store` 定向测试

## 4. 早期草稿表修复

- [x] 4.1 删除 `apps/agent-runtime/src/database.ts` 的 `repairSessionInputFiles` 迁移（原 version 15）、列常量与对应测试；`add-computer-app-approvals` 由 version 16 顺延为 15 保持迁移连续，并跑 `database` 定向测试

## 5. 收尾

- [x] 5.1 跑受影响包的定向测试与 `pnpm typecheck`
- [x] 5.2 记录验证结果（命令、通过数量、与本次改动无关的失败）

## 验证记录

Node 版本：默认 shell 的 **v20.14.0**（与仓库既有记录一致）。

- 迭代期定向测试：`pnpm vitest run apps/agent-runtime/tests/unit/repositories.test.ts apps/agent-runtime/tests/unit/agent-file-store.test.ts apps/agent-runtime/tests/unit/database.test.ts apps/desktop/tests/unit/main` → **112 通过 / 33 文件**。
- 受影响应用回归：`pnpm vitest run apps/agent-runtime/tests` → **674 通过 / 1 跳过**（104 文件）。
- `pnpm typecheck` → 全部包 Done，无错误。
- 未跑全量 `pnpm test` / e2e：本次改动尚未进入提交动作，且工作区同时存在其他回话的未提交改动（`apps/desktop/src/renderer/**`、`apps/agent-runtime/src/resources/**`、`packages/{contracts,runtime-contracts}/**` 与两个新 OpenSpec 变更）。
