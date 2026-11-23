## ADDED Requirements

### Requirement: MCP stdio server 运行时
系统 SHALL 基于 `@modelcontextprotocol/sdk` 以 stdio transport 提供 MCP server.  server 的启动 MUST 不依赖 bridge 的可用性.

#### Scenario: bridge 不可用时仍可启动并列出工具
- **WHEN** MCP client 连接到一个 bridge 未运行的 server 并请求工具列表
- **THEN** server 正常返回已注册的工具列表, 不因 bridge 缺失而失败

### Requirement: 从 tool-defs 派生工具注册
系统 SHALL 提供一个注册接口, 接受外部 tool 定义 (name, description, zod schema) 并据此派生 MCP 工具 schema (JSON Schema).  工具定义 MUST 是唯一来源: 本仓库不重复声明工具的参数结构.  被调用时, 已注册工具 MUST 将调用转换为 `tool_request` 帧交由 bridge 执行, 并把 `payload` 作为结果返回.

#### Scenario: 注册的工具出现在工具列表中
- **WHEN** 以一份 tool 定义完成注册后, MCP client 请求工具列表
- **THEN** 列表中包含该工具, 且其 input schema 与 zod 定义等价

#### Scenario: 调用工具转为 bridge 请求
- **WHEN** MCP client 调用一个已注册的工具
- **THEN** 系统向 bridge 发送 `{id, type:"tool_request", tool, args, timeout_ms}` 帧, 并在收到成功响应后将其 `payload` 作为工具结果返回

#### Scenario: 参数不符合 schema
- **WHEN** MCP client 传入不满足 zod schema 的参数
- **THEN** 系统在发送给 bridge 之前拒绝该调用并返回校验错误

### Requirement: bridge 错误码到 MCP 响应的映射
当 bridge 返回错误时, 系统 SHALL 将其映射为 MCP 工具错误响应, 且 MUST 保留原始错误码字段.  对于影响 agent 后续决策的错误码, 响应中 MUST 附带可操作提示: `BRIDGE_NOT_RUNNING` 提示 "请打开 Chrome 并启用 mie 插件"; `NOT_SENT` 说明该请求未送达, 可以安全重试; `SENT_LINK_LOST` 说明请求已发出但结果未知, 必须先截图确认副作用后再决定是否重试.

#### Scenario: bridge 未运行时的提示
- **WHEN** 工具调用因 bridge 未运行而失败
- **THEN** 返回的错误中包含错误码 `BRIDGE_NOT_RUNNING` 与提示 "请打开 Chrome 并启用 mie 插件"

#### Scenario: 区分可重试与不可重试
- **WHEN** 工具调用以 `NOT_SENT` 失败
- **THEN** 错误信息说明请求未送达且可安全重试; 而以 `SENT_LINK_LOST` 失败时, 错误信息说明副作用未知并要求先截图确认

#### Scenario: 不把 bridge 错误伪装成成功
- **WHEN** bridge 返回任意错误码
- **THEN** 该次工具调用以错误结束, 不返回成功结果, 且原始错误码在响应中可见
