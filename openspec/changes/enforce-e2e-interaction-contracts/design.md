## Context

见 `proposal.md`。当前 renderer 同时使用原生交互标签、`role` 交互语义和多种共享按钮组件；现有 `data-testid` 数量少、命名不统一，构建流程也不会检查新增交互是否具备测试契约。项目已经依赖 TypeScript，可复用其编译器 AST，无需增加运行时依赖。

## Goals / Non-Goals

**Goals:**

- 为所有页面和组件建立稳定、可扩展且可机器验证的 E2E 交互接口。
- 在开发期和正式打包前发现遗漏，并给出精确到文件与节点的错误。
- 明确区分已实现功能与视觉占位，同时要求两类控件都可被测试发现。
- 让动态列表项使用稳定业务 ID，而不是数组下标或可变文案。

**Non-Goals:**

- 不用 `data-testid` 取代可访问名称、角色或键盘语义。
- 不在正式 Build 中运行完整 Electron E2E；Build 运行快速 AST 契约校验，完整行为测试仍由 `test`/`test:e2e` 执行。
- 不为视觉占位控件伪造业务行为。
- 不引入 Babel、独立 ESLint 插件或新的生产依赖。

## Decisions

### 1. 使用路由式测试 ID

格式固定为 `e2e/<route>/<scope>/<target>#<type>`，路径段使用英文小写 kebab-case，`type` 使用受控集合，例如 `button`、`link`、`input`、`checkbox`、`radio`、`option`、`menuitem`、`tab`、`page`、`section`、`nav`、`dialog` 和 `status`。共享壳层使用 `shared` 路由；动态目标通过批准的 `e2eId` 构造器加入稳定业务 ID。

不允许使用中文文案、数组下标、CSS 类名或 React 组件名作为身份来源。现有非交互 `data-testid` 同样迁移到此格式，避免仓库中存在两套命名体系。

### 2. 使用 TypeScript Compiler API 做 AST 强校验

新增 Node 脚本，使用项目现有 `typescript` 包解析 renderer TSX。校验器识别：

- 原生 `button`、`a`、`input`、`select`、`textarea`、`summary`；
- `contentEditable`；
- `role` 为 `button`、`link`、`menuitem`、`option`、`checkbox`、`radio`、`switch` 或 `tab` 的节点；
- 项目登记的共享交互组件。

每个目标必须直接提供合规 `data-testid`，或通过共享组件的必填 `testId` 属性传递。动态值只允许由统一构造器生成。校验器同时扫描所有测试 ID，检查格式、重复静态 ID和交互契约登记，并对每个错误报告文件、行列和修复原因。

选择 AST 而不是正则，是因为 JSX 展开属性、表达式、共享组件和 `role` 语义无法由文本匹配可靠判断。选择仓库脚本而不是独立 ESLint 插件，是为了复用同一校验核心并避免维护插件发布边界。

### 3. 使用显式交互契约清单

契约条目记录 ID 或批准的动态模式、所属逻辑路由、元素类型、覆盖模式和测试引用。覆盖模式只有：

- `functional`：必须引用验证实际用户可观察结果的组件测试或 E2E；
- `visual-only`：由通用契约测试验证存在、可见、唯一和 ID 合规。

AST 校验器验证清单无重复、无失效测试文件、所有交互目标都有条目，且功能条目提供测试引用。运行时 E2E 在 Home、Task 和 Settings 的全部既有状态中审计实际 DOM，补足条件渲染与动态 ID 的验证。

### 4. 把同一校验核心接入 Lint 和 Build

根级新增 `validate:e2e-interactions` 脚本。`lint` 先执行该脚本，Desktop 的 `prebuild` 也直接执行它，因此无论从根目录还是包目录执行正式 Build，违规都会阻止打包。校验器自身使用 fixture 单元测试覆盖正例、每类违规和动态 ID。

### 5. Battle 最终裁决

用户最终选择“AST 强校验 + 交互清单 + E2E”，并要求所有用户可交互元素都纳入范围。视觉但尚无功能的按钮允许直接通过视觉占位测试，但不得豁免测试 ID 或契约登记。

替代方案一是仅实现自定义 ESLint 规则，优点是编辑器反馈快，缺点是难以完整校验跨文件重复、动态 ID 和测试清单；未采用。替代方案二是只在 Electron 运行时遍历 DOM，优点是检查真实节点，缺点是无法保证所有条件分支都被渲染且打包速度和稳定性较差；只保留为补充 E2E，不作为唯一门禁。

## Risks / Trade-offs

- [契约清单产生维护成本] → AST 校验同步检查源码、清单和测试引用，错误信息直接给出缺失条目。
- [共享组件封装可能隐藏原生节点] → 共享交互组件使用必填 `testId` API，并由校验器维护受控组件集合及对应 fixture。
- [动态 ID 难以静态证明唯一] → 仅允许统一构造器与稳定业务 ID；E2E 运行时再检查当前 DOM 唯一性。
- [构建门禁增加耗时] → Build 只运行快速 AST 校验，不运行完整 Electron E2E。
- [测试 ID 可能被误用为业务逻辑] → 构造器和契约只位于测试接口边界，产品状态与选择逻辑不得读取 `data-testid`。
- [“所有可交互元素”会扩大变更面] → 用户已明确接受全量迁移成本；通过组件 API 和 AST 门禁防止后续继续扩散手工规则。

## Migration Plan

1. 先为 AST 校验器与命名解析器编写失败 fixture，建立规则基线。
2. 引入测试 ID 构造器、交互组件登记和契约清单。
3. 按 Shared、Home、Task、Settings 顺序迁移全部交互元素及现有测试 ID。
4. 为功能条目补充行为测试，为视觉占位条目补充通用存在性测试。
5. 接入 Lint 和 Desktop `prebuild`，运行单测、类型检查、Lint、Build 与完整 E2E。

回滚时可先移除 Lint/Build 门禁，再回退契约清单和组件属性；产品业务状态不依赖测试 ID，因此不会造成数据迁移。
