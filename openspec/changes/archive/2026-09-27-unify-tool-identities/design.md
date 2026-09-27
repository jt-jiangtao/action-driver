## Context

现有 registry/policy 使用独立 id/modelName/grants，历史事件保存工具 ID。跨插件授权由宿主权威上下文推导。CUA 内部 js/js_reset 和上游参考文档不是模型 API 命名层。

## Goals / Non-Goals

统一内置命名、公开 helper、区分 target、兼容旧会话；不引入云端执行器，不改写历史数据库，不修改 browser fork、第三方 CUA 代码或无关 UI。

## Decisions

1. 用户裁决 tools.<target>.<plugin>.<operation>；替代能力 ID 加 metadata 更短，但调用和授权需要额外 target 规则。当前内置都绑定 local，联网不等于 cloud，版本保持独立。
2. 公共 npm helper 构建位置无关 capabilityId 与 toolId/modelName；宿主绑定执行环境，不强迫已有第三方包重命名。
3. 兼容层限十二项原内置身份，只映射 local；registry 不重复发现，policy 与权威调用规范化 grants/名称；冲突拒绝。替代改写历史会丢失原始事实，因此只适配展示。
4. 同步 manifest/catalog、提示词/Skill、脚手架和活动识别；CUA 内部 API 及上游文档保持，通过项目导读/catalog 适配入口。包版本递增避免不可变缓存。

## Risks / Trade-offs

- [下划线规范化碰撞] → registry 强制冲突校验，不覆盖。
- [旧授权扩张] → 精确 ID/版本映射，只指向 local；测试 cloud 拒绝。
- [历史图片摘要丢失] → 读取/展示兼容 helper，不改写原事件。
- [上游 CUA 误改] → 只改项目命名边界与导读。

## Migration Plan

先建立失败回归，再更新公共 helper/装配和全部消费层，最后定向测试、真实宿主及 npm 构建、独立复审。提交前仅一次全量验证并记录基线失败；main 范围提交及规范归档。

Ruling: 原 workspace.dependencies.load 命名纳入 command.dependencies.load，按 command 已有宿主执行端口装配；其文件/依赖事实仍属于宿主，不增加授权或执行环境。
