## ADDED Requirements

### Requirement: 进程关停路径
MCP server SHALL 具备关停路径: 当 stdio transport 关闭, 或进程收到 SIGINT / SIGTERM 时, 系统 MUST 关闭 bridge 连接并使进程能够退出.  系统 MUST NOT 在传输层关闭后因仍持有 bridge socket 而无法自然退出.

#### Scenario: stdin 关闭后进程退出
- **WHEN** MCP client 关闭 stdio transport (stdin EOF), 且此前已与 bridge 建立过连接
- **THEN** 系统关闭 bridge 连接并退出, 不留下持有 socket 的常驻进程

#### Scenario: 收到终止信号
- **WHEN** 进程收到 SIGTERM 或 SIGINT
- **THEN** 系统关闭 bridge 连接并退出

#### Scenario: 关停时在途请求的结算不产生假可重试信号
- **WHEN** 关停发生时仍有已写出但未收到响应的请求
- **THEN** 这些请求以 `SENT_LINK_LOST` 结束 (副作用未知), 不得被标记为 `NOT_SENT` —— 后者会提示可安全重试, 从而导致真实浏览器操作被重复执行

### Requirement: 错误提示覆盖全部错误码
系统为 bridge 错误附加的可操作提示 SHALL 覆盖 v1 的全部错误码, 并对未知错误码给出通用提示.  提示的覆盖 MUST NOT 只及于其中一部分错误码, 否则 agent 面对不同失败时得到的信息质量不一致.

#### Scenario: 每个 v1 错误码都有提示
- **WHEN** 工具调用以 v1 六个错误码中的任意一个失败
- **THEN** 返回的错误中都带有与该码相称的可操作提示, 且原始错误码仍然可见

#### Scenario: 未知错误码的提示
- **WHEN** 工具调用以一个不在 v1 枚举内的错误码失败
- **THEN** 返回的错误原样保留该错误码, 并附带一条通用提示

### Requirement: 版本号单一来源与入口守卫
server 对外声明的版本号 SHALL 与 `package.json` 同源, 不得在代码中重复硬编码.  入口模块 SHALL 仅在被直接执行时启动 server, 被其他模块 import 时 MUST NOT 产生副作用.

#### Scenario: 版本号一致
- **WHEN** 修改 `package.json` 的版本号后启动 server
- **THEN** server 对 MCP client 声明的版本号随之变化, 无需另行修改源码

#### Scenario: import 不启动 server
- **WHEN** 其他模块 import 入口模块
- **THEN** 不会有 server 被启动, 也不会有 bridge 连接被建立

### Requirement: 从 tool-defs 注册 P0 工具集
系统 SHALL 从 mie 仓库的共享包 `@mie/tool-defs` 引入 tool 输入定义, 并据此注册 P0 工具集: `tabs_context`, `tabs_create`, `tabs_close`, `navigate`, `computer`, `read_page`.  工具的参数结构 MUST 以该共享包为唯一来源, 本仓库 MUST NOT 重复声明任何工具的参数结构.

系统 MUST NOT 使用该共享包的 `./protocol` 导出作为 socket 层的帧校验依据 —— 那是 extension↔bridge 的 native messaging 内层协议, 其严格校验与封闭错误码枚举与 socket 层的前向兼容契约相冲突.  共享包的 `ERROR_CODES` 只能作为已知错误码的参考表使用 (例如生成提示), MUST NOT 作为校验闸.

#### Scenario: P0 工具全部可见
- **WHEN** MCP client 请求工具列表
- **THEN** 列表中包含全部 6 个 P0 工具, 各自的 input schema 与共享包中对应的 zod 定义等价

#### Scenario: 按 action 判别的工具输入
- **WHEN** MCP client 查看 `computer` 工具的 input schema, 或以其中一种 `action` 调用它
- **THEN** 该工具的 schema 正确表达了按 `action` 判别的多形态输入, 且合法调用能被正确转发给 bridge

#### Scenario: 未知错误码不因共享包而被收窄
- **WHEN** bridge 返回一个不在共享包 `ERROR_CODES` 内的错误码
- **THEN** 系统仍原样透传该错误码, 引入共享包 MUST NOT 使未知码被拒绝或归一化

#### Scenario: stub 工具不出现在生产入口
- **WHEN** 生产入口启动的 server 被请求工具列表
- **THEN** 列表中只有 P0 工具, 不含仅用于测试的 stub 工具

### Requirement: obscured 标记不得被当作失败
当 bridge 返回的工具结果中包含 `obscured=true` 一类的标记时, 系统 SHALL 原样透传该结果, MUST NOT 据此把调用判定为失败.

对端已知: 点击 input 类控件时命中探测可能把 UA shadow DOM 的内部节点误报为被遮挡, 而功能实际不受影响.  由本侧硬性拒绝会让正常的输入框点击失败, 且 agent 无从得知原因.

#### Scenario: 结果中带 obscured 标记
- **WHEN** 工具调用成功返回, 但结果载荷中含 `obscured=true`
- **THEN** 该调用以成功结束, 载荷原样返回给 agent, 由 agent 自行判断
