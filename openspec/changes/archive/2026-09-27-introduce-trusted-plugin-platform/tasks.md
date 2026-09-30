## 1. 契约与依赖注入

- [x] 1.1 核对关联 change 与工作区，确认迁移基线；交付受影响模块清单且不覆盖其他线程改动。
- [x] 1.2 建立 plugin-contracts 的 manifest、贡献、调用与错误 DTO；用定向契约测试验证兼容范围、平台和冲突输入。
- [x] 1.3 建立公共 plugin-sdk、独立 Skill/schema 贡献目录与窄接口 ports，通过 Runtime/Desktop composition root 注入适配器；验证 fixture 插件无需导入内部模块且测试可注入 fake。
- [x] 1.4 实现声明依赖解析；定向测试验证缺失、不兼容和循环依赖均明确失败，无 mock fallback。

- [x] 1.5 将公共 API/SDK 构建为独立 npm 包，验证 JavaScript、声明文件和 npm pack 产物不依赖仓库内部路径。
- [x] 1.6 实现 create-action-driver-plugin TypeScript 脚手架；验证 Skill/schema/执行同包、非空目录保护、生成项目构建及统一宿主生命周期。

## 2. 插件宿主与生命周期

- [x] 2.1 实现独立宿主握手、实例令牌和 RPC 上下文；验证迟到实例不能覆盖新实例消息。
- [x] 2.2 实现安装校验、启用和 single-flight 激活、原子贡献注册；定向测试验证部分失败回滚及重复激活。
- [x] 2.3 实现插件资源账本与停用回收；验证注册、事件、面板、服务和连接在退出后无残留。
- [x] 2.4 实现版本固定、升级与代码/数据恢复流程；验证在途调用不切换实现，缺失恢复策略的不可逆迁移被拒绝。
- [x] 2.5 实现崩溃处理与有限服务重启；验证未知副作用不自动重放、取消请求不伪装为完成。

## 3. Runtime 工具和服务

- [x] 3.1 扩展工具归属、动态可用性与注销；验证现有 grants、schema、事件顺序及工具标识不变。
- [x] 3.2 实现跨插件 capability 路由与依赖注入代理；验证来源、期限、取消、目标授权及循环限制。
- [x] 3.3 接入原生/Node 服务监督和 stdio/HTTP MCP；用 fixture 验证平台产物缺失、连接断开及 stdout 协议约束。
- [x] 3.4 接入私有存储、artifact、凭据代理和日志 ports；验证插件归属、无全局凭据环境注入及诊断关联字段。

## 4. Desktop 扩展桥接

- [x] 4.1 通过适配器接入现有 SkillProviderHost/LocalCapabilityClient；定向回归验证原 Computer 调用和取消兼容。
- [x] 4.2 实现声明式面板与类型化消息桥；验证远程网页无 Node/任意 IPC，未声明消息被拒绝。
- [x] 4.3 接入插件服务及面板资源回收；验证停用和进程异常均关闭资源，查看画面不获得输入控制权。

## 5. 能力迁移

- [x] 5.1 将 search 移入 plugins/search；验证既有搜索工具 ID、配置与结果契约，并移除重复手工注册。
- [x] 5.2 将执行工具移入 plugins/command，注入宿主执行接口；定向回归验证 SessionSandbox 隔离和 fail-closed 不变。
- [x] 5.3 将网页提取移入 plugins/web-reader；验证读取、取消与产物契约不变。
- [x] 5.4 将生成适配器移入 plugins/image-generation；验证原工具授权、凭据代理与 artifact 行为。
- [x] 5.5 将 Computer facade/Skill/UI 适配移入 plugins/computer-use；验证应用批准、控制门、指导错误和停止行为。
- [x] 5.6 在原生构建基线稳定后迁移 helper 源码及打包定位；验证签名身份、权限与安装产物，保留来源和许可证。
- [x] 5.7 建立 plugins/browser-use 边界及占位贡献；验证没有真实驱动时不发布操作工具，保持 fork 任务目录与范围。

## 6. 交付验证

- [x] 6.1 验证内置与外部 fixture 走相同注册/API/生命周期，升级、停用、卸载及数据保留可观察；记录定向集成结果。
- [x] 6.2 验证依赖方向：业务插件只依赖公共 SDK/契约，内核通过 ports 装配；完成导入约束检查。
- [x] 6.3 准备提交时依仓库规范一次性运行 typecheck、lint、全量单测，并按界面/打包影响追加对应 E2E；记录结果及已知无关失败。迭代期仅定向验证。
- [x] 6.4 更新开发、打包、生命周期和可信模式说明；核对文档与实际 SDK，并在实施完成后按 OpenSpec 流程归档。

实施及验证详见 validation.md。用户已明确确认同步主规范并归档。6.4 开发文档与 SDK 核对完成；两份 delta 已逐项同步、比对，并按归档流程收尾。
