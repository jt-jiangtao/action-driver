# 2026-09-28 工作区本地提交检查点

用户明确授权提交工作区全部未提交代码。该操作为执行型保存检查点，不新增产品或架构决策，不推送、不合并，不将进行中的 OpenSpec 任务标为完成或归档。

## 提交主题

- 工具公开点号名称、模型协议映射、插件契约与 Runtime/Renderer 引用。
- 原样 vendoring CUA Browser package 与同步脚本；保留上游空白，未对原始依赖做格式重写。
- Browser Fork bootstrap 当前 prepare/sync/build 阶段及计划；export/verify/package 阶段仍未完成。
- 打包水印截图窗口不存在时的明确错误检查。
- Browser Use、CUA 重建、自编译宿主的规划文档与平台探索记录。

## 本批次提交前验证

全量命令各执行一次；本地与打包构建串行，避免共享输出被同时重写。

- `pnpm typecheck`：初次失败，打包原生窗口截图访问可能不存在的数组元素。已补窗口存在检查，`pnpm --filter @actiondriver/desktop typecheck` 通过；其他工作区类型检查在初次全量运行中通过。
- `pnpm lint`：初次失败，bootstrap runner 测试轮询中的空 catch。保留轮询行为并加注释，修改文件的定向 eslint 通过；初次全量 lint 未发现其他错误。
- `pnpm test`：1226 通过、6 失败、2 跳过。失败包括五个 `cua-runtime.test.ts` 用例（状态保持/reset、启动中 reset、Skill gate、图像投递、授权等待预算）及 `runtime-process.test.ts` 注入 token 后报告 HTTP 地址的用例。本次保存未将这些失败修为通过，不宣称全量单测通过。
- `node --test scripts/lib/browser-forks/*.test.mjs`：29/29 通过；注释修改后 runner 定向测试 4/4 通过。
- `pnpm test:e2e:local`：6 通过、2 失败、1 跳过。失败为 Token Plan 图片接口控件缺失和宽图预览图片控件缺失。
- OpenSpec strict：工具命名、CUA Browser vendoring、bootstrap 变更通过；其余规划验证结果见后续补充。

日志保留在忽略目录 `thridparty/logs/workspace-precommit`。构建结果、工具链和日志保持忽略，不提交到 Git。源码 submodule 无剩余改动。本地 Electron / Playwright 自有提交尚未确认可从远端拉取，当前检查点不提供完整全新检出的构建保证。

- `pnpm test:e2e:packaged:macos`：打包 E2E 1/1 通过，校验自有 Electron 来源与 Renderer/Runtime 认证。
- OpenSpec strict：implement-browser-use、reconstruct-codex-cua-packages、replace-desktop-electron-with-fork 均通过。
- 本地提交：ba27662（工具命名）、0a075ff（CUA Browser 依赖）、8a98f35（构建 bootstrap 检查点）、2c9a961（打包截图类型检查），剩余规划文档和本记录在后续独立提交保存。所有未完成的任务仍保留原状态。
