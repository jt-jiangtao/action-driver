# 全模型生图测试与选择器能力提示 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task by task.

## 目标与边界

本计划实施 `openspec/changes/probe-all-model-image-generation-and-show-selector-capabilities`。每个模型均真实测试文本、推理、视觉、生图；下拉列表的信息图标展示四项测试状态。保持四模型请求并发与聊天候选筛选。测试图不进入会话。

## 文件职责

- `apps/agent-runtime/src/model-connections/model-capability-catalog.ts`：四项固定候选；`model-capability-catalog.test.ts` 验证各目录类别。
- `apps/agent-runtime/src/model-connections/service.ts`：沿用并行探测与图片验证；`model-connection-service.test.ts` 验证真实请求与结果隔离。
- `apps/desktop/src/renderer/src/services/mock-model-connections.ts`：Mock 四项候选和独立结果；对应测试验证。
- `apps/desktop/src/renderer/src/models/model-selection.ts`：从已保存结果投影展示状态，保留聊天候选边界。
- `apps/desktop/src/renderer/src/components/model-selector/ModelOptionItem.tsx`、`ModelSelector.tsx`、`styles/model-selector.css`：图标、浮层与键盘行为；`ModelSelector.test.tsx` 验证交互。
- `apps/desktop/src/renderer/src/pages/SettingsPage.test.tsx`：批量测试加载与四项终态回归。

## Task 1：四项固定探测

1. 在目录测试中加入已知文本、纯生图、音视频和未知模型均返回 `['text', 'reasoning', 'vision', 'image_generation']` 的断言。运行 `corepack pnpm exec vitest run apps/agent-runtime/tests/model-capability-catalog.test.ts`，确认因旧目录跳过生图而失败。
2. 在 Runtime 服务测试中加入纯文本与音视频模型的四项真实请求断言、仅生图成功的默认资格断言。运行该测试文件，确认旧实现失败。
3. 将候选数组固定为四项；不要改动 `isChatCandidate`。运行两个 Runtime 测试文件并确认通过。保留提供方适配器对 Token Plan / Images API 的原有选择。

## Task 2：下拉能力状态

1. 在 `ModelSelector.test.tsx` 增加四项成功/失败/待测试投影、信息图标悬停、键盘 Arrow 导航与未测试模型仍可选择的测试。运行目标测试并确认缺少图标或状态导致失败。
2. 在 `model-selection.ts` 加入四项展示状态投影，映射 `success` 为成功、`failed`/`unsupported`/`inconclusive` 为失败，缺项为待测试。保留 `chatCandidate` 筛选优先级。
3. 在 `ModelOptionItem.tsx` 增加统一尺寸的信息图标及无提供方原因的四项浮层；CSS 仅对图标悬停或键盘激活的行展示。为选项提供可读的能力状态名称；在 `ModelSelector.tsx` 跟踪键盘导航状态，不改变现有选中行为。运行目标测试确认通过。

## Task 3：Mock、集成和交付

1. 更新 Mock 与设置页测试，断言每个模型均显示四项候选，音视频行也有生图结果，刷新时所有行同时测试中，默认生图仍只认生图成功。先看失败，再更新 Mock，运行相关测试确认通过。
2. 运行 `corepack pnpm exec prettier --write` 格式化修改的源码与测试文件，运行 `corepack pnpm check`、`openspec validate probe-all-model-image-generation-and-show-selector-capabilities --strict` 和 `git diff --check`。
3. 将已裁决的 delta spec 同步到 `openspec/specs/model-connections-settings/spec.md`，校验全部主规范；勾选 tasks、归档 OpenSpec 变更并提交当前 `main`，确认 `git status --short` 为空。

## Review Focus

- 非聊天模型不会因四项候选进入下拉列表。
- 生图请求真实发出，但失败不覆盖另外三项成功结果。
- 未测试状态不显示为成功，失败原因不进入下拉浮层。
- 键盘导航能读取浮层，同时 Enter 只选择一次。
- 生图重测失败会撤销已失效的默认生图资格。
