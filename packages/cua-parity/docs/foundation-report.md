# 首批交付

基准核验、接口清点、阅读副本、独立进程与差异报告框架已实现；全部自有库尚未完成，browser-runtime 和 cua-repl 仍为显式空骨架，不能替换原依赖。

## 单元验证

原包小模块采用测试专用 loader 加载，未在候选中引用 vendor。测试覆盖映射冲突、异常、标签合并与错误、跨平台状态、字节子数组、引用 URL、进程隔离、超时/退出、JSON 协议、差异检测、输出路径保护和基准漂移。类型库含 10 项编译期断言。

## 运行命令

在本工作区根目录执行：

```sh
pnpm --filter @action-driver/cua-parity build
pnpm vitest run --config packages/cua-parity/vitest.config.ts packages/cua-parity/tests packages/cua/tests/unit/core.test.ts packages/cua/tests/unit/discovery.test.ts packages/cua/tests/unit/tab-reference.test.ts packages/sky/tests/unit/bytes.test.ts
pnpm exec tsc --noEmit -p packages/cua/tsconfig.type-tests.json
node packages/cua-parity/dist/cli.js verify thirdparty/backup/codex-cua analysis/codex-cua/baseline.json
```

生成的分析入口为 analysis/codex-cua/library-guide.md、baseline.json、inventory.json 与 readable/source-index.json。未知捆绑边界保留，不静默排除。

## 审查与限制

独立审查发现并通过复现测试修复：原型同名字段漏报、CLI 输出覆盖输入、收到结果后非零退出误判、用户 JSON 异常误判、包元数据漂移遗漏。原包基准匹配。未进行产品运行接线、真实应用验收或 Git 提交。

第三方 exact 版本策略已确定；本批工具使用保留的现有版本，独立安装与新 importer 锁定尚未完成。离线依赖准备失败不视为全新环境验收通过。

最终定向验证：13 个测试文件、31 个测试全部通过；10 项编译期类型断言通过；原包基准匹配；OpenSpec strict 通过。五包构建已验证，未运行仓库全量测试。
