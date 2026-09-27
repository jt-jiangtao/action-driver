## Why

自有 Electron/Chromium 已从源码构建并通过双 Fork 基础兼容验证，但 ActionDriver 当前开发、测试和打包入口仍消费官方 Electron。需要统一替换桌面宿主，确保产品实际运行自有框架。

## What Changes

- 开发、预览、本地 Electron E2E 和 macOS 打包统一消费自有 Electron 38.8.6。
- 建立共享产物解析与来源、版本、架构、完整目录校验，缺失或不匹配明确失败。
- 保持当前桌面界面、主进程、IPC 和 Agent Runtime 行为；验证 SQLite 原生模块及打包资源兼容。
- 不覆盖 node_modules，不扩展内核接口，不在本期替换产品 Playwright 依赖。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `desktop-shell`: 桌面运行入口与打包来源统一为自有 Electron，错误产物不得回退官方版本。

## Impact

启动脚本、apps/desktop/package.json、Electron E2E、scripts/test-packaged-macos.mjs、原生依赖验证与复现文档。保留 electron 38.8.6 包的类型与构建元数据；运行二进制由自有产物提供。

## Battle Status

决策型；2026-09-27 用户明确确认开发、测试、打包全部替换，Battle 完成。已检查同版本兼容假设、现有启动与打包入口、原生 ABI 和权限风险。替代方案为覆盖 node_modules/electron/dist，重装会丢失且无法清晰追踪，不采用。最终选择共享解析入口、显式执行路径、严格来源校验；无关键未决项。风险为 SQLite ABI、macOS 签名及权限，必须真实验证。用户覆盖：无。
