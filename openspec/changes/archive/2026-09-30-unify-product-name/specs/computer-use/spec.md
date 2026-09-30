## MODIFIED Requirements

### Requirement: 支持用户控制与接管
系统 SHALL 提供与 Browser Use 语义一致的暂停、继续与人工接管，控制命令 MUST 作用于实际执行门禁，并在暂停或接管期间阻止 Agent 继续发起桌面动作。
Computer Use 会话进行时系统 SHALL 在屏幕上显示不抢焦点的覆盖提示，说明 Action-Driver 正在使用电脑且可按 Esc 取消。用户按 Esc 时系统 SHALL 结束该会话，后续调用 MUST 返回 `USER_STOPPED_SESSION` 且任务停止；动作执行期间检测到用户自己的鼠标或键盘输入时，系统 SHALL 中断当前动作并返回 `USER_INTERVENED`。
敏感动作 SHALL 按确认策略处理：需要确认时，Agent 在回复中说明具体动作与风险，然后结束本轮，MUST NOT 在同一轮内执行该动作；用户在同一会话中回复后，下一轮继续执行。

#### Scenario: 接管桌面操作
- **WHEN** 用户接管桌面操作
- **THEN** Agent 停止发起新动作，用户可直接操作系统，交还后恢复

#### Scenario: 中断任务
- **WHEN** 用户中断正在执行的桌面任务
- **THEN** 进行中的动作被取消或到达终态后停止调度，等待中的授权与确认以取消结束

#### Scenario: 按 Esc 取消
- **WHEN** 用户在 Computer Use 会话中按下 Esc
- **THEN** 覆盖提示消失，当前与后续桌面调用返回 `USER_STOPPED_SESSION`，任务停止

#### Scenario: 用户介入
- **WHEN** 动作执行期间用户移动鼠标或敲击键盘
- **THEN** 当前动作被中断并返回 `USER_INTERVENED`，会话保留

#### Scenario: 敏感动作确认
- **WHEN** Agent 即将代用户发送消息，而首轮指令未预先许可
- **THEN** Agent 在回复中说明要发送的内容与对象，然后结束本轮；消息在用户回复同意之前不被发送

### Requirement: 按应用授权
系统 SHALL 在每次桌面调用前按目标应用判定策略：`forbidden`（终端类应用、Action-Driver 自身、系统认证与隐私授权界面、钥匙串访问）与 `denied`（组织策略）MUST 被拒绝且不可由用户放行；其余应用在本会话未获授权且未被始终允许时，系统 SHALL 在该次调用内阻塞询问用户“允许 Action-Driver 使用「应用名」？”，选项为仅本次、本会话、始终允许（仅限允许持久授权的应用）与拒绝。等待期间 MUST NOT 计入调用超时，MUST NOT 执行该调用。获批后系统 SHALL 冻结调用参数并以解析出的应用路径执行，MUST NOT 让调用中途更换目标应用。点击、输入、按键等单个动作 MUST NOT 再逐次请求确认。高风险应用 SHALL 在授权请求中显示警告说明，且 MUST NOT 提供始终允许。

#### Scenario: 首次使用应用
- **WHEN** Agent 在会话中第一次对“备忘录”调用 `getApp`
- **THEN** 调用暂停并弹出应用授权；用户选择本会话后调用继续，之后对备忘录的调用不再询问

#### Scenario: 仅本次
- **WHEN** 用户对某应用选择仅本次
- **THEN** 只有这一次调用被放行，下一次对该应用的调用再次询问

#### Scenario: 拒绝授权
- **WHEN** 用户拒绝某应用
- **THEN** 该次调用失败并返回未获授权，桌面不发生变化

#### Scenario: 禁区应用
- **WHEN** Agent 请求使用终端
- **THEN** 调用直接失败并返回 `APP_FORBIDDEN`，不弹出授权

#### Scenario: 始终允许
- **WHEN** 用户对允许持久授权的应用选择始终允许
- **THEN** 此后的任务使用该应用不再询问，直到用户在设置中移除
