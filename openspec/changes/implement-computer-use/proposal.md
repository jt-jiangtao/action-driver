## Why

产品终态要求"通用的电脑代操作"：在 macOS 14 及以上扩展到整个桌面。当前 Computer Use 只有独立 Skill 边界与 Mock Provider，需要落地 macOS 原生能力：读取界面（AXUIElement）、注入操作（CGEvent）、采集屏幕（ScreenCaptureKit），并在权限受限时给出可诊断的降级。用户已决定直接实施最终版，覆盖路线图中 Browser Use 先于 Computer Use 的原定顺序。

## What Changes

- 新增 macOS 14+ Swift 原生 helper，提供界面观察、动作执行与屏幕采集三个能力域。
- Computer Skill Provider 接入统一 Skill 契约与既有反向调用通道，与 Browser Use 完全独立注册与启用。
- 权限治理：辅助功能与录屏授权缺失时返回可诊断状态并引导用户在系统设置中授权，不静默失败。系统权限开启后默认可操作所有应用，不设置任务级应用白名单。
- 数据最小化：屏幕采集与界面观察默认只在内存处理，不写入会话历史；截图通过分块内存通道和短期句柄进入当次模型推理，只投影必要的步骤与状态。
- 页面投影：时间线展示桌面操作步骤与结果；控制条支持暂停、继续与人工接管，语义与 Browser Use 一致（高层统一、底层独立）。

## Capabilities

### New Capabilities

- `computer-use`: 定义 macOS 桌面观察、动作执行、屏幕采集、权限治理与用户控制的可见行为。

## Impact

- 新增签名打包的 Swift 原生 helper 与构建集成；Electron Main 通过私有 stdio 启动、监督并适配消息通道。
- Runtime：Computer Skill Provider 注册与调用路径。
- 页面：步骤与接管投影；首版不新增独立页面。
- 测试：观察与动作使用可注入的替身，真实系统调用只在打包后冒烟验证。

## Battle Status

- 类型：架构（原生服务边界）+ 安全（权限与数据）。
- 状态：**Battle 已裁决**。目标是仅在 macOS 14 及以上提供跨应用完整操作；在用户授予系统权限后默认允许操作所有应用。用户明确覆盖了任务级应用白名单建议，接受由此带来的误触其他应用与敏感内容暴露风险。最低系统版本由用户单独裁决为 macOS 14。
- 决策：签名 Swift helper 通过私有 stdio 与 Electron Main 通信；AXUIElement 优先观察，ScreenCaptureKit 按需单帧截图，CGEvent 执行受约束动作；缺少当前动作所需权限时阻断并引导授权；真实暂停、取消和人工接管必须阻止新动作，高后果动作执行前确认。
- 比较：任务级动态应用白名单能缩小误操作范围，但增加跨应用任务的授权步骤，已由用户否决。XPC 提供系统托管生命周期与更强进程隔离，但在 Electron 中需要额外原生桥；localhost WebSocket 增加监听入口。选择私有 stdio 降低集成成本，并在 Main 与 helper 双侧校验协议和动作。
- 截图数据裁决：用户选择分块的内存专用通道与短期句柄，不把原始截图写入 Skill 输出、LangGraph 检查点或会话历史；加密持久化截图方案已否决。
- Agent 循环裁决：使用现有多轮 Tool/Policy Gate 暴露类型化 Computer Tools，底层仍调用独立 Computer Skill Provider；不扩展只调用一次便结束的旧 Skill 分支。
- 执行确认裁决：点击、元素点击、输入、按键每次调用前都要求用户确认。仅按标签或模型声明判断高后果的替代方案更省步骤，却可能漏判无标签按钮或错误声明；用户选择更保守的逐次确认并接受频繁打断。
- 重新开启条件：正式签名包验证显示 helper 权限归属或私有 stdio 无法满足授权、安全或生命周期要求；或出现新的用户范围要求。
