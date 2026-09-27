## Context

见 proposal.md。browser 包位于现有 @oai/cua 安装资源的 dist/lib/js/oai_js_browser，无独立 package.json。

## Goals / Non-Goals

完整保存 scripts、references 与随附 node_modules；不执行安装包脚本，不改动原始字节，不接线运行时。

## Decisions

沿用原始嵌套路径，删除同步脚本的 browser 排除规则。相比仅复制三个脚本，完整复制保留原资源和依赖布局，满足用户“这个包也复制进去”的要求。执行型，已检查目标不存在、来源完整和可逆性，无实质性异议。

## Risks / Trade-offs

- [体积增加] → 记录文件数量与字节数。
- [专有资料] → 沿用 vendor 内部使用约束。
- [没有 source map] → 只声明原样复制，不声明恢复原始源码。

## Verification

完整复制 354 个文件、13595770 字节，逐文件 SHA-256、权限、目录布局与符号链接一致。

`node --check scripts/sync-codex-cua.mjs`、定向 `git diff --check` 和 `openspec validate vendor-codex-browser-package --strict` 均通过。未运行全量测试，未提交。
