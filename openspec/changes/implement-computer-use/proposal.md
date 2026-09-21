## Why

产品终态要求"通用的电脑代操作"：Browser Use 完成后扩展到整个 macOS 桌面。当前 Computer Use 只有独立 Skill 边界与 Mock Provider，需要落地 macOS 原生能力：读取界面（AXUIElement）、注入操作（CGEvent）、采集屏幕（ScreenCaptureKit），并在权限受限时给出可诊断的降级。

## What Changes

- 新增 macOS 原生服务（Swift/Objective-C++），提供界面观察、动作执行与屏幕采集三个能力域。
- Computer Skill Provider 接入统一 Skill 契约与既有反向调用通道，与 Browser Use 完全独立注册与启用。
- 权限治理：辅助功能与录屏授权缺失时返回可诊断状态并引导用户在系统设置中授权，不静默失败。
- 数据最小化：屏幕采集与界面观察默认只在内存处理，不写入会话历史；只投影必要的步骤与状态。
- 页面投影：时间线展示桌面操作步骤与结果；控制条支持暂停、继续与人工接管，语义与 Browser Use 一致（高层统一、底层独立）。

## Capabilities

### New Capabilities

- `computer-use`: 定义 macOS 桌面观察、动作执行、屏幕采集、权限治理与用户控制的可见行为。

## Impact

- 新增原生服务目标（Swift/Objective-C++）与构建集成；Electron Main 负责启动/监督与通道适配。
- Runtime：Computer Skill Provider 注册与调用路径。
- 页面：步骤与接管投影；首版不新增独立页面。
- 测试：观察与动作使用可注入的替身，真实系统调用只在打包后冒烟验证。

## Battle Status

- 类型：架构（原生服务边界）+ 安全（权限与数据）。
- 状态：**方向已裁决**（仅 macOS、AXUIElement/CGEvent/ScreenCaptureKit、与 Browser Use 高层统一底层独立），实现细节待裁决：
  1. 原生服务通信：XPC（推荐，系统级隔离与生命周期）还是本地 WebSocket。
  2. 首版范围：前台应用窗口级操作（推荐）还是全屏级所有窗口。
  3. 屏幕采集策略：按需单帧截图（推荐）还是持续帧流。
  4. 权限失败处理：明确阻断并引导授权（推荐）还是尝试只读降级。
