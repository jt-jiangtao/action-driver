# 验收记录

- `pnpm typecheck`、`pnpm lint`、`pnpm test`、`pnpm build` 与 OpenSpec 严格校验通过。
- 视觉桌面 E2E 的 3 个场景通过；Skills 列表和详情截图位于 `design/actual/settings-skills-list.png` 与 `design/actual/settings-skill-detail.png`。
- 本地桌面 E2E 验证本地 Skill 安装、重启后展示、详情与卸载；卸载后来源文件仍在。另用本机 Git 配置替身验证 GitHub 子目录安装、GitHub 来源标记和启停。
- Runtime 集成测试确认 Agent 通过 `skill_install` 安装后能够发现并读取 Skill；Skill 内容提及 `shell_run` 也不会改变工具 grants，未授权调用仍返回 `TOOL_DENIED`。
- macOS arm64 打包 E2E 验证四个系统 Skill 及 `skill-creator` 附属资源均在发布包中；包内 Python、Node、`rg` 与工具任务通过。
- GitHub 导入通过 Git 仓库子目录、已有本机 Git 配置替身、网络错误及重名回滚测试。
- x64 Python 和 Node 资源已通过锁文件摘要校验并暂存，`file` 确认为 x86_64 Mach-O。当前 arm64 主机没有 Rosetta，无法在本机执行 x64 发布包；该架构的运行验收仍未完成。
- Agent 安装工具已通过 Runtime 集成测试，设置页安装已通过桌面 E2E；模型发起 `skill_install`、再由桌面界面读取并验证权限边界的完整单条 E2E 尚未执行，因此任务 5.2 保持未完成。
- 复制的 Codex `skill-creator` Python 辅助脚本依赖 PyYAML。ActionDriver 仅承诺包内 Python 标准库执行；其适配入口指导 Agent 用现有脚本工具创建 Skill，并将原入口保存在参考文件中。
