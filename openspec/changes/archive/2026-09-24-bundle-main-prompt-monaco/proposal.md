## Why

主提示词源码视图在无法访问外部 Monaco CDN 时为空白，即使主提示词内容已经成功读取。本项目已安装 Monaco 包，但编辑器加载器仍使用远程默认地址。

这是执行型故障修复：恢复既有源码编辑行为，不改变提示词数据、编辑流程或公共接口。已检查本地加载与服务端读取边界，无实质性异议。

## What Changes

- 让源码编辑器从桌面应用包内加载 Monaco 与必要的 worker，而不依赖外部 CDN。
- 增加阻断外部 CDN 的桌面端回归验证，确认源码内容实际显示。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

无。源码编辑能力已存在，本次修复其加载实现，使用 `skip_specs: true`。

## Impact

影响桌面端 renderer 的 Monaco 装配与构建产物；不新增依赖，不改主提示词服务与存储。
