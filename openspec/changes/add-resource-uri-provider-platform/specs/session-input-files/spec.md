## ADDED Requirements

### Requirement: 会话输入映射到受保护资源 URI

每个上传输入 SHALL 具有稳定 URI，URI SHALL 保留原任务和会话标识并指向原始上传内容。统一资源接口 SHALL 允许同会话后续任务在授权范围内读取与列举该输入，但 MUST 拒绝通过写入或 provider 映射修改原始输入，且 MUST 拒绝其他会话的读取、列举、监听与打开。

#### Scenario: 同会话读取历史输入
- **WHEN** 任务 B 在同一会话中使用任务 A 上传文件的 URI
- **THEN** 系统读取 A 的原始版本，A 的卡片和旧文件标识保持有效

#### Scenario: 跨会话监听输入
- **WHEN** 会话 B 订阅会话 A 的输入目录 URI
- **THEN** 订阅被拒绝且不会泄露目录成员或后续变更
