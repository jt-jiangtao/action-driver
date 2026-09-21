## Why

当前桌面端交互控件缺少统一、可机器验证的 E2E 定位契约，新增页面或组件时容易遗漏 `data-testid`，导致自动化测试依赖文案、DOM 结构或临时选择器。需要在打包前通过 AST 强校验阻止缺失、格式错误或未登记的交互元素进入产物。

## What Changes

- 为所有用户可交互元素建立路由式 `data-testid` 规范：`e2e/<route>/<scope>/<target>#<type>`。
- 覆盖按钮、链接、输入框、Checkbox、Radio、菜单项、option、contenteditable 及项目内自定义交互组件；disabled 状态也必须具备稳定 ID。
- 新增交互契约清单，将每个测试目标标记为 `functional` 或 `visual-only`；视觉占位控件只需验证存在、可见和测试 ID 合规。
- 新增基于 TypeScript AST 的静态校验器，检查缺失 ID、命名格式、重复静态 ID、动态 ID 构造方式和契约登记。
- 将快速 AST 校验接入 Lint 与正式 Build；任一违规 MUST 阻止打包。
- 补充组件测试与 E2E，功能控件验证实际行为，视觉占位控件验证可发现性与契约完整性。
- Battle 已完成：用户裁决采用“AST 强校验 + 交互清单 + E2E”，明确不允许仅依赖 ESLint 或运行时遍历；当前无未解决关键分歧。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `desktop-ui-components`：把组件级可验证性扩展为覆盖所有交互元素的稳定 E2E 测试接口、交互契约分类和打包前 AST 强校验。

## Impact

- 影响 `apps/desktop/src/renderer/src/**/*.tsx` 中的所有交互元素及共享交互组件 API。
- 新增测试 ID 构造与交互契约模块、AST 校验脚本及其单元测试。
- 调整 renderer 组件测试、Playwright E2E、根级 Lint/Build 脚本。
- 不改变用户可见业务流程，不引入新的运行时外部依赖；校验器复用项目现有 TypeScript AST 能力。
