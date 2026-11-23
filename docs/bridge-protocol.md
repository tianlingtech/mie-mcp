# 本地 bridge 协议

## 代码结构

- `bridge-client.ts` 负责外部输入验证与生命周期编排.
- `bridge-connection.ts` 负责 socket 连接、hello 握手、握手超时和连接关闭.
- `bridge-request-manager.ts` 负责 pending 请求、socket write、兜底计时和结算.
- `framing.ts` 负责行分隔 JSON 编解码与帧大小边界.

## 协议 v1

默认兼容 socket 路径为 `$TMPDIR/mie-bridge/<uid>/bridge.sock`, 其中 `<uid>` 是
MCP server 进程的用户 id.  server 启动时不会连接 bridge, 首次工具调用才会
惰性连接.  断线后的下一次调用会重新连接并重新握手.

所有帧使用单行 JSON 编码, 并以 `\n` 结尾.  请求和响应格式如下:

```json
{"id":"<uuid>-<seq>","type":"tool_request","tool":"tabs_context","args":{},"timeout_ms":30000}
{"id":"<uuid>-<seq>","type":"tool_response","payload":{"tabs":[]}}
{"id":"<uuid>-<seq>","type":"tool_response","error":{"code":"TIMEOUT"}}
```

连接建立后, bridge 必须先主动发送 hello 帧:

```json
{"type":"hello","protocol_version":1,"bridge_version":"1.0.0","tool_defs_version":"1.0.0"}
```

MCP server 只支持 `protocol_version=1`.  协议版本不兼容时, 当前连接会被
拒绝, 错误同时包含 bridge 版本和 server 支持的版本.  `bridge_version` 和
`tool_defs_version` 会被记录, 并与当前工具契约版本对照.
版本不一致时会输出脱敏诊断, 不会拒绝连接.

`{type:"event"}` 是预留帧类型.  当前实现会安全忽略 event 帧.

## 请求生命周期

每个请求都携带 `timeout_ms`, 正常超时由 bridge 负责结算.  MCP server 设置
`timeout_ms + 5000` 毫秒的兜底定时器, 计时从 `socket.write()` 无同步错误
返回后开始.  握手使用独立的 10 秒超时.  请求结束后, 同一 id 的迟到响应会
被丢弃.

`NOT_SENT` 和 `SENT_LINK_LOST` 以 `socket.write()` 成功回调为分界:

- 回调成功前断线返回 `NOT_SENT`, 请求未送达, 可以安全重试.
- 回调成功后断线且没有响应返回 `SENT_LINK_LOST`, 请求结果未知, 必须先确认
  副作用再决定是否重试.

协议 v1 定义以下错误码, 未知错误码也会原样透传:

- `BRIDGE_NOT_RUNNING`
- `NOT_SENT`
- `SENT_LINK_LOST`
- `TIMEOUT`
- `TAB_GONE`
- `TOOL_ERROR`

BridgeClient 中明确未发送到 bridge 的传输失败使用 `NOT_SENT`.  MCP 层的
未知工具和参数校验失败分别使用 `TOOL_NOT_FOUND` 与 `INVALID_ARGUMENT`, 不会
提示盲目重试.  带合法请求 id 的畸形响应会立即以 `TOOL_ERROR` 结算.  六个
v1 错误码都有可操作提示, 未知 bridge 错误码仍会原样透传并附通用提示.

行解码器允许最大 64 MiB 的单帧或未完成行.  超长完整帧只扫描 512 字符行首
前缀提取 pending id, 不解析整行; 命中 pending 时立即结算, 否则丢弃.  非法帧
诊断只记录字节长度、前缀哈希和安全的顶层协议键名, 不记录浏览器载荷原文.
schema issue 只展开匹配帧类型的分支, 深度最多 4 层、条目最多 32 条.
