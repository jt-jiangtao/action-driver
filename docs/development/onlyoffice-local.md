# ONLYOFFICE 本地源码镜像

`thirdparty/onlyoffice` 是用户的 DocumentServer fork，与 `thirdparty/electron` 同级。其 `server`、`sdkjs`、`web-apps` 子模块指向用户的 fork；`build_tools` 和其他依赖锁定在上游提交。首次获取源码：

```sh
git submodule update --init --recursive thirdparty/onlyoffice
```

从本地 `server`、`sdkjs`、`web-apps` 构建镜像。构建平台为 Linux amd64，Apple Silicon 的 Docker Desktop 可运行。未修改的 `core` 二进制来自同版本的社区基础镜像；构建过程跳过开发脚本默认下载的最新 `core`，避免混用不同版本的库。

```sh
cd thirdparty/onlyoffice
docker build --platform linux/amd64 \
  --build-arg DOCUMENTSERVER_REVISION="$(git rev-parse HEAD)" \
  --build-arg SERVER_REVISION="$(git -C server rev-parse HEAD)" \
  --build-arg SDKJS_REVISION="$(git -C sdkjs rev-parse HEAD)" \
  --build-arg WEB_APPS_REVISION="$(git -C web-apps rev-parse HEAD)" \
  -t action-driver-onlyoffice:local -f Dockerfile.local .
docker run -d --name action-driver-onlyoffice --platform linux/amd64 \
  -p 127.0.0.1:8086:80 -e EXAMPLE_ENABLED=true \
  -v action-driver-onlyoffice-data:/var/www/onlyoffice/Data \
  -v action-driver-onlyoffice-lib:/var/lib/onlyoffice \
  action-driver-onlyoffice:local
```

验证 `http://127.0.0.1:8086/healthcheck`，再打开 [匿名中文示例页](http://127.0.0.1:8086/example/?lang=zh&userid=uid-0)。示例页只供本机测试；正式集成通过 `editorConfig.lang: "zh"` 设置简体中文，通过空 `editorConfig.user.id` 启用匿名协作。配置签名用于保护编辑器配置，不要求访客登录。

修改子模块后先检查 `git -C thirdparty/onlyoffice status`，再重建镜像。主仓库的 gitlink 只能记录 DocumentServer 的提交指针；各 fork 的源码修改需要分别保存在其仓库里。

更新现有容器时，先运行 `docker stop action-driver-onlyoffice` 和 `docker rm action-driver-onlyoffice`，再执行上述 `docker run`；两个命名卷保留测试文档和运行数据。
