# E2E 交互契约与 AST 打包门禁设计

## 目标

所有用户可交互元素都提供稳定的路由式 `data-testid`，并具备明确的测试覆盖类型。正式打包必须先通过 AST 静态校验；缺失、格式错误、重复、动态构造不合规或未登记的交互元素都会阻止构建。

## 范围

覆盖原生按钮、链接、输入框、选择框、文本域、summary、contenteditable、基于 role 的交互节点，以及仓库内共享交互组件。disabled 控件同样纳入。功能控件验证实际行为；尚无功能的视觉控件登记为 `visual-only`，只验证存在、可见、唯一和测试 ID 合规。

## 命名契约

```text
e2e/<route>/<scope>/<target>#<type>
```

路径段使用英文小写 kebab-case。动态列表使用稳定业务 ID，不使用数组下标、中文文案、CSS 类名或 React 组件名。共享壳层归入 `e2e/shared/...`。现有非交互测试 ID一并迁移，仓库只保留一套命名方式。

## 技术设计

校验器是一个 Node 脚本，使用项目现有 TypeScript Compiler API 解析 TSX。它识别原生标签、交互 role、contenteditable 和登记的共享交互组件，验证直接 `data-testid` 或共享组件必填 `testId` 属性。动态 ID 只能由统一构造器生成。

交互契约清单记录 ID 或动态模式、逻辑路由、元素类型、`functional`/`visual-only` 覆盖模式和测试引用。AST 阶段验证清单闭合；E2E 在所有 Home、Task、Settings 状态中运行 DOM 审计，验证条件渲染后的唯一性和动态 ID。

根级提供 `validate:e2e-interactions`。Lint 先运行它，Desktop `prebuild` 也直接运行它，确保从根目录或包目录打包都无法绕过正式门禁。完整 Electron E2E 不进入 Build，避免把打包变成慢且易抖动的流程。

## Battle 结论

- 类型：架构决策。
- 当前方案：AST 强校验、显式交互清单和 E2E 运行时补充验证。
- 主要质疑：仅用 ESLint 难以校验跨文件契约；仅用运行时遍历会漏条件分支且拖慢打包。
- 替代方案：自定义 ESLint 规则；纯运行时 DOM 审计。
- 最终决策：用户明确选择 AST 强校验，并要求所有用户可交互元素全量覆盖。
- 主要权衡：接受一次性全量迁移和持续维护清单的成本，换取不可绕过的打包门禁和稳定 E2E 接口。
- 用户覆盖：视觉但尚无功能的按钮允许以 `visual-only` 测试直接通过，但仍必须具备测试 ID 和契约登记。
- 重新开启条件：发现无法由 AST 静态识别的新交互封装、跨渲染技术边界，或打包耗时超出可接受范围。

## 验证

校验器 fixture 覆盖所有成功和失败规则；组件测试验证测试 ID 透传；E2E 验证三个逻辑路由的所有既有状态；最终执行 frozen install、单测、类型检查、Lint、Build、E2E 和 OpenSpec 严格校验。
