# 验证记录

分支为 main。全量验证只在准备提交时运行一次，失败后只对相关文件/场景做定向修复验证。

## 定向验证

- 公共契约/SDK、真实进程宿主、manager、storage、capability、MCP stdio/HTTP、有限重启、Desktop 面板：15 文件 45 测试通过；随后新增原有 underscore 工具 ID 回归，契约 8/8 通过。
- 脚手架 3/3：仓库外安装 npm tarball、真实 SDK 构建/测试/打包、纯 catalog 读取、进程加载、Skill 发布与回收。
- command/SessionSandbox 定向 19 通过；web-reader 25 通过；图像迁移 10 通过；search 与真实 HTTP 结果通过。Computer catalog/entry 和批准、取消、指导错误场景通过；批准等待计时用例有已知基线失败，见下。
- Swift ApplicationPolicyTests 11 通过；新路径 release helper 的 arm64 构建、签名校验及 designated requirement 已验证。darwin-x64 未在本机验证。
- 独立代码审查发现并修复 unknown 模型终态、崩溃清理覆盖新实例、graceful stop、面板消息未接入、Skill 未接入，以及异步服务启动泄漏。回归通过，复审未发现剩余阻塞项。
- OpenSpec strict change validation 通过；插件业务/公共包内部导入约束检查无命中。

## 一次性提交验证与修复

- `corepack pnpm typecheck`：17 workspace projects 通过。
- `corepack pnpm lint`：首次 4 错误，位于 http-service 的 import type 风格和 unknown fixture 的 require-yield；已修复，两文件定向 eslint 通过。其余全量 lint 无错误，146 interaction declarations 校验通过。
- `corepack pnpm test`：188 文件通过、4 失败、2 跳过；1166 测试通过、10 失败、2 跳过（1178）。其中 6 runtime-process 失败是 manifest 不接受既有 `computer.js_reset` ID 的真实迁移问题，已修复。定向重跑 runtime-process、公共契约、validator、SettingsPage：4 文件 44 测试全部通过。
- CUA 两个失败定向重跑：bindings/reset 通过；`does not count the real application approval wait against the cell budget` 仍 TIMED_OUT。该失败已用 HEAD 原始 cua-tools 临时基线复现，未放宽时间预算或修改原用例掩盖问题。
- `corepack pnpm test:e2e:local`：首次因上述 manifest 错误启动失败，2 失败、1 interrupted、1 skipped、5 未运行；确认共同根因后中断，未重复运行全量命令。修复后定向 Electron HTTP exact origin/token、main prompt/system Skills、two real turns：3/3 通过。Computer approval E2E 原本 fixme，仍未执行。
- `corepack pnpm test:e2e:packaged:macos`：首次旧检查仍要求 system-skills/computer-use，迁移后报 PACKAGED_SYSTEM_SKILL_MISSING。已将检查更新为插件包内 manifest/catalog/extension/Skill/SOURCE，并定向确认旧目录不存在、插件内容完整。arm64 helper 文件与签名在安装包内通过校验；随后仅定向运行 packaged-runtime 场景：临时定向装配首次缺少 pnpm deploy 未保留的 Python 运行时，按正式脚本的独立 ditto staging 补齐后 1/1 通过（8.9s）。覆盖认证、Computer 插件 Skill、Python/Node/Shell、沙箱越界、Office、取消与图片恢复；未重复全量打包验证命令。

这些记录保留首次失败，不把定向重跑描述为全量通过。无 npm registry 发布动作。

## 归档收尾

用户确认同步主规范并归档。plugin-platform 新增规范、agent-tool-runtime 新增插件工具归属规则已逐块比对同步；归档保留前述失败与已知基线限制，不将其改写为全量通过。此次仅文档收尾，未重复运行全量测试。

## 归档文档提交验证

用户再次确认提交归档文档，本次未改运行时代码。

- `corepack pnpm typecheck`：17 workspace projects 通过。
- `corepack pnpm lint`：通过，146 interaction declarations 校验通过。
- `corepack pnpm test`：189 文件通过、3 失败、2 跳过；1173 测试通过、4 失败、2 跳过（1179）。失败为 CUA bindings/reset、CUA approval-wait、App remount 恢复以及 SettingsPage testing 状态。
- 对上述 4 项仅做定向复查：3 通过、1 失败、46 未选中。仅 CUA approval-wait 的 TIMED_OUT 继续失败，其 HEAD 基线复现证据见前文；未改用例或扩大时间预算。未重复全量测试。
- plugin-platform、agent-tool-runtime 主规范 strict 验证通过；归档 29 项 tasks 全部完成、两份 delta 逐块比对通过；git diff --check 通过。
- 本次为文档提交，未重复运行时/打包 E2E；对应实施提交的真实 E2E 结果保留于前文。
