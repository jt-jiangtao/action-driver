# 来源与实现状态

原始 vendor 只用于测试和说明，不作为候选实现依赖。

| 原始模块 | 候选职责 | 验证 |
|---|---|---|
| project/cua/sky_js/src/core/uint8.js | src/core/bytes.ts | 字节偏移、文件、编码成功/失败 |
| targets/mac/errors.js | src/mac/errors.ts | 全部 21 个 server code 和未知 code 的错误属性对照 |
| targets/mac/native-pipe.js 帧函数 | src/mac/rpc-codec.ts | UTF-8、8 MiB、分片、多帧与原包对照 |
| targets/mac/native-pipe.js 会话 | src/mac/native-pipe.ts | 串行化、metadata、deadline、响应/错误、超时、断连、非法输入 |
| targets/mac/native-pipe.js 连接/启动 | src/mac/native-connection.ts | 版本握手、重试、ensureService、启动 fallback、迟到连接关闭；启动序列原包对照 |
| targets/mac/client.js、client.d.ts | src/mac/client.ts、types.ts | 全部观察/音频/动作参数对照、校验、metadata 优先级、API version 缓存；6 项类型断言 |

上述 mac 模块在 @oai/sky 与 @oai/cua 的 dist/project/cua/sky_js 中逐文件比较，client.js、native-pipe.js、errors.js 字节相同；这两个来源都映射到同一候选实现。

协议上的 Sky 错误名称、服务 bundle ID、socket 默认路径和 CodexComputerUseIPC-5 API 版本保持原契约，属于外部标识；自有源码目录与命名不使用 oai_。

原生二进制不属于本次 JS 重建。nativePipe 与 launchServices 仍由既有 trusted nodeRepl 宿主提供，候选不绕过该边界。受控 EventEmitter 管道测试不等同于真实 macOS 服务验收。

尚未完成：其余 core/types 的完整映射、完整模块覆盖与真实服务运行。浏览器和生产接线未替换，不能声明整个 sky 包兼容完成。

## macOS 上层第四批

| 原始模块 | 候选职责 | 验证 |
|---|---|---|
| computer-use-policy.js | src/mac/policy.ts | 策略拒绝、未知 decision 失败关闭、审批内容/结果、冻结获准路径、metadata、时长与取消状态；受控依赖原包对照 |
| computer-use-telemetry.js | src/mac/telemetry.ts | 事件、初始化、用户补全、禁用网络/analytics、异常吞吐；Statsig SDK 夹具对照 |
| window_result.js | src/mac/window-result.ts | 截图/文本验证、按应用输出说明一次、Numbers 排除与原包对照 |
| create_client.js、list_apps.js、get_app_state.js 与全部操作包装模块 | src/mac/computer.ts | snake_case→原生参数、规范化应用清单、policy/telemetry 执行顺序与原包对照 |
| audio_recording.js | src/mac/computer.ts 音频分支 | 100–300000ms、审批、只读本地文件 URL、WAV bytes/data_url；原包对照 |
| lazy-client.js | src/mac/computer.ts defaultClient | 延迟创建并共享原生客户端；默认代理/受控跨包调用验证，真实宿主待验收 |
| load_options.js、create_client.js（包级） | src/service.ts/loadMacOptions、createMacComputer | 原配置 env 键保留，只接受 macOS 目标；Linux/Windows 暂缓 |
| service.js | src/service.ts | setup/execute、方法所属检查、音频 RPC 去除 bytes；原包 mac 对照 |
| sky.js | src/sky-proxy.ts、sky.ts | trusted RPC setup/execute、音频 bytes 恢复、setup 失败传播、本地延迟 fallback；原包 mac 对照 |

除 telemetry 外，本批 targets/mac 模块在 sky/cua 两处字节相同，均保留双来源对应。telemetry 两处的 Statsig import/捆绑形式不同，不能标为相同文件；已分别注入同一 SDK 夹具验证自有事件逻辑一致。

新 sky async 代理工厂屏蔽 then，避免 Promise 将失败代理当成 thenable；默认 sky 导出与 ./service 入口已添加。CUA 与 browser 默认工厂尚未完整接线。

第三方依赖 @statsig/js-client 已按捆绑路径识别版本 3.32.6 写入 package.json；不复制或重写其实现。已通过仓库指定 pnpm 12.4.1 实际安装并锁定 js-client 与 client-core 3.32.6。真实 SDK 与原包 SDK 的离线初始化、用户更新、事件接口对照通过；候选打包产物在独立临时目录离线安装并通过 frozen-lockfile 重装，子进程加载 service 与真实 SDK 成功。测试没有访问遥测服务，不等同于实际宿主/网络验收。

## 通用工具第五批

core/cli.js → src/core/command.ts/runCommand；core/package_bin.js → src/core/package-bin.ts/resolvePackageBin。stdin/stdout/stderr、退出/异常、环境合并、包根查找、存在检查和 env override 的原包对照通过。sky/cua 两份原文件字节相同，保留双来源。

win32_cmd 专属包装暂缓；不声明 Windows 支持。core/env.d.ts 和 unimplemented.d.ts 的完整行为证据尚未补齐，仍保持未完成；不以推测格式或错误文本充当原包对照。

## macOS public types

Original types/window declarations and Direction/MouseButton/Point map to src/types/window.ts and index.ts. Client/Options support macOS only. Compilation checks original mutual structural assignability, literal domains and invalid inputs. FullDesktop/Window2 remain deferred.

## Approved declaration-only implementation

2026-09-28 user approved documented autonomous contracts because original runtime files are absent. CUA core tools map to src/core/declared-helpers.ts; Sky env/unimplemented map to src/core/env.ts. Unit/type tests validate the approved contracts, NOT original runtime parity. Debounce default0ms, latest receiver/arguments; lazy first-success result cache (sync throws retry, Promise identity cached); env normalization and first-success/default cache follow declarations, while help/errors are project-defined. Full original edge equivalence remains unknown.

## Action-Driver macOS helper adapter (迁移中)

`src/mac/action-driver-host.ts` 将 Sky 形状的应用调用转为仓库 `@action-driver/runtime-contracts` 的 version 1 `ComputerHelperRequest`，宿主由调用方显式提供；候选适配器不打开 Codex 私有 pipe。首次读取/动作先发 `session-start`，随后发送 `app-state`（包含截图）或 `act`，关闭发送一次 `session-end`。应用列表直接走 `list-apps`。截图由 helper 的 PNG base64 转成既有 `data:` URL；权限、取消和超时错误沿 helper 返回，关闭中或关闭后拒绝新动作。13 项 Sky 适配/旧连接定向测试及包类型检查通过。

协议差异仍需实机验收：原 Sky native IPC 与 Swift helper JSON 消息并不兼容，适配器构造新请求而不转发旧帧。`scroll.pages` 暂按每页 600 像素换算，属于自有解释而非原包逐项等价；helper 不提供音频录制，两个音频方法明确报 `SKY_CAPABILITY_UNAVAILABLE`。旧 Sky native 连接和显式 RPC proxy 仍在候选源码中，尚未迁出，隔离扫描保持失败。默认 `sky` 入口已改为无宿主时直接报 `SKY_HOST_UNAVAILABLE`，导入包不再触发旧服务 setup；显式自有 helper 仍由 `createProductSky` 注入。本适配器通过单测不代表整个 Sky 包已完成或可替换生产。
