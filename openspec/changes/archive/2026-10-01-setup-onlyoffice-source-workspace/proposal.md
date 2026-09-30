## Why

需要在 Electron 源码旁准备可独立修改和自行部署的 ONLYOFFICE Docs 工作区，验证后续 Agent 协作接口方案。

## What Changes

- 将用户已选择的四个 ONLYOFFICE 仓库 fork 保存在用户 GitHub 账号中，并把 DocumentServer 工作区放到 `thirdparty/onlyoffice`。
- 使 DocumentServer 的 `server`、`sdkjs`、`web-apps` 子模块使用用户 fork，其他构建依赖保持同版本上游源码。
- 从本地 fork 源码构建 Docker 镜像，启动服务并验证健康状态。

## Capabilities

### New Capabilities

无。本次只准备第三方源码与开发环境，不改变 Action-Driver 产品行为。

### Modified Capabilities

无。

## Impact

- 影响 `thirdparty/onlyoffice`、根 `.gitmodules`、`docs/development/onlyoffice-local.md` 和 Docker 本地环境。
- Battle：用户已选择修改服务端接口、全部组件自行部署，并指定与 Electron 同级；本次只准备工作区和可运行基线，不实现 Agent 接口。
- 用户补充裁决：镜像必须按本地源码打包。已知风险：Apple Silicon 上源码构建耗时与内存开销较大，可能需要增加 Docker 资源。
- 后续集成方向裁决：不做应用账号认证，访客匿名编辑所有可访问文档；本次只交付本机源码镜像，不实现公网文档入口。
