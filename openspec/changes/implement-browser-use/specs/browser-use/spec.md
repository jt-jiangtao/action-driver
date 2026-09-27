## Purpose

定义 Browser Use 自有双 Fork 的首期基线验收行为，使用独立测试程序验证浏览器与控制层产物的基础操作、生命周期、兼容性和来源追踪，为后续产品接入及内核接口扩展提供可靠依据。

## ADDED Requirements

### Requirement: 独立验证双 Fork 兼容操作
验证程序 SHALL 使用自有 Playwright 与 Electron/Chromium 共同完成同一页面的导航、点击、输入、截图和关闭；本期 MUST NOT 要求修改或接入 ActionDriver 产品。

#### Scenario: 基础兼容冒烟
- **WHEN** 两套自有产物运行确定性本地页面夹具
- **THEN** 导航、点击、输入结果可断言，截图包含页面内容，关闭后页面与测试进程资源释放

#### Scenario: 页面关闭后操作
- **WHEN** 测试页面关闭后继续请求操作
- **THEN** 请求明确失败，不报告成功

### Requirement: 产物来源可追踪
验证程序 MUST 记录自有仓库来源、确切提交、依赖内核版本、构建配置、平台架构和产物校验值；无效产物 MUST 明确失败，不得静默使用官方产物代替。

#### Scenario: 运行来源核验
- **WHEN** 核验实际测试产物
- **THEN** 加载路径与锁定记录一致，能追溯到两个自有源码提交和构建记录

#### Scenario: 无效产物
- **WHEN** 产物缺失、校验失败或版本组合不匹配
- **THEN** 验证明确失败并记录原因，不声明兼容通过

### Requirement: 自有差异可识别且隔离
Chromium 自有行为改动 MUST 受 ACTION_DRIVER 平台宏控制；Playwright 自有实现 MUST 位于自有目录。自有差异 SHALL 明确记录，不得隐藏接线改动或擅自豁免隔离要求。

#### Scenario: 差异审查
- **WHEN** 审查两个 Fork 相对锁定上游的改动
- **THEN** 每项差异有来源和理由，Chromium 行为代码受宏控制，Playwright 自有实现可按目录识别

#### Scenario: 关闭平台宏
- **WHEN** 含自有行为补丁的内核关闭 ACTION_DRIVER 宏构建运行
- **THEN** 自有行为不生效，上游基础路径仍可构建运行

#### Scenario: 零行为差异基线
- **WHEN** 本期没有自有行为扩展
- **THEN** 清单如实记录零行为差异，不以新增示例接口满足验收

### Requirement: 主仓库可递归拉取锁定 Fork 源码
主仓库 MUST 使用 Git submodule 记录自有 Playwright 与 Electron 的来源和确切提交，分别使用直属 `thridparty/playwright/` 与 `thridparty/electron/` 路径。源码提交 MUST 在对应 Fork 远端可获取；工具、Chromium 依赖及构建产物 MUST NOT 作为这两个源码 submodule 的主仓库内容提交。

#### Scenario: 新检出获取源码
- **WHEN** 用户对主仓库执行递归 clone
- **THEN** 两个 Fork 在约定路径初始化，origin 指向对应自有仓库，HEAD 与主仓库锁定的 gitlink 提交一致

#### Scenario: 已有检出初始化源码
- **WHEN** 用户执行 git submodule update --init --recursive
- **THEN** 两个 Fork 可按主仓库指针初始化，文档说明 .git 可能为指向主仓库模块元数据的文件

#### Scenario: Chromium 依赖独立同步
- **WHEN** 用户准备 Electron 构建所需 Chromium 和工具链
- **THEN** 文档提供独立工作区的 gclient 配置和同步步骤，构建使用与直属 Electron 源码相同提交的独立检出，保留已注册 Electron submodule，不将源码递归拉取声明为依赖下载或构建完成

#### Scenario: 保留现有工作区
- **WHEN** 在当前工作区注册两个 submodule
- **THEN** 主仓库索引包含两条 mode 160000 的源码记录，现有 Fork 分支、未提交文件和构建产物保持可用

#### Scenario: 直属子仓库识别
- **WHEN** 在两个源码 submodule 中查询所属主仓库
- **THEN** 均返回 ActionDriver 主仓库路径，不受 Chromium 中间 Git 仓库影响

#### Scenario: 构建源码一致
- **WHEN** 使用 thridparty/build/electron-workspace 准备构建
- **THEN** 独立 Electron 检出与直属源码的已提交 HEAD 一致；存在冲突或用户改动时明确报告，不静默覆盖
