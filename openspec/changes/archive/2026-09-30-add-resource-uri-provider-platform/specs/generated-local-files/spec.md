## ADDED Requirements

### Requirement: 登记成品映射到不可变资源 URI

每个已登记成品 SHALL 具有稳定 URI，URI SHALL 指向其登记时的不可变副本并保持现有任务、会话和文件标识归属。统一资源接口对该 URI 的读取、列举、监听与打开 MUST 复用现有安全校验；原位写入 MUST 被拒绝，且旧文件标识和历史卡片 SHALL 在迁移后继续解析到原版本。

#### Scenario: 后续任务覆盖输出路径
- **WHEN** 任务 B 覆盖任务 A 曾生成的同名输出文件
- **THEN** A 的 URI 和旧文件标识仍读取 A 的登记副本，B 的 URI 读取 B 的新版本

#### Scenario: 跨会话 URI 打开
- **WHEN** 会话 B 的页面或插件尝试打开会话 A 的登记成品 URI
- **THEN** 桌面进程按权威归属拒绝请求，不把 URI 转成任意本地路径打开
