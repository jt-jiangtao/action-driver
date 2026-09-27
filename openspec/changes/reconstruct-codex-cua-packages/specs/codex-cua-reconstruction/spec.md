## Purpose

定义 Codex CUA、Sky、CUA REPL 与 browser JavaScript 代码的独立重建和长期维护流程，保证原包基准可追踪、对比结果可复现，并在整体验收完成前保持现有运行时依赖不变。

## ADDED Requirements

### Requirement: 独立源码与固定原包基准
系统 SHALL 将重建实现放在 packages/cua、sky、cua-repl、browser-runtime，对比框架放在 packages/cua-parity。系统 SHALL 保存原包版本、文件哈希、资源及依赖清单和原文件至重建模块的映射；阅读副本 MUST NOT 作为产品构建输入。

#### Scenario: 原包变化
- **WHEN** 原包文件与固定基准不一致
- **THEN** 差异验证明确拒绝并报告变更，不自动接受新基准

### Requirement: 行为差异验证
验证框架 SHALL 在独立进程中用相同输入和受控依赖执行两个实现，比较返回、错误、事件、底层调用及清理结果。系统 SHALL 明确记录归一化规则，MUST NOT 隐藏未知差异或把 mock 当成真实操作证据。

#### Scenario: 重建版出现错误差异
- **WHEN** 两个实现返回不同错误或执行不同底层调用
- **THEN** 报告保存可复现输入与差异，验收不通过

#### Scenario: 真实操作对比
- **WHEN** 比较 browser 或 computer-use 真实操作
- **THEN** 分别重置夹具后执行，比较操作结果及资源释放，截图只作为其中一项证据

### Requirement: 完整重建后才能替换
系统 MUST 在整体验收前保持现有生产依赖与 loader 不变。验收 SHALL 要求全部基准自有 lib、JS 模块及类型有实现和对应记录、公共接口兼容、关键成功与失败路径及跨包验证通过、browser/computer-use 真实场景通过、独立可复现构建成功，且无未解决的阻断差异。第三方依赖 SHALL 核实确切版本并通过 package.json 与锁文件直接引入，MUST NOT 纳入自行重写任务，未复制原生服务不属于 JS 重建交付。

#### Scenario: 部分模块完成
- **WHEN** 仅部分模块通过对比
- **THEN** 新实现只用于独立验证，生产运行仍使用原包

#### Scenario: 整体完成
- **WHEN** 全部验收条件通过并交付报告
- **THEN** 后续整体切换提供原包回退方案与实际运行验证记录

### Requirement: 每个自有库都有用途与契约说明
系统 SHALL 覆盖 oai_js_core、oai_js_types、oai_js_cua、oai_js_cua_repl、oai_js_browser 和 project/cua/sky_js 的全部自有代码及类型。每项 SHALL 记录用途、接口、依赖、状态、错误和副作用的证据及验证；内部实现允许按项目架构重新组织，MUST NOT 仅因当前产品未调用而遗漏能力。重复副本 SHALL 保留全部来源映射，归属未知的代码 MUST NOT 被自动排除。

#### Scenario: 多个原包包含同一工具库
- **WHEN** 清点发现内容相同的自有工具或类型库
- **THEN** 记录每个原始位置与共享实现对应关系，并验证各调用方兼容

#### Scenario: 只有类型声明
- **WHEN** 自有工具只有声明而缺少独立实现或行为依据
- **THEN** 将其纳入清单、补充证据与类型验证，证据缺失时明确记录，不声称已经完成

#### Scenario: 识别第三方库
- **WHEN** 依赖来源和确切版本已核实
- **THEN** 通过 package.json 声明确切版本并由锁文件固定，保留来源及验证记录，不安排自行重写；版本不可获取或存在定制修改时明确报告，不静默升级
