# 非 macOS 平台未实现内容

更新：2026-09-28。对应 OpenSpec：`reconstruct-codex-cua-packages`。

本期用户裁决只重建与验收 macOS。下列项目均为**延期、未实现且未验收**，不是已完成模块；原 vendor 全部内容已按原结构备份在 `thirdparty/backup/`，保留用于未来对照。通用 TS 代码能构建或 mock 测试通过，不代表支持 Linux/Windows。生产加载与打包已切换为 `@actiondriver/*` 自有实现，`apps/agent-runtime/vendor/` 已删除。

## 平台入口与现有行为

| 包／入口                        | Linux、Windows 缺口                                                                           | 当前候选版行为                                                                                                 |
| ------------------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `@actiondriver/sky`             | 平台工厂、连接、请求、观察、动作、音频及平台资源                                              | 实现 MacComputer；`loadMacOptions` 只接受 `target: mac`，不自动构造 Linux/Windows 客户端                       |
| `@actiondriver/cua`             | Linux/Windows computer session、应用/窗口绑定与对应文档、默认平台分发                         | 已实现通用发现与 macOS session；通用发现中残留的平台分支不是平台 backend 实现                                  |
| `@actiondriver/cua-repl`        | Linux/Windows 指令资源装配、配置、服务启动和平台子进程生命周期验证                            | `loadInstructions` 只接受 `darwin`；其他平台明确拒绝。仅 macOS/global 候选资源，不将 vendor 指令存在当作已接线 |
| `@actiondriver/browser-runtime` | Linux/Windows browser 服务启动、宿主集成、浏览器路径/profile 发现、打包原生依赖兼容和真实操作 | macOS 候选 setup/service 已接线但未完成特权原生管道及页面端到端验收；Linux/Windows 未实现也未验收 |
| Sky core 命令工具               | Windows `win32_cmd` 包装及 Windows 可执行文件/环境处理                                        | 当前测试和重建范围为 macOS；通用工具存在不等于 Windows 支持                                                    |

## Linux 自有模块

证据根：`thirdparty/backup/codex-cua/@oai/sky/dist/project/cua/sky_js/src/targets/linux/`（历史原件备份；原路径 `apps/agent-runtime/vendor/codex-cua/...` 已在自有宿主切换后删除）。`thirdparty/backup/codex-cua/@oai/cua/dist/project/cua/sky_js/src/targets/linux/` 也捆绑了对应文件；两个原包均应核对，避免只验收一份。下表按模块归组，`.d.ts` 与 `.js` 合并显示；用途依据文件导出、平台工厂与接口，细节仍须在启动 Linux 重建时逐项核实。

| 原模块（含同名声明）       | 用途／延期内容                     | 状态           |
| -------------------------- | ---------------------------------- | -------------- |
| `accessibility_tree`       | 读取和转换无障碍树                 | 未重建、未验收 |
| `action_settler`           | 动作完成后等待状态稳定             | 未重建、未验收 |
| `activate_window`          | 激活窗口                           | 未重建、未验收 |
| `audio_recording`          | 录音生命周期与结果                 | 未重建、未验收 |
| `click`                    | 点击                               | 未重建、未验收 |
| `create_client`            | 组装平台客户端、选项和动作集合     | 未重建、未验收 |
| `drag`                     | 拖动                               | 未重建、未验收 |
| `drag_handle`              | 分阶段拖动句柄                     | 未重建、未验收 |
| `element_ids`              | 无障碍元素 ID 管理                 | 未重建、未验收 |
| `get_screenshot`           | 截屏                               | 未重建、未验收 |
| `get_window_state`         | 窗口观察结果装配                   | 未重建、未验收 |
| `launch_app`               | 启动应用                           | 未重建、未验收 |
| `list_apps`                | 发现应用                           | 未重建、未验收 |
| `list_windows`             | 发现窗口                           | 未重建、未验收 |
| `move`                     | 移动指针                           | 未重建、未验收 |
| `move_relative`            | 相对移动指针                       | 未重建、未验收 |
| `perform_secondary_action` | 元素次级动作                       | 未重建、未验收 |
| `press_key`                | 按键                               | 未重建、未验收 |
| `scroll`                   | 滚动                               | 未重建、未验收 |
| `sky_linux`                | Linux 上层接口与平台配置           | 未重建、未验收 |
| `sky_linux_transport`      | Linux backend 连接、请求、生命周期 | 未重建、未验收 |
| `type_text`                | 输入文字                           | 未重建、未验收 |

Linux 的 `index.d.ts` 平台导出，以及 `fixtures/{run_sky_service,echo_sky_linux,failing_sky_linux,run_sky_linux}.d.ts` 声明夹具也未重建。只有声明的文件不能据此推断可运行实现已存在。`drag_start/drag_move/drag_end` 的 Linux 句柄服务分发未实现，候选 Sky 服务明确返回错误。

