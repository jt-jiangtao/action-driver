## 1. 快照契约与基础校验

- [x] 1.1 先创建 `validate-figma-snapshot.test.mjs` 的失败 fixture，覆盖输入版本、隐藏文字、文字越界、文本伪图标、变体/Section 重叠和精确例外，并运行 `node --test` 确认因实现缺失而失败
- [x] 1.2 实现快照解析、可见性传播、几何相交、确定性排序、人类/JSON 报告和 CLI `0/1/2` 退出状态，并验证 1.1 全部通过

## 2. 布局、固定尺寸与模态框

- [x] 2.1 先补充手工内容流、Auto Layout 绝对子项、动态内容固定尺寸、合理图标/Hotspot/覆盖层、模态框居中与大留白失败测试，并确认新测试先失败
- [x] 2.2 实现结果型布局规则与显式角色例外，验证合法画板、侧栏、SVG、菜单、抽屉和边缘相接 fixture 不误报，违规 fixture 输出对应 node id 与测量值

## 3. 按钮、下拉框与状态几何

- [x] 3.1 先补充控件内容刚好适配、padding 挤压、padding 过大、尾部图标预留、静态 HUG 标签、动态长标签省略和状态几何漂移测试，并确认新测试先失败
- [x] 3.2 实现权威组件/profile 匹配与 required/available width 内容预算，验证动态固定标签要求 `ENDING + maxLines: 1`，静态 HUG 按钮和图标按钮不被误报

## 4. 状态、Reaction 与项目配置

- [x] 4.1 先补充缺失状态、无效 reaction 目标、reaction 数量回退、外部动作、非法通配例外和空理由配置测试，并确认新测试先失败
- [x] 4.2 实现状态/reaction/配置规则，创建 `design/figma-ui-audit.config.json` 登记六个页面、权威组件、动态标签、基线和已复核例外，运行完整 `node:test` 验证通过
- [x] 4.3 在根 `package.json` 增加 `test:figma-audit` 与 `validate:figma-audit`，验证两个命令能够分别运行单测和接受快照参数

## 5. 项目 Skill

- [x] 5.1 在生产 Skill 之外记录无 Skill 基线，保留“SVG/Hotspot/抽屉被朴素规则误报”和“87px 内容进入 80px 可用空间、动态模型名无省略”的真实失败证据
- [x] 5.2 使用官方 initializer 创建 `.agents/skills/auditing-figma-ui/`，编写简洁触发描述、Figma 新鲜快照流程、规则参考、截图复核与诚实报告要求，并删除未使用脚手架文件
- [x] 5.3 运行 Skill `quick_validate.py` 与 `pnpm test:figma-audit`，确认结构和脚本通过；在未授权子代理的情况下明确记录独立压力测试未运行

## 6. 真实文件全面审计与交付验证

- [x] 6.1 使用每页一次的并行 Figma Plugin API 调用提取 Components、Home、Task、Model Configuration、Agent Configuration 与 Logs 新鲜快照，并验证快照页面范围和必要字段完整
- [x] 6.2 运行人类与 JSON 两种校验输出，逐项截图复核 modal density、manual flow、icon semantics、control padding 和 geometry drift warning，确认 error 退出 `1` 时仍保留真实失败状态
- [x] 6.3 创建 `design/figma-ui-audit-report.md`，按页面记录去重后的规则、node id、测量值、源组件根因、批准例外、截图结论和未修复问题，禁止在仍有 error 时宣告 Figma 通过
- [x] 6.4 运行 `pnpm test:figma-audit`、Skill quick validator、`openspec validate add-figma-ui-audit-skill --strict` 与 `git diff --check`，并验证全部工具检查通过且真实设计问题被诚实保留在报告中
