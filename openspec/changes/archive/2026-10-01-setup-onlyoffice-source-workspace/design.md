## Context

`thirdparty/electron` 是根仓库的 Git 子模块。ONLYOFFICE 的 `DocumentServer` 也用子模块组合 `server`、`sdkjs`、`web-apps` 等源码。当前 Docker Desktop 为 Linux arm64，约 8 GB 内存。

## Goals / Non-Goals

**Goals:** 在 `thirdparty/onlyoffice` 保存可更新的源码工作区，从其中的前端、服务端和 SDK 代码构建镜像，并运行可访问的容器。

**Non-Goals:** 本变更不实现 Agent 接口、不修改协作协议。

## Decisions

- **目录与版本控制**：根仓库添加 `thirdparty/onlyoffice` 子模块，指向用户的 `DocumentServer` fork；该 fork 固定用户的 `server`、`sdkjs`、`web-apps` fork。替代方案是四个独立克隆目录，更新关系更难追踪。用户已裁决源码与 Electron 同级、前端服务端 SDK 均自管。
- **本地源码镜像**：按用户补充裁决，以本地 `server`、`sdkjs`、`web-apps` 作为 Docker 构建输入。允许用官方社区镜像承载尚未修改的运行依赖，但产出的前端、服务端和 SDK 必须来自本地源码，最终镜像须标明源码提交。前端依赖 PhantomJS 缺少 Linux arm64 二进制，因此目标平台采用 Linux amd64，在 Apple Silicon 的 Docker 中运行。替代方案是直接运行官方镜像，速度快但不符合用户验收标准，已否决。
- **本机示例入口**：容器发布在宿主机 `127.0.0.1:8086`；示例服务生成的浏览器地址也使用该端口。容器内 Nginx 同时在 loopback 的 8086 端口监听，使示例服务和文档服务能访问这些地址。默认入口使用 `lang=zh&userid=uid-0`，以匿名用户打开简体中文编辑器。
- **源码范围**：只 fork 用户准备修改的 DocumentServer、server、sdkjs、web-apps；core 等依赖保留上游子模块。替代方案是 fork 全部依赖，维护成本显著增加。
- **后续匿名协作方向（本次不实现）**：用户最终裁决免账号认证，访客通过文档链接匿名编辑；不创建 `agent/admin` 账户，也不校验访客身份令牌。曾比较固定两个身份并由应用后端校验令牌的方案，它能归因修改且控制访问，但增加账号和令牌管理，用户选择匿名方案并接受链接泄露即编辑权泄露、无法可靠追责的风险。ONLYOFFICE 配置签名仍用于保护服务间配置完整性，不作为访客登录。本机测试服务仅绑定 `127.0.0.1`，公开入口须另行设计。

## Risks / Trade-offs

- [源码构建可能超过当前 Docker 资源] → 先进行本地源码构建，若实际发生资源限制则记录诊断并调整 Docker 资源或构建路径。
- [只改 fork 但构建脚本仍拉取上游] → 在真正源码构建前核对实际子模块提交和构建输入。
- [基础镜像含预编译运行依赖] → 对前端、服务端和 SDK 的本地构建产物进行来源验证，不把基础镜像中的文件当作本地产物。
- [上游开发构建脚本默认下载最新 `core`，与固定版本基础镜像二进制不兼容] → 在镜像构建时跳过这段下载，保留基础镜像自带的匹配 `core`，并检查主题生成日志。
- [amd64 镜像在 Apple Silicon 上需要兼容运行，构建与运行较慢] → 记录镜像平台和实测性能；后续如需原生 arm64，需替换或移除 PhantomJS 构建依赖。
- [匿名公开编辑无法归因，文档链接泄露即编辑权泄露] → 用户已明确覆盖固定身份认证方案；当前仅本机验证，公开部署前仍须单独处理链接分发与滥用风险。

## Migration Plan

检查现有 `thirdparty/onlyoffice` 和容器名未被占用后添加子模块；启动失败时保留源码，移除本次创建的容器即可回退运行状态。
