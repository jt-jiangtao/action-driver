# Tool Runtime 与只读 Sandbox 设计

## 目标

为 Action-Driver 建立所有后续能力共用的 Tool Runtime，并以工作区只读 Sandbox 验证真实“模型请求工具 → 执行 → 模型继续生成 → WebSocket 渲染 → 日志查询”闭环。

## 已确认范围

- Tool 与 Skill 分离：Tool 是可执行契约，Skill 是 manifest + 指令 + 编排包。
- 保留当前 OpenAI-compatible Chat Completions 流，在现有适配器上增加 tool calling。
- 显式 LangGraph 循环，不使用隐藏生命周期的高层 Agent 封装。
- 首版工具为 `sandbox.fs.list@1`、`sandbox.fs.read@1`、`sandbox.shell.run@1`。
- 文件工具只读且自动允许；shell 仅允许 `rg/head/tail/wc` 的参数白名单，并要求“允许一次”。
- 工具事件与助手 Markdown 分离，接口日志按一次调用聚合。
- 不实现 Web Search、Browser Use、Computer Use、MCP、写文件、补丁或任意代码执行。

## 成功标准

1. 真实兼容模型能发起工具调用并最终返回 Markdown 正文。
2. 工具调用可审批、拒绝、取消、超时、重连恢复和查询日志。
3. 路径逃逸、符号链接逃逸、未知命令、shell 语法、秘密环境变量和超限输出均被测试拒绝。
4. 无工具请求的现有文本流请求体和 UI 行为不回归。

## 架构摘要

```text
ModelGateway
    ↓ provider-neutral tool calls
LangGraph tool loop
    ↓
ToolRegistry → ToolPolicy → ToolInvocationService
                              ↓
                    SandboxToolExecutor
                              ↓
               runtime events / SQLite / logs
                              ↓
             WebSocket tool.* + final response.*
```

## 规范来源

本文件记录 Superpowers 设计门禁；完整行为规格、技术决策、替代方案、风险和迁移步骤以以下 OpenSpec 产物为准：

- `openspec/changes/add-tool-runtime-sandbox/proposal.md`
- `openspec/changes/add-tool-runtime-sandbox/design.md`
- `openspec/changes/add-tool-runtime-sandbox/specs/agent-tool-runtime/spec.md`
- `openspec/changes/add-tool-runtime-sandbox/specs/sandbox-execution/spec.md`
- `openspec/changes/add-tool-runtime-sandbox/specs/agent-skill-boundary/spec.md`

## Battle 结论

- 类型：架构
- 当前方案：通用 Tool Runtime → Sandbox → 后续 Web Search；Browser/Computer 后置，MCP 作为适配器。
- 被否方案：按能力分别定制执行链路；MCP-first。
- 主要权衡：先增加一层内部契约与状态机，换取权限、审批、取消、日志和 UI 状态不重复实现。
- 用户裁决：已确认当前方案，无覆盖风险。
