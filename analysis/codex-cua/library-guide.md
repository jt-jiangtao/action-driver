# 自有库用途与当前实现状态（2026-09-28）

本清单基于固定 vendor 文件，不证明源码全部完成。原始路径仅用于证据，候选目录和代码标识不用 oai_。

| 原库 | 用途 | 候选实现 | 尚未完成／验收 |
|---|---|---|---|
| oai_js_core | 通用运行时工具 | `packages/cua/src/core.ts` 等保留可验证的运行逻辑；只有声明的 delayed action、lazy evaluator、enumerate、invariant、sleep 按用户批准的自主契约实现并测试 | 声明专有工具没有原实现，不能证明逐项等价 |
| oai_js_types | 类型合并、参数与数组工具 | `packages/cua/src/types.ts` 等类型源及编译断言，已接入 CUA 调用方 | 最终跨包接口和打包复核 |
| oai_js_cua | CUA 初始化、能力发现、tinysky 适配 | `packages/cua/src/` 的会话、文档、能力发现、旧版 facade 和 macOS 默认工厂；原包对照及受控跨包测试 | 真实 macOS 浏览器和 computer-use 验收、生产入口切换 |
| oai_js_cua_repl | 平台 instructions 与 REPL 启动 | `packages/cua-repl/src/` 的 macOS 指令、启动和清理；插件模板按字节保留；候选 CLI 与 CUA 依赖在 App 自带 Node REPL 的隔离进程中完成 computer-only 初始化和重置对照 | 原复制包缺失 `bin/cua-repl.mjs`，命令行包装属于自主补全而非原文件逐项等价；browser 特权服务验收另行跟踪 |
| oai_js_browser | 客户端、服务端与 API 描述 | `packages/browser-runtime/src/` 的客户端 schema、capability、默认工厂、macOS 服务后端和 75/75 个命令注册项；富文本输入已接通并对照；见 `packages/browser-runtime/docs/source-mapping.md` | 自动认证安全审查仍拒绝；私密认证和原生凭据交付虽有受控差分测试，候选服务端仍缺真实特权浏览器端到端验收，生产尚未切换 |
| project/cua/sky_js | Computer Use 客户端、服务端、macOS 传输与类型 | `packages/sky/src/` 的通用工具、macOS 客户端/RPC/服务、音频、窗口、遥测和类型；原包对照；隔离特权宿主的候选服务 `setup`/原生应用发现通过 | 授权后 AX/动作、异常和清理的候选服务端实机验收；Linux/Windows 按用户裁决延期 |
| oai_js/node_modules/tslib | TypeScript 编译辅助 | 第三方，保留原包备份；候选 TS 编译不自行重写 | 若候选运行路径确需该包，核实版本后直接固定依赖 |
| Statsig 与 browser 随附三方库 | 遥测、schema、存储、浏览器注入、二维码等 | 直接锁定已识别版本：Sky Statsig 3.32.6，browser Statsig 3.33.1、Sentry 10.48.0、classic-level 3.0.0、playwright-core 1.59.0、zxing-wasm 3.1.2、markdown-it 14.1.1；Zod 按用户批准固定兼容 v3.25.76 | QR reader WASM 与原包内置文件 SHA-256 相同；原 Zod 确切版本未知，差异测试以已覆盖输入为限；Markdown 源码指纹和渲染边界指向精确 14.1.1 |

## 基准统计

条目 1117；原始分类仍为 `resource: 167`、`unknown: 132`、`first-party: 436`、`third-party: 382`。132 个 `unknown` 已逐文件复核，结果记录在 [`ownership-review.json`](ownership-review.json)，可用 `python3 analysis/codex-cua/review-unknown-ownership.py --check` 重算并核对 vendor、备份与 baseline 的文件字节和 SHA-256。分组为 Statsig 3.32.6 包源 61 个（client-core 52、js-client 9）、相应 CommonJS 构建虚拟模块 63 个、tslib 辅助文件 3 个、classic-level 3.0.0 入口 1 个、CUA 自有 banner 1 个、混合 browser bundle 3 个。清单逐项给出哈希、大小、版本依据和 import 反向关系，并给出每组清单哈希。

文件级未复核项为 0；仍未解决的是 3 个混合 browser bundle 内部自有代码与三方代码的精确边界，以及 3 个 tslib 文件的确切上游版本。混合 bundle 内有自有 `tab_screenshot` / `navigate_tab_url` 命令与 Playwright 等代码，不能整包作为三方依赖排除。`inventory.json` 保留原始 `unknown` 标记以免将文件级审查误写成 bundle 内部还原完成。原包全集已备份在 `thirdparty/backup/codex-cua/`，生产仍使用原 vendor。

