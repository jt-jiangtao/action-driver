## 1. 资源与能力包

- [x] 1.1 建立能力归属/完整资源回归，验证四类文档、skills 和 imagegen 同包 catalog。
- [x] 1.2 迁移完整 Skill/脚本/许可证资源并生成纯 catalog；验证资源文件存在及内容一致。
- [x] 1.3 合并 web 搜索与读取模块；验证原工具 ID/schema、无 endpoint 读取可用。

## 2. Skill 执行与宿主

- [x] 2.1 将 Skill 工具定义/业务编排迁入 skills，保留安全宿主 ports；原 Skill 工具定向回归通过。
- [x] 2.2 Runtime 装配全部新包、配置与生命周期，清除传统副本和旧 web 归属；真实宿主停用/重启回归通过。
- [x] 2.3 更新构建归集、资源脚本和 npm workspace；构建及包类型检查通过，无插件内部导入。

## 3. 交付

- [x] 3.1 更新开发说明、桌面及打包断言；定向 E2E 验证插件 Skill/脚本使用。
- [x] 3.2 独立复审并修复；准备提交时一次全量验证和按需 E2E，记录已知无关失败。
- [x] 3.3 只提交本任务文件，同步主规范并按 OpenSpec 归档，保留其他线程改动。

## 验证记录

- 定向：真实 catalog/宿主停用、Skill 工具及跨工作区安装拒绝、旧 web 安装恢复/私有数据保留、Runtime 启动回归通过；脚手架在仓库外实际 npm 构建与宿主回收通过。
- 186 个迁移资源与 HEAD 原文件逐字节一致。包 build、Markdown loader、公共导出、Runtime 定向类型/lint 验证通过。
- 独立复审发现 npm exports 指向未分发源码和 Runtime 相对导入；已修复为 dist 默认导出、development 条件以及公共执行/provider 子路径。所有生产相对穿透导入已清理。
- 六个新增包导致串行启动超过原 5s 用例预算，改为并行加载独立 catalog/包及激活；原预算下 Runtime 8 个测试通过。
- 用户追加：SkillContribution 与其他指令文本直接 import 原文件；已应用于业务 Skill、Computer Use 与脚手架，不再生成内嵌正文。

### 提交前一次全量验证

- `corepack pnpm typecheck`：21 个 workspace 项目通过。
- `corepack pnpm lint`：通过，146 项 E2E 交互声明校验通过。
- `corepack pnpm test`：193 文件通过、1 失败、2 跳过；1181 用例通过、1 失败、2 跳过。唯一失败为 `cua-runtime.test.ts` 应用批准等待 `TIMED_OUT`，上一轮已在原 HEAD 单独复现，与本次迁移无关。未重复运行全量。
- `corepack pnpm test:e2e:local`：6 通过、2 失败、1 跳过。Skill 列表、主提示词、本地/GitHub 安装及双轮持久会话通过；失败均为现有 UI 断言：测试期望当前 Renderer 不再提供的“生图接口” combobox；预览实际已打开但 AntD 预览 img 未传递断言要求的 alt。独立复审确认 Renderer、local-runtime.spec、model-connections 及 AntD 锁定版本均未变，未扩大任务修改这些 UI/断言。
- `@actiondriver/pdf-plugin` npm tarball 在仓库外直接导入 `/catalog` 成功；脚手架同包原文件 import、构建和真实宿主回收成功。

- `corepack pnpm test:e2e:packaged:macos`：1 通过；包内全部迁移 Skill/脚本资源检查、Computer helper 签名及明确的 bundled Node/rg 检查通过。
- 本次提交只含迁移、公共导出、原文件 import 与对应规范；排除 browser-fork-baseline、implement-browser-use 规划和 docs/explorations 等其他线程改动。
