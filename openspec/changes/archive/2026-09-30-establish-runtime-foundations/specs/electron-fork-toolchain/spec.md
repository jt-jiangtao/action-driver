## Purpose

定义 Action-Driver 定制 Electron/Chromium Fork 的版本、补丁和构建产物管理行为，确保后续 Chromium 内核能力能够被持续构建、验证和追溯。

## ADDED Requirements

### Requirement: 锁定上游版本来源
系统 MUST 记录定制 Electron Fork 对应的 Electron 标签、Chromium revision、构建配置和补丁基线，禁止生产构建隐式跟随最新上游版本。

#### Scenario: 解析 Fork 基线
- **WHEN** 构建系统准备定制 Electron 源码
- **THEN** 所有上游 revision 与构建参数均来自已提交的版本清单

### Requirement: 以可审查补丁维护内核差异
系统 SHALL 将 Action-Driver 对 Electron 和 Chromium 的修改维护为有顺序、可单独审查且可重复应用的补丁序列。

#### Scenario: 在锁定基线上应用补丁
- **WHEN** 构建系统检出版本清单指定的上游源码
- **THEN** 补丁按声明顺序全部应用，任何补丁失败都会中止构建并指出失败项

### Requirement: 生成可追溯的 Fork 产物
系统 MUST 为每个定制 Electron 构建产物记录目标架构、上游 revision、补丁集标识、构建时间、协议兼容版本和内容校验值。

#### Scenario: 验收构建产物
- **WHEN** Action-Driver 桌面应用选择一个定制 Electron 产物
- **THEN** 构建系统验证产物清单、目标架构和校验值后才允许打包

### Requirement: 生产版使用定制 Electron
系统 MUST 让生产版 Action-Driver 依赖经过验收的定制 Electron 产物，不得在缺失 Fork 产物时静默回退到公开发行版 Electron。

#### Scenario: Fork 产物缺失
- **WHEN** 生产打包无法取得版本清单指定的定制 Electron 产物
- **THEN** 打包失败并报告缺失版本，不生成使用标准 Electron 的替代安装包

### Requirement: 分离通用验证与 macOS 产物构建
系统 SHALL 在 Docker 中执行版本清单、补丁元数据、协议和通用代码验证，并在固定版本的 macOS 执行器上完成需要 Apple 工具链的 Electron/Chromium 构建与运行验收。

#### Scenario: 通用 CI 验证
- **WHEN** 提交只改变协议、清单或补丁元数据
- **THEN** Docker CI 能够在不构建完整 macOS Chromium 的情况下发现格式、引用和兼容性错误

#### Scenario: 构建 macOS Fork 产物
- **WHEN** 补丁集或上游版本发生变化
- **THEN** macOS 构建任务生成并验证目标架构的定制 Electron 产物
