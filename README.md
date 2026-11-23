# mie-mcp

`mie-mcp` 是 mie 浏览器自动化链路的 MCP server.  它通过 unix domain
socket 连接本地 bridge, 并通过 stdio 向 MCP client 提供工具.

当前实现提供传输层, 协议层, 共享工具注册接口和 24 个工具.

## 代码结构

- `bridge-client.ts` 负责外部输入验证与生命周期编排.
- `bridge-connection.ts` 负责 socket 连接、hello 握手、握手超时和连接关闭.
- `bridge-request-manager.ts` 负责 pending 请求、socket write、兜底计时和结算.
- `framing.ts` 负责行分隔 JSON 编解码与帧大小边界.

## 协议 v1

socket 路径固定为 `$TMPDIR/mie-bridge/<uid>/bridge.sock`, 其中 `<uid>` 是
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
`tool_defs_version` 会被记录, 但本 change 不校验 `tool_defs_version`.
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

## 本地开发

需要 Node.js 20 或更高版本.

```bash
npm install
npm run typecheck
npm run build
npm test
```

测试使用临时 unix socket 和 fake bridge, 不需要 Chrome 或真实 bridge.
完整测试包含真实 MCP client, stdio server 和 fake bridge 组成的自动化 e2e
链路.  测试结束会删除测试自己创建的 socket 目录.

共享工具的 name、description 和派生 JSON Schema 由仓库快照保护.  快照红灯是
与 `@mie/tool-defs` 对账的触发器, 不是自动同步工具.  不得直接使用快照更新
模式接受变化; 必须先报告差异并与对端确认, 否则这层契约防护会失效.

构建后可通过 stdio 启动 server:

```bash
node dist/index.js
```

stdin EOF、SIGINT 或 SIGTERM 会关闭 bridge socket, 使进程自然退出.

MCP 产品版本从 0.5.0 开始管理, 与共享 tool-defs 版本独立.
初始化的 `serverInfo.version` 和 `profiles_list.serverVersion` 均来自 MCP
启动时读取的 package.json 版本.  修改磁盘版本后需要重启 MCP 才会更新.
该值不表示 Chrome 扩展已 reload, 也不表示 bridge 契约版本.

0.7.0 扩展在实时页面工具调用期间显示橙色边框和 `MIE 正在操作, 请勿干预`.
同一 tab 并发调用全部结束后显示 `MIE 刚刚操作`, 3 秒后淡出.
提示层不锁定页面或抢焦点, 不表示整个 agent 任务结束或页面所有权.
frame 操作提示位于所属 tab 顶层, MIE 截图期间隐藏提示层.
此能力由扩展实现, 不新增 MCP 参数、工具或 wire 字段; 当时 tool-defs 为 0.22.1.
只升级或重启 MCP 不会让用户现有扩展自动加载此提示能力.

0.8.0 新增按明确本机映射启动离线 profile 的 `profiles_launch`, 并改善
`tabs_close` 断连后的结果未知与恢复提示.  配置、权限及失败边界见
[Profile 本机启动与关闭恢复](docs/profile-launch.md).

0.9.0 新增 `screenshot_diagnostics` 读取/清理本 profile 的截图诊断,
并在新截图响应中保留诊断关联 ID.  读取不触发新截图, tab 关闭后仍可查询.
日志边界与使用方式见 [截图故障诊断](docs/screenshot-diagnostics.md).

本轮共享 tool-defs 0.30.0 未发布候选新增 `graphics_diagnostics`,
向新启动的 MCP 进程提供 26 个工具.  它在受管标签页的指定 frame 中读取
有界 canvas 布局元数据, 不读取像素或接收执行代码.  输出校验由扩展负责,
候选同步不表示已在线 MCP 或扩展获得新能力.
契约和校验边界见 [只读图形诊断](docs/graphics-diagnostics.md).

浏览器交互统一使用 `computer`, 支持的 action 为 `screenshot`, `click`,
`type`, `key`, `scroll`, `wait`, 不包含 `hover` 或 `evaluate`.
Codex 曾因坐标 tuple schema 解析失败而跳过该工具.
MCP 派生层将固定长度同构 tuple 转为单个
`items` schema, 保留 `minItems`/`maxItems` 和原始 Zod 校验.
详细证据与重启验收项见 [Codex 兼容排障记录](docs/codex-mcp-compatibility.md).

## bridge socket 路径

default 的旧路径为 `$TMPDIR/mie-bridge/<uid>/bridge.sock`.  当 bridge socket 位于
隔离目录 (如联调环境的 environment-cli 用隔离 TMPDIR 拉起) 时, 用环境变量
显式指定:

```bash
MIE_BRIDGE_SOCKET=/path/to/bridge.sock node dist/index.js
```

