## 1. AST 校验基础

- [ ] 1.1 先为测试 ID 语法解析与 `e2eId` 动态构造器编写失败测试，再实现受控 route/path/type 校验，验证合法静态 ID、稳定业务 ID和全部非法格式用例
- [ ] 1.2 先用 TSX fixture 覆盖原生标签、contenteditable、交互 role、disabled 状态和共享交互组件的缺失 ID，再使用 TypeScript Compiler API 实现 AST 扫描，验证错误包含文件、行列和原因
- [ ] 1.3 为展开属性、条件 JSX、动态表达式、重复静态 ID、未经批准的动态构造和非交互节点编写校验器测试，验证 AST 规则不会被简单语法变化绕过且不会误报普通容器
- [ ] 1.4 建立共享交互组件登记与必填 `testId` API，运行组件类型检查和校验器 fixture，验证包装组件与原生节点形成闭合检查

## 2. 交互契约与全量迁移

- [ ] 2.1 建立交互契约清单及其 schema 校验，要求 ID/动态模式、route、type、`functional`/`visual-only` 和测试引用完整，并用失败测试验证重复、失效文件与缺失字段会被拒绝
- [ ] 2.2 迁移 Shared 与 Home 的全部交互元素及既有非交互测试 ID，使用 `e2e/shared/...`、`e2e/home/...` 命名，并运行 AST 校验确认没有遗漏
- [ ] 2.3 迁移 Task 的 Agent、模型选择器、Browser 面板和最近任务动态条目，使用稳定 task/model/connection ID 构造动态测试 ID，并运行 AST 校验与现有组件测试
- [ ] 2.4 迁移 Settings 列表、菜单、删除确认和添加模型集两步流程的全部交互元素，覆盖弹窗各状态并运行 AST 校验与设置页测试
- [ ] 2.5 扫描 renderer 全部 TSX 并更新现有测试选择器，验证旧命名不存在、每个交互目标都有唯一契约条目且所有 `data-testid` 均符合路由格式

## 3. 自动化覆盖

- [ ] 3.1 为每个 `functional` 契约补充或关联组件测试/E2E，验证导航、输入、选择、切换、提交、展开、关闭和异步状态的用户可观察结果
- [ ] 3.2 为每个 `visual-only` 契约补充通用测试，验证目标存在、可见、唯一和 ID 合规，不伪造尚未实现的业务行为
- [ ] 3.3 在 Home、Task 和 Settings 的全部既有场景加入运行时 DOM 审计，验证条件渲染后的交互节点无漏标、无重复且与契约清单匹配
- [ ] 3.4 添加回归测试：临时 fixture 缺少 ID、使用错误路由、重复 ID、未登记契约或功能条目缺少测试引用时，校验命令均以非零状态退出

## 4. 打包门禁与最终验证

- [ ] 4.1 新增根级 `validate:e2e-interactions` 脚本并接入 Lint，运行命令验证合规代码通过、违规 fixture 阻断且错误可定位
- [ ] 4.2 将同一 AST 校验直接接入 Desktop `prebuild`，分别从根目录和 desktop 包执行 Build，验证两条正式打包路径都无法绕过门禁
- [ ] 4.3 使用 pnpm 12 frozen install 后运行单测、类型检查、Lint、Build、完整 E2E、OpenSpec strict validation 和 `git diff --check`，验证全部通过且主工作区无非预期产物
- [ ] 4.4 更新交互契约清单统计与维护说明，记录 functional/visual-only 数量、动态模式和新增组件接入方式，并人工抽查所有页面状态无遗漏
