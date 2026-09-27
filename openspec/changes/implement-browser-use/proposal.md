## Why

本期仅建立自有 Playwright 与 Electron/Chromium Fork 基线，验证源码构建与两套产物兼容运行，为后续接口扩展提供可追溯基础。不接入 ActionDriver 产品。

## What Changes

- 使用 https://github.com/jt-jiangtao/playwright 与 https://github.com/jt-jiangtao/electron，锁定确切上游版本和提交。
- 在独立工作区编译两套自有产物；Chromium 由 Electron 构建链获取，自有内核差异以补丁队列保存。
- 使用独立 Electron 测试夹具验证自有 Playwright 的导航、点击、输入、截图与关闭。
- Chromium 自有行为改动必须受 ACTION_DRIVER 平台宏控制；Playwright 自有实现必须位于自有目录，必要接线冲突先裁决，不隐含豁免。
- 记录来源、构建配置、架构、校验值与运行证据。

## Capabilities

### New Capabilities

- `browser-use`: 仅定义双 Fork 基线的独立兼容验证、生命周期及来源追踪行为。

### Modified Capabilities

无。

## Impact

- 两个 Fork 的源码基线、构建环境、补丁与独立兼容夹具。
- ActionDriver 仓库仅更新本期规划；产品代码、依赖、面板、工具与打包不属于本期。

## Battle Status

- 类型：架构决策型。
- 状态：2026-09-27 用户确认规划更新，随后明确收窄为只考虑 Fork；书面规划与执行计划已确认，按本会话执行。
- 最终方向：真实双 Fork 编译并独立跑通，不考虑具体扩展接口，不接入产品。
- 替代方案：用官方二进制验证连接。更快，但无法证明自有源码构建链路，故不采用。
- 用户覆盖：选择本期同时维护双 Fork，覆盖最初延后内核 Fork 的建议，接受初次构建与维护成本。
- 延后：ActionDriver 消费、内嵌面板、Browser Tool、Agent 闭环、具体扩展接口、Action Graph、Jev、高亮、接管与记忆。
- 重新开启条件：必要接线无法满足隔离要求、需改变控制边界或显著升级基线；不得擅自放宽约束。
