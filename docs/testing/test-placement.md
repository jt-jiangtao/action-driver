# 测试目录归属规则

## 规则

根 `tests/` 只放两类内容：

1. **根级脚本的测试**：覆盖仓库根目录脚本与其 `scripts/` 支撑代码，例如 `tests/unit/scripts/**`。
2. **包与包之间的边界测试**：验证某个包的元数据、导出或依赖边界约束另一个包，例如 `tests/unit/agent-runtime-package.test.ts`、`tests/unit/model-provider-boundary.test.ts`。

**任何单个包内部的逻辑测试必须放在该包自己的 `tests/` 目录**，不得放进根 `tests/`。

## 判断方式

- 只断言一个包内部的实现、状态或行为 → 放进该包的 `tests/`。
- 只运行根目录脚本或根级构建流程 → 放进根 `tests/`。
- 断言包 A 与包 B 之间的边界（依赖方向、导出面、元数据契约、跨进程装配）→ 放进根 `tests/`。

## 共享基础设施

根 `tests/setup.ts` 是 Vitest 的共享初始化入口，不承载断言；它只做全局配置，不改变本规则对测试文件的归属判断。

## 相关配置

Vitest 以仓库根为工作目录，收集 `**/*.test.{ts,tsx}`，但排除 `**/node_modules/**`、`**/out/**`、`**/e2e/**` 与 `thirdparty/**`。各包的包内测试通过包自己的 `tests/` 目录被同一份配置收集；不在根 `tests/` 复制包内逻辑测试。