该覆盖仅影响 default, 不改变其他 profile 的路由.  该值每次启动重新指定,
不持久化.  新版实例通过发现记录连接, 无 default 记录时兼容旧路径.
多 profile 命名, 发现配置及错误语义见 [多 profile 路由](docs/profile-routing.md).

`set_password_from_file` 仅接收本机已授权文件引用与精确目标页面,
MCP 不读取密码.  bridge 读取文件, 扩展校验 password 类型与页面后设置,
成功仅返回 ok/ref.  授权配置, 限制及操作边界见
[本机文件到密码输入](docs/password-file-input.md).

## 诊断日志

丢弃非法帧时, stderr 记录帧的 UTF-8 字节数和前缀哈希, 不输出帧正文或截断预览.  设置 `MIE_VERBOSE_DIAGNOSTICS=true` 或 `1` 时也遵循此规则.

生产入口从 `@mie/tool-defs` 注册该包 `TOOL_DEFINITIONS` 导出的完整工具集
(0.24.0 为 24 个: `tabs_context`, `tabs_create`, `tabs_close`, `navigate`,
`computer`, `read_page`, `get_page_text`, `find`, `form_input`,
`read_console_messages`, `read_network_requests`, `read_network_request`,
`set_input_files`, `observation_history`, `set_password_from_file`,
`profiles_list`, `profiles_launch`, `javascript_exec`, `hover`, `set_viewport`, `inspect_element`, `wait_for`,
`request`, `screenshot_diagnostics`).  浏览器工具接受可选 `profile`, 省略时固定为 `default`.
`profiles_list` 由 MCP 聚合, `profiles_launch` 通过显式本机映射启动,
两者不转发到某个 bridge.  `computer`
使用带完整 `action` 枚举的扁平对象输入 schema.  测试用 `stub.echo` 只在测试中
内联定义.  当前共享包通过相对
`file:` 路径引用, 并与本仓库共同使用精确锁定的 Zod 4.5.4.
新增工具及截图安全落盘契约见 [E2E 工具说明](docs/e2e-tools.md).

两个观测工具首次读取时分别启用对应类别的采集, 应先读取再触发待观测操作.
`limit` 默认为 100, 范围为 1..200; `clear` 和控制台的 `onlyErrors` 默认为
false.  过滤串长度为 1..200; `pattern` 是不区分大小写的子串,
`urlPattern` 是区分大小写的 URL 子串.  `clear=true` 在读取后清空该类别
全部缓存, 包括未匹配条目, 不停止后续采集.

可选 `patternMode=substring|regex`, 省略保持子串行为且 wire 不注入该键.
regex 模式必须提供对应 pattern/urlPattern, 使用共享 RE2JS 验证语法,
拒绝非法表达式, lookaround, backreference 及编译指令数超过 128 的表达式,
无独立 flags 字段.
支持 RE2 inline flags; 默认控制台忽略大小写, 网络区分大小写.
MCP 校验语法后原样转发, 实际匹配仍由扩展执行.

MCP 使用共享 schema 校验并注入默认值, 通过现有 socket 帧转发参数, 原样返回
`{content:string}` 载荷.  其中 `content` 是含 `entries`, `dropped`,
`invalidEvents`, `omitted`, `scope` 的 JSON 文本.  采集和过滤由扩展负责,
默认仅包含启用后的主 CDP session 事件, 不保证历史;
外部禁用 CDP domain 后, 需 debugger detach 后重新读取以恢复采集.

`read_network_request` 使用列表中的 `requestId` 读取单条请求详情.  `tabId`
为正整数, `requestId` 长度为 1..1024; `maxChars` 为 1..50000, 默认
20000; `includeBody` 默认 true, false 省略响应体.
`includeRequestBody` 默认 false, 仅显式 true 时读取并返回 requestBody.
两开关独立, 可只读取请求体.  无请求体时 requestBody 为 `{state:"absent"}`,
text 可读时为 `{state:"available",source:"Network.getRequestPostData",text,truncated,redacted}`.
省略或关闭 includeRequestBody 时不输出该字段.  未知字段拒绝.
返回的 `{content:string}` 内层 JSON 包含 `request`, `requestHeaders`,
`responseHeaders`, `body`, 以及说明 headers 来源的 `scope`.  Headers 包含 `values`, `omitted`, `redacted`,
`truncated`, `source=base|extra-info`, `extraInfo=pending|available|unavailable`,
response headers 可含独立的 `statusCode`.  `redacted` 为非负计数.  Body 的 `redacted` 为布尔值,
body 为 `state=available` 与 `text`, `truncated`, `redacted`,
或 headers-only 时的 `state=omitted`.  MCP 保持包装和内容, 不二次解析或脱敏.

