# resource-uri-platform Specification

## Purpose
为任务输入、生成产物、插件内容以及本地或远程资源提供统一的可寻址接口，使调用方通过资源 URI 发现、读取、写入、列举和监听资源，同时由资源所有者持续执行身份、会话、版本和权限校验。

## Requirements

### Requirement: 资源 URI 可序列化且不等于授权

系统 SHALL 使用规范化、版本化的 URI 表达 scheme、资源标识和必要的作用域，支持跨进程传输与持久化。URI 字符串 MUST NOT 自身构成访问凭据；每次操作 MUST 根据权威调用者、任务、会话和 provider 策略重新授权，并拒绝路径穿越、伪造 scheme 与跨作用域访问。

#### Scenario: 复制其他会话 URI
- **WHEN** 会话 B 持有会话 A 的输入资源 URI 并请求读取
- **THEN** 系统拒绝读取且不返回资源字节或可推断的私有元数据

#### Scenario: 非法 URI
- **WHEN** 调用者提交未注册 scheme、非规范编码或包含路径穿越的 URI
- **THEN** 系统在访问底层资源前返回结构化错误

### Requirement: Provider 注册与发现

宿主 SHALL 按 scheme 注册版本化本地或远程 provider，并公开其支持的读取、写入、列举和监听能力。重复 scheme、版本不兼容或 provider 停用 SHALL 有明确诊断；调用方 MUST NOT 因 provider 不可用而自动回退到本地文件系统或其他 scheme。

#### Scenario: 远程 provider 断开
- **WHEN** 已注册远程 provider 断线而调用方读取其 URI
- **THEN** 读取明确失败并保留 URI 归属，不改读同名本地文件

#### Scenario: 重复注册
- **WHEN** 两个不同所有者注册同一 scheme 与作用域
- **THEN** 后注册者被拒绝并报告冲突归属，原 provider 保持可用

### Requirement: 完整资源操作语义

系统 SHALL 提供读取、写入、列举和监听资源的统一操作，传输元数据、内容类型、版本和取消信号；大文件 SHALL 以有界流处理。provider SHALL 对不支持的操作返回明确能力错误，取消或超时 MUST 传播到实际操作，不得把未完成写入当作成功。

#### Scenario: 列举目录并读取文件
- **WHEN** 有权限的调用者列举 provider 目录并读取其中一个资源
- **THEN** 返回稳定 URI、类型与版本信息，并以有界流返回对应内容

#### Scenario: 写入中取消
- **WHEN** 调用者在内容写入未提交时取消请求
- **THEN** provider 终止写入并报告取消，资源不会显示为已提交的新版本

### Requirement: 写入冲突与不可变版本

可写资源 SHALL 使用显式预期版本或创建条件处理并发写入；版本冲突 MUST 拒绝覆盖并返回当前版本。只读或已交付的不可变资源 MUST 拒绝原位写入；修改内容 SHALL 创建新的受归属约束的版本，不得改变历史任务引用。

#### Scenario: 并发写入冲突
- **WHEN** 两个调用者基于同一旧版本写入同一可写资源
- **THEN** 只有一个提交成功，另一个收到版本冲突且不会覆盖成功者

#### Scenario: 修改已交付产物
- **WHEN** 调用者通过历史任务产物 URI 请求原位写入
- **THEN** 系统拒绝写入；如业务允许派生新版，新版取得不同标识，旧任务仍指向原副本

### Requirement: 监听、重连与失效

资源监听 SHALL 只向有权限的订阅者发布所属作用域内的变更，并提供可识别的版本或序号以支持重连后的重新同步。provider 停用、连接中断或权限撤销时 SHALL 结束订阅并通知原因；系统 MUST NOT 将断连期间遗漏的事件伪装为完整连续记录。

#### Scenario: 监听期间断线
- **WHEN** 远程 provider 在资源变更期间断线后重连
- **THEN** 订阅者收到需要重新同步的状态或可验证的连续增量，不会静默丢失变化

#### Scenario: 权限撤销
- **WHEN** 订阅者的会话访问权被撤销
- **THEN** 监听停止，后续事件不再发送给该订阅者

### Requirement: 打开资源保持宿主安全边界

页面和插件 SHALL 通过受控资源接口请求打开 URI；桌面进程 SHALL 在操作时重新解析并校验资源归属、类型与可打开性。远程资源 SHALL 先经受控读取或安全预览，不得把任意 URI 或原始路径直接交给操作系统。

#### Scenario: 打开远程资源
- **WHEN** 用户打开有权访问的远程文档 URI
- **THEN** 系统通过所属 provider 取得受控内容或预览，且不会让远程 URI 绕过桌面打开白名单
