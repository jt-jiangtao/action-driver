# Codex Computer Use 包（内部使用，不用于正式发布）

来源：本机 `/Applications/ChatGPT.app/Contents/Resources/cua_node/lib/node_modules/@oai`（ChatGPT/Codex App 26.917.71314，computer-use 插件 1.0.1001093）。
复制日期：2026-09-26。由 `scripts/sync-codex-cua.mjs` 重新同步。

| 包 | 版本 | 复制内容 |
|---|---|---|
| @oai/sky | 0.7.1 | package.json、dist、docs（不含 bin 与 Codex Computer Use.app） |
| @oai/cua | 0.2.5 | package.json、docs、dist（不含 dist/lib/js/oai_js_browser） |
| @oai/cua-repl | 0.1.0 | package.json、README.md、instructions、dist、plugin |

这些文件属于 OpenAI（插件声明 `license: Proprietary`），原样保存、不做修改。
行为差异通过运行时的加载钩子实现（把 mac 传输层与遥测重定向到本项目的适配器），
见 `openspec/changes/align-computer-use-with-codex/design.md`。
正式发布前必须移除或替换本目录。

## Computer Use Skill 来源

用户裁决以 `@oai/cua/docs/tinysky-alt-core-cua-repl.md` 作为本项目 Computer Use Skill 正文，逐字复用，仅添加 Skill 加载所需的 name/description frontmatter。同步脚本同步生成 `plugins/computer-use/skills/computer-use/SKILL.md`。本机插件中的旧 `node_repl + sky` Skill 不作为模型入口；其文件仍作为原始 vendor 包资料保留。

完整 Skill 目录来源：`~/.codex/.tmp/bundled-marketplaces/openai-bundled/plugins/computer-use/skills/computer-use/`，原样保存在本目录的 `skills/computer-use/`。同步脚本的第三个参数可指定 Skill 源目录，递归保留全部文件；生成的运行资源附带 `codex-docs/` 完整文档目录，仅入口采用上述现行正文与加载元数据。