扩展使用匹配当前 redirect hop 的 ExtraInfo headers, 不可用时标明基础事件来源,
不保证逐字节 wire capture.  可选 `requestBodyFormat=text|base64|multipart`,
省略不注入参数并保持旧 text 行为, 显式指定任一格式必须同时开启
`includeRequestBody=true`.  text 支持 text/JSON/form-urlencoded.
base64 仅支持有效的非文本且非 multipart MIME, 返回 `data`, `byteLength`,
`returnedBytes`, `truncated`, `redacted=false`, `source`, `encodingSource`
和 `completeness="unknown"`.  byteLength 是 Chrome 返回的总字节数,
returnedBytes 是裁剪后字节数, encodingSource 为 base64/utf8/legacy-utf8;
不保证原始上传完整性.  maxChars 按 Base64 字符计, 输出保持合法四字符分组.
multipart 保留有序重复普通字段 `{kind:"field",name,value,truncated}`,
文件仅返回 `{kind:"file",name,filename,mimeType?,omitted:true}`.
请求体包含 `format="multipart"`, `source`, `parts`, `partial=true`,
`filesOmitted`, `omittedParts`, `truncated`, `redacted`.
maxChars 限制普通字段值累计字符数; 整体 JSON 超限时尾部整项省略并计数,
filesOmitted 保留全部已解析部分是否有文件的事实.  文件内容永不输出.
正文按需读取, 不缓存或持久化,
认证字段由扩展脱敏, 最终 content 不超过 50000 字符.
请求未完成, 失败, 响应体为二进制, 正文格式不支持或损坏, 元数据未知,
固定元数据无法容纳, 超限或过期时, 对应正文读取返回
`TOOL_ERROR`; 读取期间条目失效也返回错误.  Headers-only 不要求 body 可读,
但仍要求该 tab 的缓存条目有效.

`get_page_text` 的 `includeFrames` 默认 false, 继续返回原主 frame 的
Title/URL/Source 纯文本.  true 时返回的 `content` 为 JSON, 包含 `frames`,
`omitted`, `truncated`.  `frames` 含主 frame, 按 DOM 包含关系深度优先排列;
每项含 `frameId`, `parentFrameId`, `title`, `url`, `sourceTag`, `text`,
`truncated`, 失败项另含 `error`.  主 frame 的 `parentFrameId` 为 null.

`maxChars` 保持 1000..200000, 默认 50000, 限制整个 content 的字符数.
扩展最多读取 32 个 frame, 最多遍历 50000 个 DOM 节点, 先保留元数据再公平
分配正文预算.  `omitted` 只统计已发现但未输出的 frame.  单 frame 错误随
成功结果返回, 根 tab attach 或 DOM 发现失败返回 `TOOL_ERROR`.
MCP 保留两种结果载荷, 不解析正文; `read_page` 仍拒绝 `includeFrames`.

`read_page`, `find`, `form_input`, `set_input_files` 接受可选 `frameId`,
长度为 1..256, 省略时不注入.  可从 `get_page_text(includeFrames=true)`
取得当前 frame ID, 包括 OOPIF; 对返回 ref 执行交互时复用同一 frameId.
带 frameId 的 read_page/find 返回 MIE 签发的 opaque 数字 ref, 后续通过
backendNodeId 原样传入.  必须先读取或查找同 frame 当前文档的 ref,
不能使用原生 CDP 节点 ID; 无 frameId 的根调用保持原生 ref 行为.
computer 返回的 hit.backendNodeId 是原生诊断 ID, 不能作为 scoped ref.
scoped read_page/find/form_input 文本带 `Frame: "frameId"` 首行,
文件选择 JSON 额外返回 frameId; MCP 保留这些来源信息.
`computer` 的 action=click/type 使用 backendNodeId 且无 coordinate 时接受 frameId.
其它组合在连接 bridge 前拒绝; `get_page_text` 本身不接受 frameId.
MCP 不转换 frame ID 或 ref, 不在失败后自动回退到根 frame.

`set_input_files({tabId,backendNodeId,files,frameId?})` 在 file input 中选择本地文件.
两个 ID 为正整数, `files` 必填且含 0..10 个绝对路径, 每项长度 1..4096,
拒绝 NUL.  公开 schema 识别 POSIX, Windows drive 和 UNC 形式, bridge 再按
本机 OS 验证.  顺序, 空格, Unicode 和重复路径保持, `[]` 明确清空.
MCP 不读取文件, 不填写内部 `verifiedFiles`, 公开输入拒绝该字段及未知字段.

