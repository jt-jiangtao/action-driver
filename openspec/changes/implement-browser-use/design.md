## Context

参见 `proposal.md` 的 Why。既有：`agent-skill-boundary`（Agent 通过 Skill 契约调用、Browser/Computer 独立）、`replace-agentd-with-local-langgraph-runtime`（Runtime 反向调用 Main 的 Provider、Mock Provider 已就位）、`run-agent-with-real-models`（真实模型驱动规划）。

## Goals / Non-Goals

**Goals**

- 内嵌浏览器真实执行观察与动作，并把过程与结果投影到界面。
- 建立 Action Graph 与稳定引用，为后续记忆与重放打基础。
- 保持 Browser 与 Computer 的独立边界。

**Non-Goals**

- 不实现定制 Chromium 内核改动与 Jev（Native Browser Engine 阶段）。
- 不实现 Page/Procedure Memory 与零 Token 重放。
- 不实现下载、上传、多标签管理等产品化增强。

## Decisions

### 1. 引擎适配层 + Provider 实现
定义 `BrowserEngine` 端口（导航、观察、动作、截图、取消），首版由 Playwright Fork 实现并注册为 `browser-use.playwright`；未来 Native 引擎注册为 `browser-use.native`。选择端口化的理由：引擎替换不影响 Skill 契约、页面与 Agent。

### 2. 内嵌载体
优先使用 Electron 的视图挂载能力在既有浏览器面板位置渲染真实页面，保留导航栏与浮动控制条的既有视觉；替代方案是独立窗口，会破坏"网页嵌入产品内部"的产品要求。

### 3. 观察模型（Action Graph 初版）
观察结果由三部分组成：可交互元素（角色、名称、引用、可选值）、可见文本（分段）、结构层级（父子与顺序）。引用使用稳定标识 + 指纹（角色、名称、层级路径哈希）；动作前校验指纹，失效即返回 `STALE_REFERENCE`。

### 4. 动作语义
动作集合固定，输入只允许引用或受约束参数（文本、按键、滚动量、等待条件）；未知动作与越界参数在入口拒绝。每个动作携带截止时间，取消通过 `AbortSignal` 语义传播。

### 5. 控制与接管
暂停/继续/接管复用既有 Skill 生命周期状态；接管期间 Main 侧拒绝 Agent 发起的动作（返回可诊断错误），用户交还后解除。

## Risks / Trade-offs

- [观察数据过大导致 token 与延迟上升] → 默认只返回可交互元素与可见文本摘要，按需展开子树；记录观察体积用于调优。
- [页面频繁变化导致引用失效] → 动作前校验指纹并在失效时要求重新观察；测试覆盖典型动态页面。
- [Playwright 与未来内核引擎能力差异] → 保留各自评测集与能力矩阵，只统一高层任务与报告。
- [内嵌视图与 Electron 渲染边界复杂] → 宿主封装在 Main，页面通过既有窄桥接收投影，不直接操作视图。

## Migration Plan

1. 引擎端口与 Playwright 适配（本地夹具页面测试）。
2. Provider 注册与 Runtime 反向调用接线。
3. 内嵌宿主与页面投影（高亮、时间线）。
4. 控制与接管接线。
5. 端到端验证与视觉状态更新。

回滚：把 Browser Skill 绑定回 Mock Provider，隐藏真实浏览器面板行为。
