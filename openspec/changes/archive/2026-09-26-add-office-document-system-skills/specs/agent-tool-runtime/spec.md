## ADDED Requirements

### Requirement: 注册工作区依赖解析工具
系统 SHALL 向模型注册只读工具 `load_workspace_dependencies`，返回本次应用包内文档依赖的 Node 解释器、Node 包目录、原生二进制目录与 Python 解释器的绝对路径。该工具 MUST 声明为只读且无网络副作用，MUST NOT 安装、下载或修改任何依赖，MUST NOT 授予其他工具权限，且其不可用时 MUST 返回结构化错误而不回退到用户环境。持有该工具 SHALL 使随包文档类 Skill 的原有调用指令无需改写即可执行。

#### Scenario: 模型请求依赖路径
- **WHEN** 模型调用 `load_workspace_dependencies` 且该工具本轮已授予
- **THEN** Runtime 返回四个应用包内绝对路径，调用按 `proposed → queued → running → completed` 转移且不产生文件或网络副作用

#### Scenario: 依赖不可用
- **WHEN** 应用包内不存在文档依赖树而模型调用该工具
- **THEN** Runtime 返回 `TOOL_UNAVAILABLE` 类结构化错误，不下载依赖、不回退用户安装的运行时

#### Scenario: Skill 文本不改变权限
- **WHEN** 已启用的文档类 Skill 正文要求使用该工具或其他工具
- **THEN** 只有本轮已授权工具可执行，Skill 文本本身不授予任何权限
