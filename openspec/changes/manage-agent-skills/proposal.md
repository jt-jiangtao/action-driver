## Why

侧栏的 Skills 入口目前是视觉占位，用户无法看到或管理 Agent 可用的能力。产品的终态要求"通用的电脑代操作，且后期支持 MCP 与 Skill"，而 Browser Use 与 Computer Use 又必须作为独立 Skill 注册。在实现真实 Browser/Computer 之前，先把 Skill 的注册与管理和页面入口打通，后续能力只需注册即可被 Agent 使用。

## What Changes

- 服务端新增 Skill 注册与查询能力：注册内置与自定义 Skill、启用/停用、删除、列出状态；Skill 元数据由服务端写入本地（唯一写入者）。
- 客户端新增 Skills 管理页：列表、启用/停用、删除、查看状态与来源；内置 Skill（Browser Use、Computer Use）只读展示，自定义 Skill 可增删。
- 侧栏 Skills 入口打开管理页；MCP 入口保持视觉占位（本期明确不考虑 MCP）。
- Agent 通过统一 Skill 契约调用能力，页面不直接调用实现；新增自定义 Skill 走同一注册与生命周期。

## Capabilities

### New Capabilities

- `skill-management`: 定义 Skill 注册、启用/停用、删除、列表与状态投影的可见行为，以及内置与自定义 Skill 的边界。

### Modified Capabilities

- `desktop-shell`: 允许 Skills 入口打开已设计的 Skill 管理页，MCP 入口继续保持可见但不打开页面。

## Impact

- 服务端：新增 Skill 注册表与持久化（可在既有 SQLite 中新增表），提供查询与变更接口。
- 客户端：新增 Skills 页面与路由，侧栏入口接线；组件与视觉测试继续绑定 mock 装配。
- 契约：Skill 描述（标识、名称、类型、来源、状态、能力描述）成为服务端与页面之间的公共 DTO。
- 测试：注册/过滤/去重/内置只读等行为需要单元与集成覆盖。

## Battle Status

- 类型：产品（新页面与能力入口）+ 架构（Skill 注册归属）。
- 状态：**方向已裁决**（Agent 只通过 Skill 契约调用能力、Browser/Computer 独立注册），实现细节待裁决：
  1. 自定义 Skill 的形态：声明式工具描述 + 本地执行器（推荐首版），还是可执行脚本包。
  2. Skill 存放位置：服务端本地 SQLite（推荐，与配置一致），还是文件目录。
  3. 权限模型：首版只做启用/停用与来源标记（推荐），细粒度权限后置。
  4. MCP：本期只保留入口，不实现任何 MCP 行为。
