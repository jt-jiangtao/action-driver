## 1. 源码工作区

- [x] 1.1 确认四个 fork 存在，并以 `gh repo view` 验证地址。
- [x] 1.2 将 DocumentServer fork 作为 `thirdparty/onlyoffice` 子模块加入，验证目录与 Electron 同级。
- [x] 1.3 将 server、sdkjs、web-apps 子模块指向对应 fork，初始化其余依赖，并用 `git submodule status --recursive` 验证。

## 2. 本地源码 Docker 构建

- [x] 2.1 添加从本地 `server`、`sdkjs`、`web-apps` 构建的 Docker 配置，验证构建上下文和源码提交来源。
- [x] 2.2 构建镜像并启动隔离容器，验证镜像内的前端、服务端与 SDK 均来自本地源码。
- [x] 2.3 验证 HTTP 健康检查与网页入口，并记录构建和运行结果。

## 验证记录

- `docker build --platform linux/amd64 -f Dockerfile.local` 成功；镜像 `action-driver-onlyoffice:local` 带有 DocumentServer、server、sdkjs、web-apps 的本地提交标签。
- 容器 `action-driver-onlyoffice` 运行在 `127.0.0.1:8086`；`/healthcheck`、`/example/?lang=zh&userid=uid-0` 和 `api.js` 均返回 HTTP 200。
- DOCX、XLSX、PPTX、PDF 的编辑页均返回 HTTP 200，配置中分别识别为 word、cell、slide、pdf，语言为 `zh`，匿名身份为空用户 ID。
- 镜像内前端、服务端、SDK 文件存在；`libdoctrenderer.so` 校验和与 9.4.0 基础镜像相同。启动日志显示字体、演示文稿主题和 JS 缓存生成完成，无符号查找错误。
- 提交前按仓库规则一次性运行根验证：`pnpm typecheck` 失败（桌面端插件贡献对象缺少其他在途改动新增的 `sessionModes`）；`pnpm lint` 失败（其他在途 session-mode 组件缺少 `data-testid`）；`pnpm test` 为 2661 通过、30 失败、2 跳过（451 个文件中 435 通过、14 失败、2 跳过）。失败文件位于桌面端、运行时、浏览器及 CUA 相关模块，不在本次 ONLYOFFICE 源码、Docker 配置和文档范围内；未重复运行全量验证。
