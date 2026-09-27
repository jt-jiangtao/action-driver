## 1. 契约与投影

- [x] 1.1 公共展示 schema/helper 与 SDK 导出，RED/GREEN 验证数组、零/false、空值、无效链接、字段预算与图片引用。
- [x] 1.2 Runtime 事件保存声明并以脱敏数据产生详情，实时/快照/Renderer 聚合兼容，通过定向流协议和宿主测试。

## 2. 插件与统一界面

- [x] 2.1 内置十二项工具与脚手架声明语义字段，独立导出 metadata、版本递增，定向 catalog 与 npm 脚手架回归通过。
- [x] 2.2 统一 ToolDetails 与 640px 容器，移除 JSON 兜底和较小高度，定向组件及历史回归通过。
- [x] 2.3 真实浏览器验证长内容滚动、链接、代码和多类型布局，通过定向 UI 检查。

## 3. 交付

- [x] 3.1 独立代码复审并修复具体缺陷，记录定向验证。
- [x] 3.2 提交前一次全量 typecheck/lint/test，按需运行本地及打包 E2E，记录基线失败。
- [x] 3.3 同步规范并归档，main 范围提交，保留其他线程文件。

## 定向验证记录

- 公共投影、协议、runtime 定向测试初轮 114 项通过；修复恢复问题后定向回归通过。
- 插件 catalog、脚手架以及仓库外 npm 安装构建激活/停用验证通过。
- 最后 UI、时间格式、实时投影定向验证 82 项通过。
- 真实浏览器验证：工具与任务组高度 640px、自然代码高度与滚动、四边渐变同时有效、展开隐藏命令预览。
- 独立复审修复资产事件覆盖文本、失败结果快照滞后、终端 rich 字段丢失；footer schema 限制 output text。

## 提交前验证记录

- `corepack pnpm typecheck`：通过。
- `corepack pnpm lint`：通过，146 项交互声明校验通过。
- `corepack pnpm test`：1223 通过、2 失败、2 跳过；失败均在未改动的 cua-runtime.test.ts，仍查找旧 modelName js/js_reset，而实际工具已采用命名空间名称，不能取得 executor。未修改该测试或扩张本次范围。
- `corepack pnpm test:e2e:local`：6 通过、2 失败、1 跳过；图片 API 旧 combobox 名称、宽图预览旧 alt 选择器失败，与前次已记录失败一致。
- `corepack pnpm test:e2e:packaged:macos`：1 通过。
- 最终耗时边界定向测试 17 通过；包括 0ms 最小显示、毫秒四舍五入、秒一位小数和整数秒去 .0。
- `openspec validate --specs`：23 通过。
- 本次仅提交工具详情、插件展示 metadata、SDK/脚手架与对应规范；其他线程的 Electron fork、浏览器探索和规划改动保留。
