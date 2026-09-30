## Why

Action-Driver 的 Figma 文件已经多次出现文字裁切、手工坐标错位、模态框大留白、文本伪图标、控件状态缺失，以及按钮和下拉框因 padding、固定尺寸或长文本策略不完整而挤压内容的问题。现有运行时交互审计与组件核对表不能验证 Figma 源文件结构，需要一套可重复、可测试且不会把主观视觉判断伪装成自动通过的设计审计能力。

Battle 已完成。用户最终裁决采用“仓库内 Skill + Figma 插件快照 + Node 校验脚本”的两阶段方案，并明确要求使用结果型判定和合理例外：拒绝以手工绝对坐标掩盖流式布局问题，拒绝不合理固定宽高、拥挤、挤压和动态长文本无省略。当前无未解决关键分歧。

## What Changes

- 新增项目级 `auditing-figma-ui` Skill，规定 Figma 快照提取、确定性校验、截图复核和结果报告流程。
- 新增无 Figma Token 的 Node 校验脚本，消费标准化快照并以 error、warning 和精确例外输出结果。
- 校验文字越界、文本伪图标、变体与 Section 重叠、模态框边界与留白、reaction/state 覆盖、手工流式布局和动态内容固定尺寸风险。
- 为按钮、下拉框、筛选器和模型选择项增加内容预算、padding、尾部图标预留、单行省略和跨状态几何一致性校验。
- 新增 Action-Driver 页面、权威组件、状态、交互基线和合理覆盖层配置，并提供根级测试与校验命令。
- 使用真实 Figma 六个页面运行全面审计，输出精确 node id、测量值、截图复核结果与后续修复清单；本变更不自动修改 Figma。

## Capabilities

### New Capabilities

- `figma-ui-auditing`: 定义 Figma 结构快照、布局与控件规则、交互状态验证、例外机制、Skill 工作流和真实文件审计报告要求。

### Modified Capabilities

无。`desktop-ui-components` 已定义产品实现应使用可扩展布局和完整状态；本变更新增的是验证这些约束的开发审计能力，不改变现有产品行为要求。

## Impact

- 新增 `.agents/skills/auditing-figma-ui/` 下的 Skill、规则参考、脚本和测试。
- 新增 `design/figma-ui-audit.config.json` 与审计报告，并修改根 `package.json` 暴露校验命令。
- 使用现有 Node.js 20、`node:test` 和 Figma MCP/Plugin API，不新增运行时依赖、不保存 Figma Token，也不改变 Desktop 产品代码或现有 E2E 交互审计。
