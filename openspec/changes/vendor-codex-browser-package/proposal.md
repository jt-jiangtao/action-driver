## Why

用户要求先补齐 Codex browser 包，便于后续源码可读性分析。当前同步明确排除了该目录。

## What Changes

- 原样复制安装目录内完整 oai_js_browser 到现有 vendor 包的对应路径。
- 更新同步脚本与来源记录，后续同步保留该目录。
- 执行型机械复制，用户已明确授权；不引入运行时接线，无需重新 Battle。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

无。只保存内部研究资料，设置 skip_specs: true，不改变产品行为。

## Impact

仅涉及 vendor、同步脚本及来源记录；不接入 browser API，不格式化或重写原文件。
