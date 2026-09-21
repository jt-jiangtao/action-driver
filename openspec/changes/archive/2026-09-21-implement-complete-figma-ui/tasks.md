## 1. Figma 核对与测试基线

- [x] 1.1 对 `design.md` 中 19 个 Component Set 的具体节点逐一调用 `get_design_context`，在核对矩阵记录尺寸、Token、变体、图标和对应代码路径，并验证 19/19 无遗漏
- [x] 1.2 对 Standalone / Composite Components 和 36 个 Glyph 逐项比对 Figma 导出与现有实现，记录 Lucide/品牌资产/导出资产映射，并验证 36/36 Glyph 均有明确来源
- [x] 1.3 对 14 个产品画板节点读取设计上下文并建立 1440×900 截图场景清单，验证 Home 2、Task 4、Settings 8 个状态均可由确定性 Mock 触发
- [x] 1.4 运行现有 renderer 单测、typecheck、build 和 E2E 基线，记录已有失败与工作区未提交改动，验证后续结果不会掩盖先存问题

## 2. 基础组件与图标层

- [x] 2.1 先为 `AppIcon` 与 `IconButton` 编写失败测试，再实现统一尺寸、线宽、`currentColor` 和可访问语义，验证 Plus 在主按钮中与文字同为白色
- [x] 2.2 先为 Checkbox、RadioOption、TextButton、TextField 编写状态测试，再实现 Figma 全部变体，验证 default/hover/focus/pressed/loading/disabled/error/success/indeterminate 均可达
- [x] 2.3 先为 ModelTestStatus/ModelStatusPill 编写状态测试，再统一测试状态类型和视觉语义，验证四个状态的图标、文字和颜色一致
- [x] 2.4 将基础控件样式拆入语义域 CSS 并复用设计 Token，运行组件测试和 typecheck 验证无页面私有重复实现

## 3. 导航、路由与 Mock 任务

- [x] 3.1 先为 MockTaskCatalog 编写多任务查找和不可变返回测试，再实现最近任务目录与多个确定性 TaskProjection，验证每个 task ID 返回独立内容
- [x] 3.2 先为判别联合 AppRoute 和任务切换编写 App 集成测试，再迁移 App 路由状态，验证 home/task/settings 返回路径与布局状态正确
- [x] 3.3 先为 SidebarEntry、RecentTaskItem 和 SettingsNavEntry 编写状态测试，再重构 Sidebar，验证任意最近任务可打开且只突出当前 task ID
- [x] 3.4 验证 Skills/MCP 入口仍保持不可导航、设置返回原页面，并运行 Sidebar/App 测试

## 4. 模型选择器与 Composer

- [x] 4.1 先为 ModelSelectorTrigger、ConnectionItem、ModelOptionItem 和 Menu 编写状态/键盘测试，再实现 4 个模型选择器组件集，验证展开、hover、selected、open 与关闭行为
- [x] 4.2 先为 Composer 保留草稿和切换模型编写测试，再组合模型选择器、添加和发送/中断操作，验证菜单开关不丢失 Slate 文本
- [x] 4.3 将模型选择器接入 Home 节点 `60:5`/`202:750`，运行页面测试并验证默认与打开态布局不跳动
- [x] 4.4 将模型选择器接入 Task 节点 `60:7`/`202:1337`，运行页面测试并验证 split 布局宽度与任务状态不被重置

## 5. Task 与 Browser 组件化

- [x] 5.1 先为 BrowserSizeToggle、TabBar、NavigationBar 和 FloatingControls 编写行为测试，再从 BrowserPanel 抽取组合组件，验证运行、暂停、继续、接管与 pending 防重复操作
- [x] 5.2 先为 Conversation Header、User Message、Agent Response 和 Execution Timeline 编写组合测试，再重构会话区，验证标题、消息角色、四步状态和进度正确
- [x] 5.3 使用 Grid/Flex 重构 Task 三种布局，移除页面结构的内联绝对宽度，验证 `60:7`、`111:247`、`112:409` 在 1440×900 无重叠且切换保留会话状态
- [x] 5.4 对多个最近任务运行 Task 页面集成测试，验证共享组件按 task ID 展示不同标题、消息、时间线和浏览器 projection

## 6. Settings 全状态实现

- [x] 6.1 先为 SettingsPageTitle、SettingsSidebar、LibraryModelRow、ModelLibrary 和 ManualModelRow 编写测试，再按 Figma 节点实现组合，验证有数据与空状态复用同一页面骨架
- [x] 6.2 先为 ConnectionCard 的 Expanded/Collapsed/Menu Open 和删除确认编写测试，再完成交互，验证取消删除不改变数据、确认删除正确进入空状态
- [x] 6.3 将 AddModelSetDialog 改为保留状态的两步 reducer，并补齐 Connection Default/Success 与 Models Untested/Testing/Partial Failure/Success 测试
- [x] 6.4 逐一触发 `273:6`、`273:54`、`273:90`、`273:126`、`273:162`、`273:198`、`273:234`、`273:270`，验证 8 个状态与 Figma 对应且测试结果无额外汇总行

## 7. 布局、视觉与回归验证

- [x] 7.1 将 Shell、Home、Task、Settings 样式整理为语义域文件，验证结构布局仅使用 Flex/Grid/正常流，定位只存在于已批准覆盖层
- [x] 7.2 在 1440×900 为 14 个画板场景生成截图并逐项对照 Figma，修正尺寸、间距、字体、颜色、圆角、阴影、图标和层级后验证清单全部通过
- [x] 7.3 在 1024×700 验证所有主要操作可达、滚动安全且内容不重叠，并新增覆盖该最小窗口的 E2E 断言
- [x] 7.4 运行 renderer 单测、desktop typecheck、desktop build 与完整 E2E，确认全部通过且没有修改本变更范围外的用户文件
- [x] 7.5 更新组件核对矩阵的最终代码路径、测试和截图结果，并执行 `openspec validate implement-complete-figma-ui --strict` 验证变更产物
