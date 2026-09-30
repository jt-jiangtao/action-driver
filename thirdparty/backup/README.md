# vendor 原包完整备份

根据用户要求，`apps/agent-runtime/vendor/` 的**所有内容**按原目录结构复制到本目录。原 vendor 顶层只有 `codex-cua/`，其中包含 `@oai/cua`、`@oai/cua-repl`、`@oai/sky` 及 CUA 内嵌 browser 包；三方依赖、声明、文档和资源均保留，不重命名、不重写。

创建于 2026-09-28。复制时源工作树和原项目目录已核对，两者都是上述完整包集合。`backup-manifest.json` 记录全部目录、文件 SHA-256/大小和符号链接目标；复制后逐项验证源和备份一致。原重建基准 `analysis/codex-cua/baseline.json` 也验证通过。若未来需要重新同步源包，必须一并备份并更新清单；不能只同步 CUA 或 browser。

当前生产加载与打包已按 `docs/superpowers/specs/2026-09-28-browser-and-vendor-cutover-design.md` 的裁决切换为 `@action-driver/*` 自有实现，`apps/agent-runtime/vendor/` 已整体删除；本目录是这些原件的**唯一留存副本**，不得当作生产实现或回退路径。

2026-09-30 按用户裁决改写本目录的位置（B1，见 `openspec/changes/cleanup-directory-residue/`）：原件备份从 `packages/back/` 移到 `thirdparty/backup/`，避免与 `packages/*` 的 workspace 语义混淆，也避免与真实包 `packages/browser-desktop` 混淆。本目录没有 package.json，不注册为实现 workspace 包。离线对照测试读取本目录的固定基准。原包标识保持原样，新实现使用 `@action-driver/*`。

非 macOS 未实现内容见 `docs/codex-cua-platform-gaps.md`。不要删除本备份；后续源包升级须另存版本及基准，不能覆盖旧行为证据。

## 独立 browser-desktop 原件

本机 App 另有独立的 `@oai/browser-desktop@0.1.1`，不是上述 vendor 树里的内嵌 browser 服务。按用户后续裁决，完整 106 个文件另存于 `browser-desktop/@oai/browser-desktop/`，不覆盖 `codex-cua/`，也不改动原 App。`browser-desktop/manifest.json` 记录来源路径、版本及 124 个目录/文件条目的 SHA-256、大小和权限；复制时源与备份无漂移。

这份原件仅用于静态研究和不会连接 Codex 私有服务的离线差异对照；所有新还原包与验收测试不得连接 Codex 私有服务。实现放在独立的 `@action-driver/browser-desktop` workspace，不从本目录导入运行代码。
