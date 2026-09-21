## Why

Browser Use 是产品第一阶段的核心能力（"网页必须直接嵌入产品内部，不启动外部浏览器"），当前只有内嵌浏览器占位与 Mock Provider。模型与 Skill 边界已就绪后，需要让浏览器真实执行：Agent 观察页面、选择动作、执行并展示结果，用户可以在页面内暂停、继续和接管。

## What Changes

- 内嵌浏览器真实导航：在应用内部载入页面，不调起外部浏览器；保留现有浏览器面板布局与导航栏视觉。
- Browser Skill Provider 真实实现：按统一 Skill 契约提供观察与受约束动作（导航、点击、输入、滚动、截图/文本观察、取消），带超时与取消语义。
- Action Graph 首次落地：把页面元素结构化为带稳定引用的观察结果，供 Agent 选择动作；引用在页面变化后按规则失效而不是静默指向错误元素。
- 页面投影：时间线展示观察与步骤，浏览器区域展示当前目标高亮；浮动控制条承载暂停、继续与人工接管。
- 引擎边界：首版实现 Playwright Fork 引擎，注册为 `browser-use.playwright`；为 Native/定制 Chromium 引擎保留独立 Provider 标识与评测边界，不抽象成同一底层实现。

## Capabilities

### New Capabilities

- `browser-use`: 定义内嵌浏览器的导航、观察、动作、目标高亮、控制与引擎替换行为。

## Impact

- 新增 Browser 引擎适配层与 Provider 实现；Runtime 通过既有反向调用通道请求 Main 执行动作。
- Main 新增内嵌浏览器宿主（视图挂载、导航控制、页面注入脚本）。
- 页面：浏览器面板与浮动控制条接线；时间线接收观察与动作事件。
- 测试：观察/动作使用确定性的本地页面夹具；视觉用例保持既有占位基线或按新状态更新。

## Battle Status

- 类型：产品（核心能力）+ 架构（引擎与观察模型）。
- 状态：**方向已裁决**（Browser Use 优先、内嵌不调外部浏览器、Action Graph 与稳定引用、Browser 与 Computer 独立），实现细节待裁决：
  1. 内嵌实现：Electron `WebContentsView` 挂载（推荐，贴近产品形态）还是独立窗口视图。
  2. 观察粒度：可交互元素 + 可见文本 + 结构层级（推荐），是否包含全量 DOM。
  3. 引用失效策略：页面变更后按指纹校验并标记失效（推荐），还是重新全量观察。
  4. Playwright Fork 与定制 Chromium Fork 的关系：Playwright Fork 先落地、Native 引擎并行保留（推荐），还是先不做 Playwright 直接投入定制内核。
