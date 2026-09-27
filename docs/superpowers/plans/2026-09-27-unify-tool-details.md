# 统一工具语义详情执行计划

用户已裁决插件声明、统一组件与 640px 最大高度。直接 main 实施；沿用 OpenSpec unify-tool-details 的 design/tasks。公共契约以 presentation 描述字段，details 携带可显示值。职责清晰的实现工作由子 Agent 完成契约/Runtime 和插件目录，主 Agent 实现统一组件与整合；各任务只定向测试，最后独立复审，提交前只一次全量验证。

Review Focus：未知与历史插件不倾倒 JSON；0/false/退出码不丢；长数组和长正文预算可见截断；禁用 rawToolIO 与脱敏不漏数据；实时 stdout/stderr 与恢复一致；单一 640px 滚动边界且窄屏不横向溢出；图片只用已有资产读取接口。

Ruling：用户实施中明确要求位置区分输入输出、退出码右下角、任务组同样限高与四方向渐变；在既有可逆展示范围内执行，以可选 footer placement 保持插件声明与通用组件职责。
