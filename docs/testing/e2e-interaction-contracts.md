# E2E 交互契约

桌面端的可交互元素必须使用 `e2e/<route>/<scope>/<target>#<type>` 格式的 `data-testid`。当前清单位于 `apps/desktop/e2e/interaction-contracts.json`，共 62 个唯一契约：41 个 `functional`、21 个 `visual-only`，其中 12 个使用稳定业务 ID 的动态模式。

## 新增交互

1. 原生交互节点直接添加字面量 `data-testid`；共享交互组件使用必填的 `testId` 属性。
2. 列表条目必须通过 `e2eId('.../:business-id#type', params)` 生成，参数使用 task、model 或 connection 的稳定 ID，不能使用数组下标或显示文案。
3. 在契约清单登记同一个静态 ID 或动态模式。已实现行为标为 `functional` 并引用验证用户可观察结果的测试；纯视觉占位标为 `visual-only`。
4. 为功能交互补充行为测试。纯视觉目标由 Playwright 通用审计验证存在、可见、唯一和格式合规。

## 共享组件

新增共享交互组件时，需要把组件名与承载 ID 的属性加入 `SHARED_INTERACTIVE_COMPONENTS`，将该属性设为必填并原样转发成 DOM 的 `data-testid`。AST 校验会同时检查组件调用点与最终原生节点，避免包装层绕过规则。

## 本地验证

运行 `corepack pnpm validate:e2e-interactions` 可单独执行 AST 与契约闭合检查。根目录 `lint` 和 Desktop `prebuild` 都调用同一个入口，因此 `corepack pnpm build` 与 `corepack pnpm --dir apps/desktop build` 会在违规时直接失败。

运行时覆盖由 `apps/desktop/e2e/interaction-audit.ts` 完成。它遍历原生交互标签、contenteditable 和交互 role，检查缺失、重复、未登记 ID，并确保所有 `visual-only` 契约至少在一个既有页面状态中出现。
