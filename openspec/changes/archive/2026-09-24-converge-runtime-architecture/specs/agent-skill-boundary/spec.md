## MODIFIED Requirements

### Requirement: 使用依赖注入替换实现
系统 MUST 通过显式的抽象端口与组合根注入具体实现，使测试替身、本地 Main 执行器和未来其他部署适配器能够在不修改 Agent、Skill 或页面消费者的情况下替换；不得要求消费者依赖具体容器、原生 API 或传输实现。

#### Scenario: 使用 Mock 组合根启动
- **WHEN** 测试或视觉装配注入确定性的 Mock 仓储与能力网关
- **THEN** Agent 会话和 Skill 行为可验证，生产装配不因此回退到 Mock 数据

#### Scenario: 切换本机能力适配器
- **WHEN** 组合根将同一能力端口连接到 Desktop Main 的本机执行适配器
- **THEN** React 页面、Agent 调用者与 Skill manifest 无需修改，Runtime 仍记录执行事实

#### Scenario: 未来切换 IPC 适配器
- **WHEN** 本机能力端口的底层传输改为另一个 IPC 实现
- **THEN** 抽象服务契约与消费者保持不变，只替换组合根中的适配器
