# 插件开发

插件是一个可信代码包：`plugin.json` 声明贡献和服务，`src/catalog.ts` 暴露纯工具 schema 与 Skill 内容，`src/execution.ts` 实现业务，`src/extension.ts` 只负责生命周期注册。Skill 文件、执行入口和可选 UI/native/service 资源一起分发。读取 catalog 不激活插件，也不授予工具权限。

## 创建与打包

公共 npm 包为 `@actiondriver/plugin-contracts`、`@actiondriver/plugin-sdk` 和 `create-actiondriver-plugin`，当前版本均为 1.0.0。仓库已提供可发布产物，尚未发布到 npm registry。

在仓库内可以立即生成项目：

```sh
node packages/create-actiondriver-plugin/src/index.mjs example --directory /absolute/path/example
corepack pnpm --filter @actiondriver/plugin-contracts build
corepack pnpm --filter @actiondriver/plugin-sdk build
corepack pnpm --filter @actiondriver/plugin-contracts pack --pack-destination /absolute/path/npm-packs
corepack pnpm --filter @actiondriver/plugin-sdk pack --pack-destination /absolute/path/npm-packs
```

在生成目录用 `npm install /absolute/path/npm-packs/<contracts-tarball> /absolute/path/npm-packs/<sdk-tarball>` 安装本地产物，再执行 `npm test` 和 `npm pack`。脚手架拒绝覆盖非空目录。发布后入口为 `npm create actiondriver-plugin example`；`--directory` 参数通过 npm 的 `--` 传递。

模板对 extension 与 catalog 分别打包，运行时依赖不要求宿主安装第三方 node_modules。包导出 `example/catalog`，外部消费者可直接读取 `catalog.tools` 与 `catalog.skills` 继续拼接；执行层依赖公共 SDK，不导入 Runtime/Desktop 内部模块。

## 宿主与生命周期

Runtime composition root 的 `createRuntimePluginPlatform` 接受明确的 Node 路径、宿主入口、工具注册表与窄接口 ports。`install(packageDirectory)` 校验并保存不可变版本；`enable(id)` 激活独立进程；`disable(id)` 停止新调用、排空在途调用并回收；`upgrade(packageDirectory, migration)` 固定旧调用版本；`uninstall(id, { deleteData })` 明确选择是否删除私有数据。安装包在重启时恢复发现，外部包默认保持停用，由调用方明确启用。当前没有面向用户的安装管理界面。

SDK 注册及打开的资源自动进入 `context.subscriptions`。插件可导出异步 `deactivate(reason)` 刷新状态，宿主先给它有界退出时间，再回收残留资源。不要在插件里创建全局服务定位器或另建生命周期管理器。崩溃或取消后无法确认副作用的调用报告 `RESULT_UNKNOWN`，不会自动重放；模型收到核查当前状态后再重试的提示。

实例身份包含 pluginId/version/hostEpoch，迟到响应不能写入新实例。私有存储按插件 ID 隔离且跨升级保留。不可逆数据迁移必须同时提供 backup/restore。包版本应随代码变化递增；相同版本不会覆盖已安装内容。

## 权限与资源边界

首版插件具有用户级可信代码权限；独立进程不是 OS 沙箱。模型脚本仍经过 SessionSandbox、任务 grants 和执行工作区校验。Computer 仍经过本机权限、应用批准和控制门。插件声明 `requires` 只描述依赖，不授予权限；跨插件调用还要求 manifest dependency 与宿主授权。

`services` 声明 Node/native/MCP stdio 或 HTTP 服务；宿主使用明确的运行时和平台产物，不回退到 PATH。MCP stdout 只承载协议，日志走 stderr。HTTP 凭据通过注入的 credential port 提供。有限服务重启不重放业务调用。会话、artifact、凭据、事件等可选 ports 未配置时返回明确的 UNAVAILABLE。

`panels` 声明本地 entry 或 HTTPS URL 和消息 JSON schema。`context.api.panels.register(id, handler)` 处理已校验消息；`open/close` 返回宿主拥有的资源句柄。Desktop 使用隔离 preload，只暴露固定的 `actiondriverPanel.postMessage(type, payload)`。网页没有 Node、任意 IPC、弹窗或设备权限，消息绑定实际 webContents、主 frame、面板与插件实例。查看事件没有 task 或输入控制 grants。

Skill 由统一指令宿主发布，资源来自同一包，停用后立即不可发现/读取并清除已加载状态；界面将其标为只读插件内容。不要复制插件 Skill 到传统 system-skills 目录。

## 内置包与构建

内置 search、command、web-reader、image-generation、computer-use 与外部包使用同一注册与生命周期。browser-use 只有接入边界，尚不发布操作工具。`corepack pnpm --filter @actiondriver/agent-runtime build` 构建并归集插件 catalog、执行入口、Skill 和 native 资源。Computer helper 源码位于 `plugins/computer-use/native`；构建入口与应用安装后的签名身份、Helpers 路径保持兼容。CUA 来源与分发限制见 `plugins/computer-use/SOURCE.md`，迁移不改变许可证。

提交前按 AGENTS.md 验证；迭代时只运行相关定向测试。脚手架回归会在仓库外实际安装 npm tarball、构建、加载 catalog、运行宿主并验证 Skill 回收。
