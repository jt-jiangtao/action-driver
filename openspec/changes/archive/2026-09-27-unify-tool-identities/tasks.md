## 1. 命名与兼容

- [x] 1.1 建立新名称、旧名映射、授权和 cloud 隔离失败回归。
- [x] 1.2 公共 npm helper、registry 冲突/停用、policy/invocation 规范化。

## 2. 内置与消费层

- [x] 2.1 替换 manifest/catalog/modelName/grants、脚手架和项目指令，递增版本。
- [x] 2.2 Runtime/Desktop 历史展示及图片恢复兼容，保留原记录/上游 CUA。
- [x] 2.3 定向工具/宿主/模型循环/历史/npm 测试与构建通过。

## 3. 交付

- [x] 3.1 独立复审、定向修复、开发说明与规范。
- [x] 3.2 提交前一次全量 typecheck/lint/test 和运行时 E2E，记录基线失败。
- [x] 3.3 main 范围提交、同步归档，保留其他线程文件。

## Validation

- 失败回归：命名迁移初始四项失败，helper/registry/policy 接入后通过。
- 定向：48 个改动相关测试文件，456 通过、1 跳过；追加真实 command 宿主兼容/依赖工具回收回归，capability-plugin-packaging 4 通过。脚手架在仓库外安装 npm tarball、加载 catalog 与宿主执行回归通过。
- 构建：Runtime/npm SDK 构建通过；文档插件版本递增至 1.1.0，command/web/skills 1.1.0，image-generation/computer-use 1.2.0。
- 独立复审：唯一 P2 为四个文档插件版本未升级，已修正 package.json 与 plugin.json；其余未发现具体缺陷。
- 提交前一次全量：corepack pnpm typecheck 通过；corepack pnpm lint 通过（146 交互声明）；corepack pnpm test 1189 通过、1 失败、2 跳过。失败为既有 CUA 应用批准等待 TIMED_OUT，上一轮已在原 HEAD 复现，本轮未改对应源码/测试。追加宿主测试仅定向验证，未重复全量。
- corepack pnpm test:e2e:local：6 通过、2 失败、1 跳过；失败与上一轮一致，图片设置旧 combobox 与上传图片预览旧 alt 选择器，相关界面与用例未改。
- OpenSpec delta 严格验证通过，主规范同步后 23 项验证通过。
- 保留其他线程 browser-fork-baseline、implement-browser-use 及 docs/explorations 的改动，不纳入提交。
- corepack pnpm test:e2e:packaged:macos：1 通过；macOS helper 签名与捆绑 Node/Python/rg 校验通过。追加宿主测试定向 lint/typecheck 通过。
- main 规范已同步三个 requirement（两项新增、一项依赖工具命名与生命周期更新），归档后随本次范围提交。
