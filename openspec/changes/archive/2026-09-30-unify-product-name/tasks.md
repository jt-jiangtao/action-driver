## 1. 包与开发入口

- [x] 1.1 更名所有工作区 npm 作用域、包依赖、导入、构建过滤器及锁文件；用包管理器检查工作区解析，并运行受影响包的定向类型检查。
- [x] 1.2 更名插件脚手架包、命令、生成模板及示例；运行脚手架单包测试并检查生成项目引用。

## 2. 桌面与 Runtime 身份

- [x] 2.1 更名应用展示、窗口、资源路径及渲染端引用，采用合法语义化代码标识符；运行桌面身份和渲染端相关定向测试。
- [x] 2.2 更名协议、IPC、环境变量、运行时目录、插件身份与观测标识，保持通信双方一致；运行对应合同与主进程定向测试。
- [x] 2.3 更名原生 helper、bundle、签名，以及 Electron 与 Playwright 两个 Fork submodule 的品牌源码、构建路径和测试夹具；分别创建本地提交，更新主仓库 gitlink 与锁定记录，并运行 Swift、Fork 和打包身份定向验证。

## 3. 文档与仓库一致性

- [x] 3.1 更新当前文档、OpenSpec 主规格与历史归档、脚本、配置、资源文件名和路径引用；校验内部链接及生成命令仍指向存在的文件。
- [x] 3.2 对主仓库及两个 Fork 的 Git 跟踪文件内容与路径运行大小写不敏感旧拼写扫描，修复每一处命中；检查新包、CLI、桌面展示与协议名称符合规格。

## 4. 最终验证与交付

- [x] 4.1 在准备提交时一次性运行 `pnpm typecheck`、`pnpm lint`、`pnpm test`，并按桌面、运行时和打包影响追加必要 e2e；记录通过数量与无关失败，不在迭代期运行全量命令。
- [x] 4.2 展示两个 Fork 本地提交及主仓库 gitlink 的审查结果，获准后推送并确认远端可获取；检查 `main` 差异与暂存区，将用户已有的 `apps/desktop/src/renderer/src/main.tsx` 改动纳入同一提交，排除其他无关改动；提交信息记录验证结果。

### 提交前验证记录

- `corepack pnpm typecheck`：通过，27 个工作区项目。
- `corepack pnpm lint`：通过，含 152 项 e2e 交互声明校验。
- `corepack pnpm test`：Node 20.14.0 下 429 个测试文件通过、7 个失败、2 个跳过；2612 个测试通过、11 个失败、2 个跳过。失败集中在 `URL.parse`、`Promise.withResolvers` 和旧依赖的 ESM 加载；以本机 Node 24.20.0 对这 7 个文件进行定向复核，39/39 通过。依照仓库规则未重复运行全量测试。
- `PATH=/opt/homebrew/bin:$PATH corepack pnpm test:e2e:local`：7/10 通过。三个失败分别是 preload API 列表缺少已存在的 `pluginContributions`、设置页找不到预期的生图接口下拉框、放大预览找不到预期的图片节点。对应测试的本次差异仅涉及名称替换；这些断言与当前界面/API 状态不符。
- `PATH=/opt/homebrew/bin:$PATH corepack pnpm test:e2e:packaged:macos`：1/1 通过，包含全量打包部署、原生 helper 签名及 Runtime 启动验证。
