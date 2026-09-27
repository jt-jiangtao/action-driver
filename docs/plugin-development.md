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

模板对 extension 与 catalog 分别打包，运行时依赖不要求宿主安装第三方 node_modules。包导出构建后的 `example/catalog`，外部消费者可直接读取 `catalog.tools` 与 `catalog.skills` 继续拼接；执行层依赖公共 SDK，不导入 Runtime/Desktop 内部模块。

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

内置 command、web、skills、documents、pdf、presentations、spreadsheets、image-generation、computer-use 与外部包使用同一注册与生命周期。browser-use 只有接入边界，尚不发布操作工具。`corepack pnpm --filter @actiondriver/agent-runtime build` 构建并归集插件 catalog、执行入口、Skill 和 native 资源。Computer helper 源码位于 `plugins/computer-use/native`；构建入口与应用安装后的签名身份、Helpers 路径保持兼容。CUA 来源与分发限制见 `plugins/computer-use/SOURCE.md`，迁移不改变许可证。

提交前按 AGENTS.md 验证；迭代时只运行相关定向测试。脚手架回归会在仓库外实际安装 npm tarball、构建、加载 catalog、运行宿主并验证 Skill 回收。

能力按职责归属：web 同时暴露 `tools.local.web.search` 与 `tools.local.web.open`，未配置搜索 endpoint 时仍可读取网页；skills 暴露 `tools.local.skills.read`、`tools.local.skills.install` 与 skill-creator 指令；四类文档分别独立发布完整 Skill、脚本和资源；image-generation 包含 imagegen 指令和图片 provider 实现。任务、凭据、沙箱与持久化权限校验仍由宿主拥有。旧 search/web-reader 安装记录保留，启动时不再自动发现。

Skill 内容直接导入包内文件，例如 `import content from '../skills/pdf/SKILL.md?raw'`，其他 Markdown 指令同样导入。脚手架默认采用相同的文件导入方式。TypeScript 通过 `raw-assets.d.ts` 声明文本模块，Vite 测试和 esbuild 的 `.md: text` loader 读取原文件；构建后的 catalog 不需要源码路径。`scripts/sync-plugin-skills.mjs` 只更新元数据与资源清单，不再内嵌 Skill 正文。

内置包同样导出 `dist` 构建产物；`development` condition 供仓库内开发解析源码。Runtime 通过 `@actiondriver/skills-plugin/execution`、`@actiondriver/web-plugin/*` 和 `@actiondriver/image-generation-plugin/providers/*` 公共入口装配，禁止以相对路径穿透插件源码。

## 工具命名

内置工具统一 `tools.<target>.<plugin>.<operation>`。target 为 local 或 cloud，表示执行上下文和资源归属；本地工具调用远程图片/搜索 API 仍属于 local。插件 ID 使用小写 kebab-case，操作使用点号分层，版本独立存储。

公共 SDK 的 `createToolIdentity('local', 'command', 'node.run')` 返回 id `tools.local.command.node.run`、modelName `tools.local.command.node.run` 和位置无关 capabilityId `command.node.run`。构造 ToolDefinition 时选择 id/modelName 字段；capabilityId 是身份元数据，不属于工具 schema。宿主选择实际绑定，声明 cloud 名称不产生云端执行器或授权。

公开目录只提供点分隔名称，不注册未发布旧 ID、模型名或 grants 的兼容别名，也不回退 cloud 到 local。CUA 上游文档及内部 js/js_reset 保留，项目 Skill 导读说明公开点分隔入口。

依赖路径工具归入 `tools.local.command.dependencies.load`，随 command 生命周期注册；路径与执行环境仍由原宿主安全端口提供。脚手架默认生成 `tools.local.<plugin>.echo`。

## 工具详情字段

`ToolDefinition.presentation` 是公共 SDK 导出的可选 `ToolPresentation`。插件在纯 `src/presentation.ts` 导出按规范工具 ID 索引的 `presentations: Record<string, ToolPresentation>`，catalog 引用同一声明；包通过 `./presentation` 暴露独立入口。此入口只依赖类型，不导入 Skill 内容、执行器或激活逻辑，界面可用于历史调用恢复。

```ts
import type { ToolPresentation } from '@actiondriver/plugin-sdk'

export const presentations: Record<string, ToolPresentation> = {
  'tools.local.example.echo': {
    input: [{ label: '消息', path: 'message', kind: 'text' }],
    output: [{ label: '回显消息', path: 'result.message', kind: 'text' }]
  }
}
```

`input` 路径相对于工具参数；`output` 路径相对于宿主收集的输出，`stdout`、`stderr`、`content` 分别对应流文本，最终结果位于 `result` 下。路径采用点号，`*` 展开数组成员，例如 `images.*.prompt` 和 `result.results.*.title`；声明叶子字段，不声明整块对象。图片事件由宿主保存为 asset 引用，声明 `assets.*` 展示这些引用。

`presentation.layout` 可声明 `terminal`，由统一详情组件将代码和输出按终端外观排列；未声明时使用普通字段布局。字段可声明 `placement: 'footer'`，例如将退出码置于详情右下角。这些提示不改变字段含义，终端布局可省略可见标签。

字段必须包含有意义的 `label`、`path` 与 `kind`。类型为 `text`、`code`、`link` 或 `image`；代码可用 `language` 指明语言，布尔状态可用 `hideFalse: true` 隐藏没有发生的状态。缺失或空值自动跳过，零和 false 默认保留。链接只支持无凭据 HTTP(S)，图片只接受已校验的 `ImageAssetRef`，不能使用任意文件路径或 URL。投影有字段数量和文本长度预算，对象不会转换为 JSON；旧插件没有声明仍可执行，详情仅显示有效摘要。展示声明不改变模型参数 schema、权限或执行结果。

工具详情的 `placement: 'footer'` 仅用于输出侧文本状态字段（例如退出码）；代码、链接和图片保持正文展示。`layout: 'terminal'` 合并代码与文本输出，仍保留富链接和图片。任务组及工具正文均使用 640px 上限，溢出方向显示渐变。

公开工具 ID 和 modelName 保留点号；只有模型协议适配器发送请求时使用兼容名称，回传调用还原公开名称。协议名称冲突或超过长度限制会在发送前拒绝，插件无需进行名称转换。