## Windows 自有模块

证据根：`thirdparty/backup/codex-cua/@oai/sky/dist/project/cua/sky_js/src/targets/windows/`（历史原件备份，原路径已删除）；CUA 包中有对应捆绑副本。

| 原模块（含同名声明）                | 用途／延期内容                       | 状态           |
| ----------------------------------- | ------------------------------------ | -------------- |
| `create_client`                     | 组装平台客户端、选项和动作集合       | 未重建、未验收 |
| `internal/codex_turn_metadata`      | 运行回合 metadata 传递               | 未重建、未验收 |
| `internal/computer_use_client`      | Windows 请求客户端                   | 未重建、未验收 |
| `internal/computer_use_client_base` | Windows 客户端公共请求和配置逻辑     | 未重建、未验收 |
| `internal/helper_transport`         | helper 子进程、请求/事件、超时和关闭 | 未重建、未验收 |

Windows 的 `index.d.ts` 平台导出未重建。helper 的 `onEvent/onExit/request/close`、elicitation、turn metadata、超时后保留或关闭子进程、参数和 helper 环境变量处理都未完成。不能用 macOS native pipe 握手测试作为 Windows helper 验收证据。

## 平台资源与第三方依赖

- REPL 原始 `instructions/linux/` 与 `instructions/windows/` 下各自的 `description.md`、`computer.md`、`browser.md`、`browser-cloud.md`、`output.md` 未接入候选包。
- cloud/orbit 是 browser 环境标识，不是操作系统。macOS 指令选择保留这两个环境标识，并不表示 Linux 云桌面、Windows 或相应 backend 已实现。
- 原 native helper、服务可执行文件与浏览器 WASM 属于原生／资源边界，不在自有 JS 源码重建范围内；未来各平台必须明确资源来源、版本、启动、权限与生命周期。
- 三方库继续按核实后的原版本引用并锁定，不重写。browser 的 `classic-level` 等包有 Linux/Windows 原生预编译资源，不能沿用 macOS 测试推定其他平台可用。当前第三方安装与锁定本身尚未整体完成。
- browser 服务 bundle 的 132 个原始 `unknown` 文件已有逐文件归属审查，见 `analysis/codex-cua/ownership-review.json`；其中 3 个混合 bundle 内部的自有/第三方代码边界，以及 `tslib` 的确切版本仍未完全厘清。平台分支不能因文件级审查完成而视为已还原。

## 后续平台验收要求

扩展某个平台时，先更新同一 OpenSpec 并确认目标范围，再实现该平台工厂、backend 和宿主接线；不得静默回退为 macOS。补每个模块正常、非法输入、超时、断连、取消与资源清理的单元对照，并在可重置的目标系统夹具上验证应用发现、窗口状态、截图、动作、音频、browser profile、下载和服务重启。平台独立构建、三方安装/锁文件与打包验证通过后，才能标为该平台支持。

本文件不表示 macOS 整体重建已完成：Browser/Tab/capabilities、命令 schema、manifest 与默认客户端已局部完成；候选服务端的真实 macOS 验收、认证和富文本等路径及最终依赖切换仍未完成。

## 原包保留位置

`apps/agent-runtime/vendor/` 的全部内容（现只有 `codex-cua/` 顶层集合）原样备份在 `thirdparty/backup/`，该目录是历史原件备份，原 vendor 已在自有宿主切换后删除，生产运行与打包读取的是 `@actiondriver/*` 自有实现。Linux/Windows 原始模块、三方库、声明和指令仍在备份中；保留文件不表示该平台候选实现已完成。备份哈希和链接清单在 `thirdparty/backup/backup-manifest.json`。

配置装配补充：候选 CUA 的配置加载内部边界对非 darwin 先拒绝，再加载后端；macOS 运行时若收到非 mac target 也拒绝。测试只验证拒绝和无加载副作用，不代表 Linux/Windows 原包实现已重建。浏览器环境标签 cloud/orbit/training 的协议兼容继续不计新增平台或部署环境支持。

Current progress clarification (2026-09-28): Browser/Tab concrete capabilities, public command schemas and default client/CUA global loaders are now implemented and tested under controlled trusted hosts. Browser service backend and real macOS acceptance remain incomplete; earlier progress notes above are historical. Sky public Options/Client and Window namespace expose only macOS; FullDesktop/Window2 runtime/type surfaces remain deferred.

### Browser keyboard input

The reconstruction implements macOS key dispatch and editing commands only. Original Linux/Windows ControlOrMeta resolution and editing command paths are not implemented or accepted. service-keyboard-input.ts rejects platform values other than darwin before dispatch. Shared key names/aliases/chords are retained as data; retaining those tables does not imply other-platform support. Mouse/DOM unit behavior is covered; real native macOS service acceptance remains pending.
