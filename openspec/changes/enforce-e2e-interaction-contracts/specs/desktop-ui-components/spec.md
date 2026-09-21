## MODIFIED Requirements

### Requirement: 支持组件级验证
系统 SHALL 为所有用户可交互元素提供语义查询所需的标签、角色和状态属性，并 SHALL 提供符合 `e2e/<route>/<scope>/<target>#<type>` 规范的稳定 `data-testid`。系统 MUST 通过自动化测试覆盖功能行为或明确登记为视觉占位，并 MUST 在正式打包前使用 AST 静态校验阻止缺失、格式错误、重复或未登记的测试契约进入产物；页面组合状态仍 SHALL 通过基准截图验证。

#### Scenario: 控件行为测试
- **WHEN** 控件能够触发导航、提交、选择、切换、输入、展开、关闭或异步操作
- **THEN** 控件具有路由式测试 ID，交互契约标记为 `functional`，且自动化测试通过该稳定接口验证用户可观察结果

#### Scenario: 视觉占位控件测试
- **WHEN** 按钮或其他交互外观尚未连接实际业务功能
- **THEN** 控件仍具有路由式测试 ID，交互契约明确标记为 `visual-only`，且测试验证其存在、可见和测试 ID 合规后即可通过

#### Scenario: 覆盖全部交互元素
- **WHEN** 开发者运行交互契约校验
- **THEN** 按钮、链接、输入框、Checkbox、Radio、菜单项、option、contenteditable、自定义交互组件及其 disabled 状态均被扫描，不存在无测试 ID 或无契约分类的可交互元素

#### Scenario: 阻止无契约打包
- **WHEN** 任一交互元素缺少测试 ID、命名不符合规范、静态 ID 重复、动态 ID 未使用批准的构造方式或未登记测试覆盖类型
- **THEN** AST 校验返回失败，Lint 与正式 Build 均停止且输出文件位置和违规原因

#### Scenario: 合规打包
- **WHEN** 所有交互元素均通过 AST 校验并登记对应测试类型
- **THEN** 正式 Build 继续执行，测试代码能够使用稳定契约定位页面中的每个交互目标
