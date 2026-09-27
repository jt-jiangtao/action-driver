## Why

本期仅建立自有 Playwright 与 Electron/Chromium Fork 基线，验证源码构建与两套产物兼容运行，为后续接口扩展提供可追溯基础。不接入 ActionDriver 产品。

## What Changes

- 使用 https://github.com/jt-jiangtao/playwright 与 https://github.com/jt-jiangtao/electron，锁定确切上游版本和提交。
- 在独立工作区编译两套自有产物；Chromium 由 Electron 构建链获取，自有内核差异以补丁队列保存。
- 使用独立 Electron 测试夹具验证自有 Playwright 的导航、点击、输入、截图与关闭。
- Chromium 自有行为改动必须受 ACTION_DRIVER 平台宏控制；Playwright 自有实现必须位于自有目录，必要接线冲突先裁决，不隐含豁免。
- 记录来源、构建配置、架构、校验值与运行证据。
- 主仓库通过 Git submodule 追踪两个 Fork 的确切提交，使用直属 `thridparty/playwright/` 与 `thridparty/electron/` 路径，Chromium 构建工作区迁移到 `thridparty/build/electron-workspace/`；递归拉取获得两套源码，Chromium 和构建依赖仍由 gclient 单独同步。

## Capabilities

### New Capabilities

- `browser-use`: 仅定义双 Fork 基线的独立兼容验证、生命周期及来源追踪行为。

### Modified Capabilities

无。

## Impact

- 两个 Fork 的源码基线、构建环境、补丁与独立兼容夹具。
- ActionDriver 仓库更新本期规划、源码 submodule 注册及拉取文档；产品代码、产品依赖、面板、工具与打包不属于本期。

## Battle Status

- 类型：架构决策型。
- 状态：2026-09-27 用户确认规划更新，随后明确收窄为只考虑 Fork；书面规划与执行计划已确认，按本会话执行。
- 最终方向：真实双 Fork 编译并独立跑通，不考虑具体扩展接口，不接入产品。
- 替代方案：用官方二进制验证连接。更快，但无法证明自有源码构建链路，故不采用。
- 用户覆盖：选择本期同时维护双 Fork，覆盖最初延后内核 Fork 的建议，接受初次构建与维护成本。
- 延后：ActionDriver 消费、内嵌面板、Browser Tool、Agent 闭环、具体扩展接口、Action Graph、Jev、高亮、接管与记忆。
- 重新开启条件：必要接线无法满足隔离要求、需改变控制边界或显著升级基线；不得擅自放宽约束。

### 源码随主仓库拉取的补充裁决

- 状态：用户已明确确认 submodule 方案及本次四份规划修改。
- 目标：主仓库记录两个自有 Fork 的来源与版本，递归 clone 后能获得锁定源码。
- 替代方案：继续使用独立 clone 加手动拉取脚本；无需 Git 注册，但主仓库不能原生追踪源码提交，故不采用。
- 最终方向：使用两个直属 submodule，不使用浮动分支；Electron 源码位于 thridparty/electron，Chromium 及其独立 Electron 构建检出位于 thridparty/build/electron-workspace。工具、Chromium 依赖和构建产物不纳入主仓库源码。
- 已检查：嵌套 Git 路径、现有源码与构建缓存保护、递归 clone 和版本锁定。隔离实验发现普通 submodule add 会漏记 Electron gitlink；显式注册 gitlink 后递归 clone 成功，实施必须核验实际索引与源码提交。
- 权衡：拉取主仓库时需要递归初始化；Chromium 仍需独立同步，自有 Fork 新提交必须在对应远端可获取后才能更新主仓库指针。

### Electron 直属 submodule 布局修订裁决

- 状态：用户已明确确认直属源码与独立构建工作区方案及本次规划修改。
- 新证据：旧布局能递归拉取，但 Chromium 中间 Git 仓库使 Electron 的 --show-superproject-working-tree 返回空；Playwright 返回主仓库路径。旧方案没有满足完整的主仓库识别目标。
- 最终方向：迁移原 gclient 工作区到 thridparty/build/electron-workspace，将原 Electron 源码检出移至 thridparty/electron；构建工作区保持 src/electron 结构，使用同一源码提交的独立检出。
- 替代方案：继续保留嵌套布局并在编辑器显式添加仓库；不改变缓存路径，但 Git 主仓库识别问题仍存在，故不采用。
- 已知代价：增加一份 Electron 构建检出，需显式同步源码提交；移动工作区可能使部分绝对路径缓存失效，保留原产物并验证构建接线，不保证零重编。
- 验收：两套直属 submodule 均识别 ActionDriver 为主仓库；构建检出与源码提交一致，原补丁、未提交文件和产物得到保留。
