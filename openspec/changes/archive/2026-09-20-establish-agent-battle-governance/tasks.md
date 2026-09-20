## 1. 发布仓库级治理入口

- [x] 1.1 新增根目录 `AGENTS.md`，写入任务分类、决策型 Battle 门禁、执行型例外、隐藏决策升级和用户最终裁决规则，并通过人工检查确认规则简短且引用完整协议
- [x] 1.2 在 `AGENTS.md` 中明确 OpenSpec 与 Superpowers 的使用顺序及只读探索边界，并通过对照规范逐项确认没有授权 Agent 跳过既有工作流

## 2. 编写完整 Battle 协议

- [x] 2.1 新增 `docs/governance/agent-battle-protocol.md`，定义统一流程、开始条件、结束条件、决策记录模板和用户覆盖机制，并通过文档检查确认所有规范场景均有对应说明
- [x] 2.2 在协议中分别提供产品 Battle 与架构 Battle 检查表，覆盖用户价值、场景、范围、替代方案以及边界、耦合、数据、失败模式、测试和演进路径
- [x] 2.3 添加决策型、执行型、执行中升级和“无实质性异议”示例，并验证示例不会要求 Agent 制造伪争论或重复已完成的 Battle

## 3. 集成 OpenSpec 决策留痕

- [x] 3.1 更新 `openspec/config.yaml` 的产物规则，使相关 proposal 说明 Battle 状态、design 记录 Decisions 与 Risks / Trade-offs、tasks 不重新打开已裁决问题，并通过 YAML 解析检查配置有效
- [x] 3.2 使用当前变更文档核对配置规则，确认最终决策、替代方案、主要权衡和用户覆盖信息均有明确落点

## 4. 验证治理规范

- [x] 4.1 运行 `openspec validate establish-agent-battle-governance --strict` 并修复全部校验错误
- [x] 4.2 检查 `AGENTS.md`、治理协议与 OpenSpec 配置之间不存在冲突、循环引用或不同结束条件，并记录最终验证结果
