# 验证记录（2026-09-28）

## 已验证

- `plugins/web/src/providers.test.ts`：48 通过；包含成功响应 URL 的明文/百分号编码凭据回显过滤，以及 Markdown 登录标题拒绝。
- `plugins/web/src/reader/public-address.test.ts`：8 通过；固定 Cloudflare DoH、无认证头、拒绝真实私网/混合私网/不安全或空答案。
- web 插件 catalog/activation、宿主 credential、搜索→读取 agent loop、历史结果回放、旧配置停用等定向验证：相关 72 用例通过（另有日志相关 4 项失败，见下文）。
- composition/packaging/development-runtime 定向复验：11 通过。
- `node --test scripts/dev.test.mjs`：3 通过。
- Runtime 构建通过，新打包 web extension 包含固定 Cloudflare DoH 实现。
- 真实调用：Tavily 返回 3 结果；Jina example.com 返回 149 字符。日志中失败地址以新版重试：小米 SU7 官网返回 116 字符，s.jina.ai/小米SU7 返回 349 字符；Wikipedia OpenAI 经公网校验后上游 30 秒超时。返回内容长度只证明供应商交付内容，不保证页面正文完整。
- `.env.local` 被 Git 忽略，权限 0600；开发入口优先保留已继承环境变量，密钥不提交。
- OpenSpec strict 校验通过；git diff --check 通过。

## 提交前全量检查（各一次，不重复全量）

- `pnpm typecheck`：失败，新 agent-loop fixture 返回的持久化事件缺少 cursor。已修正并以 agent-runtime 定向 typecheck 通过；web 插件定向 typecheck 通过。
- `pnpm lint`：45 错误，44 来自临时冒烟 bundle（位于 Git 忽略目录但未被 ESLint 忽略），1 来自 composition 测试的无用 import。已删除任务生成 bundle 并移除 import；修改文件定向 ESLint 通过。
- `pnpm test`：1277 通过、20 失败、2 跳过，205 文件。运行中补入的凭据回显回归用例有 4 项按预期失败，修复后 48 项 provider 定向通过；3 项旧测试预期（无密钥 Reader 可用、旧 dev 命令）已更新，11 项定向通过。其余 13 失败位于 Runtime shutdown（6）、observability/service/desktop 日志关闭超时（4）、Computer Use（3）；未改这些模块，不声称全量绿灯。HEAD Runtime 临时基线也复现 shutdown 超时，临时文件已删除；日志相关 4 项定向复现。Computer Use 失败未完成基线归因。
- `pnpm test:e2e:local`：6 通过、2 失败、1 跳过。失败为 Token Plan 图片设置与宽图片恢复，未完成基线归因。Runtime/HTTP 与两轮持久化链路通过。没有重复运行本地全量 E2E。
- 无界面/打包配置改动，不额外执行 packaged macOS E2E。

## 交付状态

代码与配置已落地，默认 Search=Tavily、Open=Jina。运行中的旧进程不会热替换插件，需重新执行 pnpm dev 生效。保留活动 OpenSpec 变更，未以全量通过为名归档；日志/Computer Use/图片失败需要单独调查。

## 同版本缓存修复补充

用户重启后仍旧 URL_DENIED，根因是先前修改保持 web 1.2.0 版本，安装器按版本不可变规则继续使用旧包。递增 plugin.json/package.json 至 1.3.0。

- 回归用例预置旧 web/1.2.0 缓存：修复前 STALE_WEB_PACKAGE 失败，递增版本与构建后通过；新执行器请求 Jina 协议正确，旧包保留。
- 已重启用户开发实例（无运行中任务），实际 current.json 为 1.3.0，安装包包含 cloudflare-dns.com；未清理旧版本或用户数据。
- 使用用户真实安装目录、打包 Node 和真实插件宿主调用：www.example.com 成功 149 字符；news.ycombinator.com 成功 12,000 字符。
- 本次提交前 pnpm typecheck 通过；pnpm lint 29 错误全部来自前次遗漏的冒烟嵌套 bundle，已移除，改动测试定向 ESLint 通过；没有重复全量 lint。
- pnpm test 一次：1285 通过、14 失败、2 跳过；web 升级回归通过。失败为既有 Runtime shutdown（6）、日志关闭（4）、Computer Use（4），未声明全量通过。
- 本次只改包版本和缓存场景测试，不重复前次本地 E2E；真实安装与跨进程调用已验证版本升级效果。
