# ActionDriver Agent 治理规范

本文件适用于在本仓库工作的所有开发 Agent。开始任务时必须先阅读本文件以及 [Agent Battle 协议](docs/governance/agent-battle-protocol.md)。

## 强制工作流

- 全程使用 OpenSpec 与 Superpowers：先调用适用的 Superpowers 技能，再按 OpenSpec 的 propose/update/apply/archive 流程处理项目变更。任何一方都不能替代或绕过另一方。
- 在改变项目状态前，必须说明任务属于“决策型”还是“执行型”以及判断依据。读取代码、规范、历史记录和运行诊断属于只读探索，可以在分类与 Battle 完成前进行。
- 产品方向、用户价值、交互流程、范围或优先级，以及系统边界、技术选型、数据所有权、部署位置、公共接口、安全约束或高返工成本变更，均属于决策型任务。
- 决策型任务必须先完成 Battle。Agent 必须检查用户观点与自身假设，提出有依据的反例，比较至少一个真实可执行的替代方案，并给出自己的推荐；不得仅复述或无条件接受用户方案。
- Battle 只有在目标与成功标准明确、关键假设已检查、替代方案已比较、主要风险已公开且用户完成明确裁决后才结束。结束前不得创建设计、修改文件、安装依赖或开始实现。
- 用户拥有最终裁决权。用户理解风险后可以覆盖 Agent 建议；Agent 必须记录覆盖项和已知风险，然后停止重复争论，除非出现新证据。
- 低风险、可逆、机械性且完全处于已批准决策范围内的任务属于执行型，可以直接推进，不得制造形式化争论。
- 执行过程中一旦发现产品歧义、架构冲突、不可逆影响、跨模块新依赖或显著范围扩张，必须停止相关写操作并升级为决策型 Battle。
- 已完成的 Battle 不得因后续机械任务重复开启；只有范围变化、假设失效或新证据出现时才重新 Battle。

## 决策留痕

- 与 OpenSpec 相关的 Battle 结论必须进入对应规划产物：proposal 说明 Battle 状态与最终方向，design 记录 Decisions、替代方案和 Risks / Trade-offs，tasks 只实现已裁决内容。
- 不经过 OpenSpec 的小型决策也必须按完整协议中的简明记录模板留下结论。
- 没有实质性异议时，应明确记录检查过的维度和“无实质性异议”，不得虚构反对意见。

## 测试与提交

- 全量测试是**提交动作的一部分，不是迭代工具**。判定标准很简单：还没准备执行 `git commit`，就是迭代期，此时**禁止**运行 `pnpm test`、`pnpm test:e2e:local`、`pnpm test:e2e:packaged:macos` 这类全量命令。
- 迭代期只运行与本次改动直接相关的定向测试，例如 `pnpm vitest run <改动到的测试文件>`、`swift test --filter <用例>`；必要时补 `pnpm typecheck`。每改一处就跑全量属于违规流程。
- 只有改动完成、准备提交时，才一次性运行 `pnpm typecheck`、`pnpm lint`、`pnpm test`；涉及界面、运行时或打包行为的改动在提交前再按需追加 `pnpm test:e2e:local`、`pnpm test:e2e:packaged:macos`。
- 同一个提交不得重复运行全量验证：提交前确认一次即可，结果（命令、通过／失败数量、已知且与本次改动无关的失败）写进提交信息或对应的 OpenSpec 记录。
- 提交只包含本次任务的改动：若工作区存在其他人正在编辑的无关文件（例如其它 OpenSpec 规划文件），不得一并提交，并在交付说明中指出。
- 测试归属：根 `tests/` 只放根级脚本的测试与包与包之间的边界测试；单个包内部的逻辑测试必须放在该包自己的 `tests/` 目录。判断方式见 [docs/testing/test-placement.md](docs/testing/test-placement.md)。

详细分类、检查表、对话顺序、结束条件、记录模板和示例见 [docs/governance/agent-battle-protocol.md](docs/governance/agent-battle-protocol.md)。
