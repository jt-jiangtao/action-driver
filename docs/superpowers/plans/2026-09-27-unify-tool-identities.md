# 统一工具身份执行计划

绑定 OpenSpec：unify-tool-identities。用户已明确“确认替换”，沿用 main 内联执行。

顺序执行对应 tasks：先对十二项 catalog、别名和 cloud 授权隔离建立失败回归；公共 helper 接入 registry/policy/权威调用；替换插件与消费层；定向测试及实际 npm 构建；独立只读复审；提交前一次全量验证；范围提交与归档。

版本保持，原始历史与上游参考文档保留。模型发现仅新名，旧名仅显式 local 映射，冲突拒绝，停用失效。迭代只定向测试，执行进度和判断记在 OpenSpec tasks。其他线程 browser-fork-baseline、implement-browser-use 和 explorations 不提交。

Ruling: 原 workspace.dependencies.load 命名纳入 command.dependencies.load，按 command 已有宿主执行端口装配；其文件/依赖事实仍属于宿主，不增加授权或执行环境。
