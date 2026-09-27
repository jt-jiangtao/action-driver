## Why

现有 Codex CUA 与 browser 依赖仅包含编译或打包代码，不利于自主修改和长期维护。需要重建可维护实现，并以原包为基准验证行为一致。

## What Changes

- 新建 packages/cua、sky、cua-repl、browser-runtime 四个源码包，以及 packages/cua-parity 差异验证包，使用 @actiondriver 命名。
- 原始 vendor 保持基准职责，analysis/codex-cua 保存阅读副本。
- 固定基准、逐一分析全部自有 lib 的接口、用途和行为，依照项目架构重实现 TS，并建立原包和新实现的独立进程差异验证。
- 完整覆盖 oai_js_core、oai_js_types、oai_js_cua、oai_js_cua_repl、oai_js_browser 与 project/cua/sky_js；第三方库（包括 tslib、Statsig 及 browser 随附依赖）核实来源、锁定版本后复用，不重写。重复副本均记录来源映射。
- 前期生产运行路径继续使用原包，完成整体验收后才允许统一切换；最终切换另行记录实际验收与回退步骤。
- Battle：用户已确认长期维护、前期不替换、验收后整体替换及 packages 目录方案。已比较逐模块替换和 thridparty 布局，选择独立 workspace 包；接受没有 source map 无法证明所有未知行为一致及集中集成成本。后续用户明确要求每个自有 lib 全覆盖，并确认第三方库不用重写；采用接口与用途分析后自主实现，保留全部自有能力，不能只覆盖顶层入口。检查目录、接口、依赖、运行边界，无其他实质性异议。

## Capabilities

### New Capabilities

- codex-cua-reconstruction：规定源码重建、基准追踪、差异验证和整体替换门槛。

### Modified Capabilities

无。保持既有 Computer Use、Browser Use 和沙箱契约；不增加产品能力。

## Impact

新增 workspace 实现与验证包、分析资料和相关脚本。原包继续位于 apps/agent-runtime/vendor/codex-cua。不把源码阅读副本当成可独立维护实现，不重写已有第三方依赖，不把未复制的原生服务计入 JS 重建范围。

第三方引入方式：按已核实的确切版本写入各包 package.json，由 pnpm-lock.yaml 固定解析结果，不复制原包 node_modules 作为新实现的依赖树，不使用 ^、~ 或 latest。无法获取确切版本或原包包含定制修改时明确报告，不能静默替换版本。
