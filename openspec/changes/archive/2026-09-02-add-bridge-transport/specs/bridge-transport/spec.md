## ADDED Requirements

### Requirement: bridge socket 连接与惰性重连
系统 SHALL 通过 unix domain socket 连接 bridge, 路径为 `$TMPDIR/mie-bridge/<uid>/bridge.sock` (`<uid>` 为当前进程的用户 id).  连接 MUST 是惰性的: MCP server 启动时不要求 bridge 已存在, 仅在首次需要发送请求时才建立连接.  连接断开后, 系统 MUST 在下一次请求时重新尝试连接, 而不是永久进入失败态.

#### Scenario: 启动时 bridge 未运行
- **WHEN** MCP server 启动而 socket 文件不存在
- **THEN** server 正常完成启动并对外提供 MCP 服务, 不抛出致命错误, 不退出进程

#### Scenario: 首次请求时建立连接
- **WHEN** server 已启动且尚未连接, 此时收到第一个工具调用
- **THEN** 系统建立到 socket 的连接, 完成握手后再发送该请求

#### Scenario: 断线后的下一次请求自动重连
- **WHEN** 已建立的连接被对端关闭, 之后再次收到工具调用
- **THEN** 系统重新建立连接并重新握手, 该次调用正常完成

#### Scenario: bridge 不可用时的错误码
- **WHEN** 需要发送请求但 socket 文件不存在或连接被拒绝
- **THEN** 系统返回错误码 `BRIDGE_NOT_RUNNING`

### Requirement: 行分隔 JSON 帧编解码
系统 SHALL 以行分隔 JSON (每帧一行, `\n` 结尾) 与 bridge 交换帧.  请求帧格式为 `{id, type:"tool_request", tool, args, timeout_ms}`, 响应帧格式为 `{id, type:"tool_response", payload}` 或 `{id, type:"tool_response", error}`.  系统 MUST 正确处理 TCP/socket 分片: 一次读取中可能包含半帧或多帧.

#### Scenario: 单次读取包含多个完整帧
- **WHEN** 一次 socket 读取的数据中含有两个以 `\n` 分隔的完整响应帧
- **THEN** 系统解析出两帧, 分别派发给对应 `id` 的等待方

#### Scenario: 帧跨越多次读取
- **WHEN** 一个响应帧被拆成两次读取送达
- **THEN** 系统缓冲前半段, 待收到 `\n` 后解析出完整帧并正确派发

#### Scenario: 收到预留的 event 帧
- **WHEN** bridge 发来 `{type:"event", ...}` 帧
- **THEN** 系统安全忽略该帧并继续正常处理后续帧, 不报错也不中断连接

#### Scenario: 收到无法解析的行
- **WHEN** bridge 发来一行非法 JSON
- **THEN** 系统丢弃该行并记录诊断信息, 不使进程崩溃, 后续合法帧仍能正常处理

### Requirement: hello 握手与版本协商
连接建立后, bridge SHALL 主动发送 `{type:"hello", protocol_version, bridge_version, tool_defs_version}`.  系统 MUST 在握手完成后才发送任何 `tool_request`.  本实现支持的 `protocol_version` 起始值为 1.  当 bridge 的 `protocol_version` 与本实现不兼容时, 系统 MUST 拒绝使用该连接, 并在错误信息中同时给出双方的版本号.

#### Scenario: 握手成功
- **WHEN** 连接建立后 bridge 发来 `protocol_version` 为 1 的 hello 帧
- **THEN** 系统记录 `bridge_version` 与 `tool_defs_version`, 并开始发送待处理的 `tool_request`

#### Scenario: 协议版本不兼容
- **WHEN** bridge 发来的 `protocol_version` 不被本实现支持
- **THEN** 系统拒绝该连接, 返回的错误信息中同时包含 bridge 的 `protocol_version` 与本实现支持的版本

#### Scenario: 握手前不发送请求
- **WHEN** 连接已建立但 hello 帧尚未到达, 此时有工具调用待发送
- **THEN** 系统暂不发送该请求, 直到握手完成后才发出

### Requirement: 超时归属与迟到响应丢弃
每个请求帧 MUST 携带 `timeout_ms`, 由 bridge 负责计时并回 `TIMEOUT` 响应帧.  系统仅做兜底计时, 兜底时长为 `timeout_ms + 5000` 毫秒, 使得正常路径下始终由 bridge 先超时.  对于已经结束 (已响应或已兜底超时) 的请求 `id`, 系统 MUST 丢弃其迟到响应.

#### Scenario: bridge 回 TIMEOUT 响应帧
- **WHEN** 请求超时且 bridge 回 `{id, type:"tool_response", error:{code:"TIMEOUT"}}`
- **THEN** 系统按错误码 `TIMEOUT` 结束该请求, 不再触发自身的兜底计时器

#### Scenario: bridge 无响应时的兜底超时
- **WHEN** 请求发出后超过 `timeout_ms + 5000` 毫秒仍未收到任何响应帧
- **THEN** 系统以错误码 `TIMEOUT` 结束该请求

#### Scenario: 丢弃迟到响应
- **WHEN** 某请求已因兜底超时结束, 之后其 `id` 对应的响应帧才到达
- **THEN** 系统丢弃该响应帧, 不重复结算该请求, 不报错

### Requirement: 错误码原样透传
系统 MUST 原样透传 bridge 返回的错误码, 不得归一化为通用失败.  v1 错误码枚举为 `BRIDGE_NOT_RUNNING`, `NOT_SENT`, `SENT_LINK_LOST`, `TIMEOUT`, `TAB_GONE`, `TOOL_ERROR`.  枚举 SHALL 可扩展: 遇到未在枚举内的错误码时, 系统同样原样透传而非替换或吞掉.

#### Scenario: 请求未发出与链路中断的区分
- **WHEN** 连接在请求写入 socket 之前断开
- **THEN** 系统返回 `NOT_SENT`; 而当连接在请求已写出之后断开时, 系统返回 `SENT_LINK_LOST`

#### Scenario: 透传未知错误码
- **WHEN** bridge 返回一个不在 v1 枚举内的错误码
- **THEN** 系统原样透传该错误码字符串, 不替换为 `TOOL_ERROR` 或其他通用码
