# bundled-script-runtimes Specification

## Purpose

定义 macOS 桌面应用向模型提供的 Shell、Python 与 Node.js 独立执行能力，以及 Python/Node 解释器随包交付和离线运行的用户可观察保证。

## Requirements

### Requirement: 包内解释器保证离线执行
macOS arm64 与 x64 应用包 SHALL 各自包含匹配架构的 Python 解释器、Python 标准库与 Node.js 解释器。`python_run`、`node_run` 和 `ts_run` MUST 只使用当前应用包内解析的绝对路径，MUST NOT 回退到用户安装的解释器，也 MUST NOT 在执行时下载运行时。系统仅保证 Python 标准库、Node 内建模块及其原生 TypeScript 类型擦除能力；任意第三方 `pip` 或 `npm` 包不属于离线保证。除该通用保证外，系统 SHALL 允许存在独立的文档依赖树，为本机文档类 Skill 验证提供第三方库与原生二进制；该依赖树 MUST 位于应用包内、MUST NOT 改变上述解释器解析路径，且其缺失 MUST NOT 使 `python_run`、`node_run` 或 `ts_run` 的基础执行失败。

#### Scenario: 用户没有安装 Python 和 Node
- **WHEN** 用户在没有可用系统 Python/Node 的 macOS 上离线运行打包应用
- **THEN** `python_run`、`node_run` 与 `ts_run` 仍能运行各自支持范围内、只依赖标准库或内建模块的源码，执行路径位于当前应用包内

#### Scenario: 包内运行时缺失
- **WHEN** 当前架构的包内解释器或 Python 标准库缺失
- **THEN** 对应工具返回明确的运行时不可用错误，不回退宿主机解释器

#### Scenario: 文档依赖树缺失
- **WHEN** 应用包内不存在文档依赖树
- **THEN** 四个脚本工具仍按各自通用保证正常执行，文档类 Skill 的可选能力不可用且不静默回退到用户环境

### Requirement: 共用进程生命周期与活动展示
四个工具 SHALL 共用工作区默认工作目录、stdout/stderr 流、退出码、超时、输出上限与取消语义。任务活动 SHALL 显示对应 Shell、Python、Node.js 或 TypeScript 动作及运行状态；工具过程不得混入助手正文。

#### Scenario: 脚本失败
- **WHEN** 任一脚本以非零退出码结束
- **THEN** 对应工具进入失败终态，保留受限输出和退出码供任务活动查看

#### Scenario: 取消长时间运行的脚本
- **WHEN** 用户在任一脚本子进程运行中取消任务
- **THEN** Runtime 终止该调用的进程树并记录取消终态，不将取消请求误报为执行成功

#### Scenario: 重开旧工具记录
- **WHEN** 用户重开包含旧版本 `shell_run`、`python_run` 或 `node_run` 输入字段的任务
- **THEN** 原调用记录仍可只读展示，旧脚本不因重开或恢复而重新执行

### Requirement: 旧白名单工具退出模型调用面
系统 MUST NOT 向新模型请求注册 `sandbox_shell_run`、`sandbox_fs_list` 或 `sandbox_fs_read`，MUST 继续只读展示历史 `sandbox.shell.run@1` 记录，且 MUST NOT 因重开或恢复任务而重放旧命令。系统不保证历史 `sandbox.fs.*` 记录的专用展示，且不得重放这些已移除工具。随包的 `rg` SHALL 继续可由通用 Shell 工具作为普通命令调用。

#### Scenario: 重开包含旧命令的任务
- **WHEN** 用户重开含 `sandbox.shell.run@1` 历史调用的任务
- **THEN** 原记录仍按原状态展示，新模型工具列表不包含旧工具，旧命令不被重新执行

#### Scenario: 新任务通过 Shell 访问文件
- **WHEN** 模型需要列目录或读取工作区文件
- **THEN** 可使用 `shell_run` 执行命令，模型请求不包含 `sandbox_fs_list` 或 `sandbox_fs_read`

