## MODIFIED Requirements

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

## ADDED Requirements

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
