## Context

见 proposal.md。`AgentMarkdownEditor` 使用 `@monaco-editor/react`，加载器默认从 jsDelivr 获取比已安装版本还新的 Monaco，离线时无法初始化。主提示词内容在切换源码前已由 `MainPromptPage` 正常读取。

## Goals / Non-Goals

**Goals:** 源码视图在没有外网时显示并可编辑现有 Markdown 内容；主提示词和 Skill 编辑器共用修复。

**Non-Goals:** 不替换编辑器，也不调整文件保存协议。

## Decisions

- 使用现有 `monaco-editor` 依赖并配置 `@monaco-editor/react` 加载器直接使用本地模块；只在用户进入源码模式时加载编辑器 chunk。相比改用 textarea，此方案保留源码编辑器已有的语言高亮、行号和编辑体验，且不增大首页初始 JS。
- 使用 Vite 构建的本地 editor worker；在桌面构建中验证无需 CDN。

## Risks / Trade-offs

- [renderer 包体可能增大] → 只装配 Markdown 编辑所需 Monaco 入口与 editor worker，并检查构建结果。
- [测试模拟 Monaco 掩盖真实加载故障] → 增加 Electron 测试，阻断 CDN 并检查实际源码内容。