### Requirement: 提供四个独立源码脚本工具
系统 SHALL 向模型分别注册 `shell_run`、`python_run`、`node_run` 与 `ts_run`，并在本轮授予后按既有工具生命周期执行。四个工具 MUST 各自只接收非空 `script` 源码文本及可选字符串数组 `args`，MUST 由所选工具确定解释器，并通过标准输入传入脚本。工具 MUST NOT 从源码猜测语言或接受旧的 `command`、`code`、`file` 输入形态。无效输入 MUST 在创建子进程前失败。

#### Scenario: Shell 执行源码
- **WHEN** 模型调用 `shell_run`，传入包含管道或重定向的非空 Shell 脚本
- **THEN** Runtime 用 macOS Shell 执行标准输入中的脚本，并按原调用 id 返回流式输出与退出状态

#### Scenario: Python、Node 和 TypeScript 分别执行源码
- **WHEN** 模型选择 `python_run`、`node_run` 或 `ts_run` 并传入对应语言的 `script` 与可选 `args`
- **THEN** Runtime 使用所选工具的包内解释器从标准输入执行，脚本参数、输出和退出状态关联原调用 id

#### Scenario: 旧字段与空源码被拒绝
- **WHEN** 任一新工具收到空 `script`，或收到旧字段 `command`、`code`、`file` 代替 `script`
- **THEN** Runtime 返回输入无效终态，不启动解释器

### Requirement: TypeScript 支持包内 Node 的原生类型擦除
`ts_run` SHALL 支持当前应用包内 Node.js 能直接执行的可擦除 TypeScript 语法；对于需要 `tsconfig` 转换、额外编译器或第三方依赖的源码，系统 MUST 返回清晰的运行错误，不能静默改用用户环境中的工具链。

#### Scenario: 执行可擦除 TypeScript
- **WHEN** 模型调用 `ts_run` 传入只使用可擦除类型标注和 Node 内建模块的脚本
- **THEN** 工具在没有系统 TypeScript 安装的环境中仍可运行

#### Scenario: 超出首版 TypeScript 范围
- **WHEN** `ts_run` 收到包内 Node 无法直接执行的 TypeScript 语法
- **THEN** 工具返回对应运行错误和失败状态，不下载或调用系统编译器

### Requirement: 文档依赖树与运行时路径解析
系统 SHALL 支持把文档依赖树暂存到应用包内的固定目录，并保留其原生目录布局，使文档类 Skill 自带脚本按原有相对位置解析解释器与原生二进制。依赖树内的解释器、第三方库与原生二进制 SHALL 与其来源保持一致版本，系统 MUST NOT 在暂存或执行时升级、降级或按包内解释器重新解析这些依赖。系统 SHALL 向四个脚本工具的进程环境注入 `RUNTIME_NODE`、`RUNTIME_NODE_MODULES`、`RUNTIME_BIN_DIR` 与 `RUNTIME_PYTHON`，并把文档依赖的原生二进制目录加入 `PATH`。这些变量与路径 MUST 只指向应用包内已存在的绝对路径；缺失时 MUST 返回可理解的结构化错误，MUST NOT 回退到用户已安装的同名程序或运行时。

#### Scenario: 脚本按原指令解析随包依赖
- **WHEN** 文档类 Skill 的脚本在脚本工具中运行并读取 `RUNTIME_*` 变量
- **THEN** 每个变量都是应用包内的绝对路径，脚本无需修改即可解析到 Node、Node 包目录、原生二进制目录与 Python 解释器

#### Scenario: 原生渲染二进制可用
- **WHEN** 脚本需要调用随包的原生二进制完成格式转换或页面栅格化
- **THEN** 该二进制可从注入的 `PATH` 或 `RUNTIME_BIN_DIR` 解析到应用包内路径，用户桌面版同类软件不参与解析

#### Scenario: 依赖树不完整
- **WHEN** 依赖树缺少某个必需解释器或原生二进制
- **THEN** 对应脚本返回明确的缺失路径错误并进入失败终态，不下载运行时、不回退用户环境

#### Scenario: 依赖版本与包内解释器不一致
- **WHEN** 文档依赖树内的解释器或第三方库版本与包内通用解释器不一致
- **THEN** 系统按依赖树自身版本执行文档类 Skill 的脚本，不尝试对齐、重装或重新解析任一版本
