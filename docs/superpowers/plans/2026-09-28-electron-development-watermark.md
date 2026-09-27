# Electron Development Watermark Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans inline. Steps use checkbox syntax.

**Goal:** 在实际自编译 Electron 原生窗口铺满淡色 action-driver-dev，并交付重建打包文档。
**Architecture:** ACTION_DRIVER 宏内的 AppKit NSView 覆盖层，作为内容区域之上的原生视图；GN action_driver 开关关闭时保留上游路径。开发默认策略与绘制独立，现有 bundle 来源校验继续生效。
**Tech Stack:** Objective-C++ / AppKit、GN/Ninja、Node 定向验收。
**Spec:** openspec/changes/archive/2026-09-28-add-electron-development-watermark/design.md 与 specs/desktop-shell/spec.md。用户已确认设计并要求完成；本计划细化既有裁决，采用当前会话直接执行。

## Global Constraints

- 文本固定 action-driver-dev、透明度 5%、斜向平铺，不添加角落信息或版本后缀，不修改 DOM。
- GN action_driver 默认 false；开启时定义 ACTION_DRIVER；非官方构建定义 ACTION_DRIVER_DEVELOPMENT 并始终显示，其他自有构建仅 --action-driver-watermark 开启。
- 所有新增 Objective-C++/C++ 行为及声明均在 ACTION_DRIVER 中；GN 仅在 action_driver && is_mac 时加入自有源文件。
- 保持 Electron 38.8.6 / SDK 26.5 / arm64 / 禁用 PCH / -j8 / fd 65536。
- 源码只修改直属 submodule；同步到独立构建检出前保留其状态。旧 bundle/来源必须成对保留，验证新 bundle 后才切换。
- 迭代仅定向测试；不混入并行改动，不擅自推送 Electron Fork。

## Review Focus

- Native content view 的后续替换或子页面层不能盖住水印：NSWindow 设置内容后重新放置，并测试 view ordering。
- resize/fullscreen/titlebar：使用 contentLayoutRect 保持内容区域且不覆盖按钮，测试尺寸及全屏转换。
- 点击／拖动／焦点：hitTest nil、acceptsFirstResponder NO、非可访问性元素，验证真实页面点击输入滚动。
- 窗口关闭／内容替换：移除覆盖层并释放强引用，验证弱引用释放。
- 宏关闭／官方标志：定向编译三种宏组合，检验开发恒开及其他自有构建参数策略。

### Task 1: 构建策略和原生绘制

**Files:** Electron build/action_driver.gni、BUILD.gn、shell/browser/ui/cocoa/action_driver/{watermark_policy.h,watermark_view.h,watermark_view.mm}、action_driver/watermark/native.test.mjs 与原生 fixture。
**Interfaces:** constexpr bool electron::action_driver::ShouldShowWatermark(bool has_switch)；ActionDriverWatermarkView(NSView) 原生绘制和布局，无 DOM 依赖。
- [x] 写三种宏组合编译／策略及 native view 绘制、hitTest、resize、清理测试；观察 RED。
- [x] 实现 GN 开关与固定 5% 文本绘制；运行相同测试 GREEN。

### Task 2: Electron 原生窗口生命周期

**Files:** shell/browser/ui/cocoa/electron_ns_window.{h,mm}，必要时 native_window_mac.mm（仅宏内调用）。
**Interfaces:** updateActionDriverWatermark 安装/重放置覆盖层；cleanup 释放；仅 ACTION_DRIVER 编译。
- [x] 测试原生 sibling ordering、content replacement、窗口生命周期；编译相关上游 TU。
- [x] 同步审核后的 Fork 文件到独立检出，GN 配置开启，定向编译开与关策略，再完整编译 electron。
- [x] 实际 Electron 页面操作和原生窗口截图验证浅色、深色、缩放、导航、全屏、关闭；截屏使用 OS 窗口图像。

### Task 3: 导出、接入与文档

**Files:** scripts/export-electron-fork.mjs 及定向测试、config/electron-fork.json（当前来源格式）、docs/development/electron-watermark.md。
**Interfaces:** 显式导出核验新 bundle 后以可回滚替换启用 bundle+来源；现有 resolveElectronFork 保持只读和拒绝篡改。
- [x] 测试导出失败保留旧 bundle+记录；成功导出记录实际 SHA/版本/架构/源码/GN。
- [x] 确认源码可追踪（Fork 自有提交）、旧产物备份后接入新宿主，定向产品测试与原生图像验证。
- [x] 文档覆盖开关、参数、源代码同步、编译、导出、来源及打包命令和截图限制。
- [x] OpenSpec strict、差异检查、一次 fresh-context 任务审查；只修改重要问题。提交时才运行一次全量关口及打包验收。

## Self-Review

原生绘制与参数策略由 Task 1 覆盖；窗口交互与生命周期由 Task 2 覆盖；实际重建来源与打包复现由 Task 3 覆盖。所有 Review Focus 均有对应原生或真实 Electron 验证；不将单独 AppKit fixture 等同于实际 Electron 验收。