本机 `/Applications/ChatGPT.app/Contents/Resources/cua_node` 中的三份已裁剪 `tslib.es6.js` 与复制包对应文件 SHA-256 相同：CUA/Sky 为 `072e9fea747565a13de5f48e08678fc4d30ca858c601238e839fc3749ab4e15f`，REPL 为 `97adafd19f12bc603ae9539ef8136c95ae2236e46d461a11009a4e47d92afa59`。该安装的 `.pnpm/lock.yaml` 记录 `tslib@2.8.1`，但依赖边来自 `@emnapi/runtime`，并非这三个 `@oai` 内嵌路径；不能据此认定辅助文件的确切上游版本，候选仍不直接引入或重写它们。

Browser 文档及键盘资源的原 bundle 与候选提取结果另由 `node analysis/codex-cua/verify-browser-resource-provenance.mjs` 只读核对 SHA-256；两个固定 provenance 记录均已通过。定向测试使用临时文件分别篡改来源和输出，确认两种漂移都会以具体路径拒绝。此校验不证明混合 bundle 的所有可执行函数已还原。

`python3 analysis/codex-cua/verify-macos-module-mapping.py` 逐路径检查本期 macOS 自有 JS 的候选源码存在：Sky 28 项及 2 项共享 core、CUA 内 Sky 复制树 27 项、CUA 自有 11 项、REPL 3 项；Sky 树另有 27 个 Linux/Windows 专属路径明确延期。该检查只证明文件级来源映射存在，不证明所有函数或真实宿主行为已通过；浏览器混合 bundle 的内部覆盖仍由命令/模块差分及整体验收继续确认。

## 已确认行为

- mirrorMap 使用 Object.entries；按顺序写正向与反向键，后写覆盖冲突；symbol 输入键不枚举。
- UnreachableCaseError 继承 Error，name 为 UnreachableCaseError，message 沿用 Error 构造语义。
- getApps：mac/windows 保留 list_apps 结果；linux 转 displayName，按 windows.length 判断 isRunning；未知 target 抛 UnreachableCaseError。
- getBrowserTabs：user.openTabs 失败输出 console.error 并继续；tabs.list 失败传播；按 id 合并，受控标签覆盖用户标签而保持 Map 插入顺序。
- getState：apps 与 browsers 并发，allSettled 保留部分结果；错误按 Native apps、Browsers 顺序记录；无错时省略 errors。
- 字节工具：保持 Uint8Array byteOffset/byteLength，编码 subarray 不含周围字节，读取文件失败不吞掉 ENOENT。
- 类型工具：Merge 为右侧覆盖，Pretty 展平映射，Param 按 Parameters 提取位置；编译测试不代表运行时证明。

## 重复来源

cua 和 sky 下 core、types、tslib 当前字节一致。inventory.json 的 duplicateOf 是内容重复线索；无论名称是否相同，合并实现前仍需检查调用语义，全部来源保持映射。

Sky 自有 JS 在 CUA 内另有一份复制树：54 个共同路径中 53 个字节完全相同；唯一不同的是 `targets/mac/computer-use-telemetry.js`，Sky 包直接导入 `@statsig/js-client`，CUA 包导入同版本 Statsig 的构建虚拟入口。独立 `@oai/sky` 还多一个 `service.js`。`python3 analysis/codex-cua/verify-duplicated-sky.py` 固定检查该集合与差异；候选复用 `@action-driver/sky` 的实现和固定的 Statsig 3.32.6，原复制树及备份保持完整。构建形式不同不等于逐项运行语义已证明，telemetry 事件仍以原包差异测试为准。

## 旧版 CUA 入口补充

`cua.js` 的导出单例主要负责初始化浏览器并绑定 computer/browsers/documentation，然后汇总状态；不等同于 tinysky_alt 的文档队列与操作 facade。对应独立实现为 `packages/cua/src/legacy-facade.ts`，已对照其重复/并发初始化和异常引用状态。默认 macOS 入口已接候选工厂，但完整服务和真实操作验收之前仍不可替换生产依赖。

`@oai/cua-repl/package.json` 声明 `bin/cua-repl.mjs`，但所复制 vendor 中没有该可执行文件；`plugin/.mcp.template.json` 和 `plugin/.codex-plugin/plugin.json` 实际存在。候选 `packages/cua-repl/bin/cua-repl.mjs` 只调用已对照的 `launch()`；两份插件资源逐字节复制并经实际打包验证。错误退出、可执行权限、打包依赖、真实 macOS 宿主中初始化和重置均已定向验证，详见 [`real-macos-repl-acceptance.md`](real-macos-repl-acceptance.md)。原缺失的 CLI 可执行文件行为仍不能逐项证明。

可复现实机对照：[`verify-macos-repl-host.py`](verify-macos-repl-host.py) 验证候选 REPL 启动与重置；[`verify-macos-sky-service.py`](verify-macos-sky-service.py) 验证候选 Sky 特权服务的只读发现与不存在的方法错误。两者只在独立子进程中改测试映射、结束后清理；候选 browser 特权服务的页面操作因缺少 App 可信 turn metadata 尚未完成。
