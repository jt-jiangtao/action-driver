## Why

当前主分支的开发脚本直接启动 npm 安装的官方 Electron。运行进程证实使用 `node_modules/electron/dist/Electron.app`，因此已构建的原生 `action-driver-dev` 水印不会出现。这是已完成的自有 Electron 方案在分支整合时丢失启动接线所造成的回归。

## What Changes

- 恢复开发、预览、桌面 E2E 和 macOS 打包入口对已验证 Electron Fork 产物的统一解析与使用。
- 恢复来源记录及哈希、版本、架构校验；产物缺失或不匹配时明确失败。
- 恢复原生水印重建与验收说明，并验证实际运行进程来自 Fork。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `desktop-shell`：恢复自有 macOS Electron 开发水印与必须使用已验证 Fork 的启动、打包行为。

## Impact

影响桌面启动脚本、测试入口、macOS 打包脚本、Fork 来源配置及文档；不改变 Electron 原生源码、网页 DOM 或公开 IPC。现有工作区有其他任务的未提交改动，本次仅修改相关行与新文件。

## Battle Status

本次为执行型回归修复。水印显示与原生 Fork 的方向已在 `add-electron-development-watermark` 及 `replace-desktop-electron-with-fork` 的既有方案中裁决；用户再次明确要求始终使用 Fork。已核对当前进程路径、脚本及本机 Fork 产物，无新增产品或架构决策。