bridge 预检可读普通文件, extension 保留控件限制及名称/大小核对.
不支持目录、disabled 或 single 控件上的多文件选择, 不自动提交表单.
成功 content JSON 保留 `{backendNodeId,files,cleared}` 及可选 frameId,
0.6.1 新增 `verification=current-state|trusted-event` 与
`inputState=retained|cleared|removed|changed`.  files 是匹配证据中的文件
元数据, 包含 `name`, `size`, `type`, `lastModified`, 不一定等于读取时
input.files.  cleared 仅在请求 files=[] 时为 true, 页面消费后清空仍为 false.
少见观测错误可附 observationError.  旧响应无新增字段时 MCP 不补造.

选择交付通过当前状态或页面消费前观测到的匹配可信 input/change 元数据
确认, 不代表业务上传成功或后续处理完成.  派发后命令、证据或清理失败,
以及没有匹配证据时返回 `TOOL_ERROR`, message 以
`FILE_SELECTION_UNCONFIRMED` 开头: 页面可能已处理, 先检查实际状态,
不要盲目重试.  MCP 保留原错误详情且不自动重发.
预检查失败保留原错误语义; 主动清空使用原生 value setter 并派发程序
input/change, 不声明这些清空事件可信.

两个观测列表的 `includeSubSessions` 默认 false, true 显式开启并读取原生关联的
iframe, dedicated/nested worker 与 service worker.  child 条目新增 `source`,
含 `sessionId`, `targetId`, `targetType`, `parentSessionId`; ID 长度为 1..1024,
根父为 null, targetType 限 iframe/worker/service_worker.  service worker 来源
只表示调试关联, 不表示页面独占活动; 同一活动可能被多个关联 tab 观察到.

true 时必有 `subSessions={active,errors,truncated}`, active 是就绪关联非负计数,
errors 最多 20 项, 含 operation/message 及可选 sessionId, message 最多 400 字符.
false 时省略 subSessions 并隐藏 child 条目, 不停止已开启的采集.  clear 清整类
缓存与计数, 包括隐藏或未匹配 child.  根与 child 共用 500 条缓存, limit 合计
最多 200, 总 content 最多 50000 字符.  未形成原生关联的 shared worker 不采集.

`read_network_request` 可选 `sessionId` 长度 1..1024, 省略只查根 session,
显式值取自 child 的 source.  requestId 原值保持, 不跨 session 自动查找.
公开 sessionId 是观测关联 ID, 不保证可用于直接 CDP 命令.  失效关联的摘要可
保留, 详情拒绝.  MCP 只校验输入并透传载荷, 实际来源与生命周期由扩展验证.

`find` 支持可选 query(1..200), role(1..100且非全空白), name(0..200)和
exact(默认false), query/role/name至少提供一个.  exact=true必须有name,
空或全空白name只允许exact=true.  JSON Schema保持flat object且仅tabId必填,
跨字段约束在MCP运行时校验, 失败不连接bridge.

role去首尾空白后按整字段CI匹配; name折叠空白后默认CI子串, exact=true按
整名大小写敏感匹配.  query仍对role/name/value逐字段CI子串, 多条件组合AND.
MCP不trim或改写输入, 不代替扩展执行匹配.  结果保持纯文本ref/value行和20条
上限.  纯query零命中保留旧文案, 语义条件零命中为
`No elements matched the semantic filters.`.  返回ref可用于后续点击或设值,
不自动选择第一个结果或执行交互.

`observation_history` 管理本机profile中的可选观测摘要历史, 默认关闭.
action必填status/configure/read/clear; configure仅接受必填enabled布尔值,
read可选tabId/captureId/kind/beforeId/limit, 其它action不接受查询字段.
UUID保持原值, limit范围1..200, 省略时wire不注入, handler默认100.

成功content为JSON状态, 含enabled/count/dropped/bytes/maxRecords/maxBytes,
pendingWrite/error/scope; read另含records/nextCursor/omitted.  status的存储错误
仍通过正常状态payload表达, read/configure/clear失败为TOOL_ERROR.  read等待
调用时版本完成写入, pendingWrite=false只表示返回的该次快照, 不表示后续没有写入.

仅记录显式开启后的既有MIE观测白名单摘要, 不保存headers/body或原始CDP对象,
不自动附着其它tab.  总1000条/持久化payload 2000000 UTF8字节, 单record JSON
40000字符, 返回content50000字符.  网络状态变化各为独立快照, 新到旧分页,
失效游标明确报错.  bytes不是整个profile数据库的物理占用.

live clear不清历史, history clear不清live或其它storage key.  正常clear保留
enabled, 损坏存储仅显式clear可恢复为disabled空历史; 关闭记录保留已有历史.
历史tabId/captureId/source只表当时来源, 不复活live详情或ref.  仅在本profile
持久化, 已知凭据与URL userinfo/query/fragment去除, 任意敏感文本和路径仍可能保留.
